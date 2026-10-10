import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { lagosDateBoundary } from '../utils/timezone.js';
import { getScope } from '../utils/clientScope.js';
import { toNum } from '../utils/wallet.js';

const router = Router();
router.use(requireAuth);

const PRESENT_STATUSES = ['PRESENT', 'LATE', 'OVERTIME'];

async function countsFor(empWhere, today) {
  const [totalEmployees, activeEmployees, onboardingCount, todayPresent, pendingLeaves] = await Promise.all([
    prisma.employee.count({ where: { archived: false, ...empWhere } }),
    prisma.employee.count({ where: { employmentStatus: 'ACTIVE', archived: false, ...empWhere } }),
    prisma.employee.count({ where: { employmentStatus: 'ONBOARDING', archived: false, ...empWhere } }),
    prisma.attendance.count({ where: { date: today, status: { in: PRESENT_STATUSES }, employee: empWhere } }),
    prisma.leaveRequest.count({ where: { status: { in: ['PENDING_MANAGER', 'PENDING_HR'] }, employee: empWhere } }),
  ]);
  return { totalEmployees, activeEmployees, onboardingCount, todayPresent, pendingLeaves };
}

/**
 * Role-aware dashboard numbers.
 *  - SUPER_ADMIN: company-wide totals, number of clients, wallet totals, a per-client breakdown.
 *  - HR Admin / HR Manager / Payroll Officer: ONLY the clients assigned to them, broken down
 *    per client. They never receive the company-wide totals or the number of clients.
 *  - Team Lead: only their own team.
 */
router.get('/dashboard-stats', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const today = lagosDateBoundary(new Date());
    const role = req.user.role;

    if (role === 'SUPER_ADMIN') {
      const [totals, clientsCount, grouped, clients, wallets, pendingFunding, pendingPayroll] = await Promise.all([
        countsFor({}, today),
        prisma.client.count({ where: { isActive: true } }),
        prisma.employee.groupBy({ by: ['clientId', 'employmentStatus'], where: { archived: false }, _count: { _all: true } }),
        prisma.client.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
        prisma.wallet.aggregate({ where: { kind: 'CLIENT' }, _sum: { balance: true } }),
        prisma.walletTransaction.aggregate({ where: { type: 'FUNDING', status: 'PENDING' }, _count: { _all: true }, _sum: { amount: true } }),
        prisma.payrollRun.count({ where: { status: 'PENDING_SUPER_ADMIN' } }),
      ]);
      const perClient = clients.map((c) => {
        const rows = grouped.filter((g) => g.clientId === c.id);
        const total = rows.reduce((n, g) => n + g._count._all, 0);
        const active = rows.filter((g) => g.employmentStatus === 'ACTIVE').reduce((n, g) => n + g._count._all, 0);
        const onboarding = rows.filter((g) => g.employmentStatus === 'ONBOARDING').reduce((n, g) => n + g._count._all, 0);
        return { clientId: c.id, name: c.name, totalEmployees: total, activeEmployees: active, onboardingCount: onboarding };
      });
      return res.json({
        scope: 'ALL',
        ...totals,
        clientsCount,
        perClient,
        money: {
          clientWalletTotal: toNum(wallets._sum.balance),
          pendingFundingCount: pendingFunding._count._all,
          pendingFundingAmount: toNum(pendingFunding._sum.amount),
          payrollAwaitingFinalApproval: pendingPayroll,
        },
      });
    }

    if (role === 'TEAM_LEAD') {
      const myId = req.user.employee?.id;
      const totals = myId
        ? await countsFor({ teamLeadId: myId }, today)
        : { totalEmployees: 0, activeEmployees: 0, onboardingCount: 0, todayPresent: 0, pendingLeaves: 0 };
      return res.json({ scope: 'TEAM', ...totals });
    }

    // HR_ADMIN / HR_MANAGER / PAYROLL_OFFICER — assigned clients only
    const scope = await getScope(req.user);
    const clients = scope.clientIds.length
      ? await prisma.client.findMany({ where: { id: { in: scope.clientIds }, isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } })
      : [];
    const perClient = await Promise.all(
      clients.map(async (c) => ({ clientId: c.id, name: c.name, ...(await countsFor({ clientId: c.id }, today)) }))
    );
    const sum = (key) => perClient.reduce((n, c) => n + c[key], 0);
    const [pendingFunding, unread] = await Promise.all([
      prisma.walletTransaction.count({ where: { type: 'FUNDING', status: 'PENDING', clientId: { in: scope.clientIds } } }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);
    res.json({
      scope: 'CLIENTS',
      totalEmployees: sum('totalEmployees'),
      activeEmployees: sum('activeEmployees'),
      onboardingCount: sum('onboardingCount'),
      todayPresent: sum('todayPresent'),
      pendingLeaves: sum('pendingLeaves'),
      assignedClients: clients.length,
      perClient,
      pendingFundingCount: pendingFunding,
      unreadNotifications: unread,
    });
  } catch (err) { next(err); }
});

router.get('/users', requireRole('SUPER_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } } });
    res.json({ users });
  } catch (err) { next(err); }
});

router.patch('/users/:id/role', requireRole('SUPER_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const { role } = z.object({ role: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'TEAM_LEAD', 'EMPLOYEE']) }).parse(req.body);

    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ message: 'User not found' });

    // HR Manager sits just below Super Admin — they can manage everyone else, but
    // cannot touch a Super Admin account, and cannot grant Super Admin access to anyone.
    if (req.user.role === 'HR_MANAGER' && (target.role === 'SUPER_ADMIN' || role === 'SUPER_ADMIN')) {
      return res.status(403).json({ message: 'HR Managers cannot modify Super Admin accounts or grant Super Admin access.' });
    }

    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
    res.json({ user });
  } catch (err) { next(err); }
});

router.patch('/users/:id/deactivate', requireRole('SUPER_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ message: 'User not found' });

    if (req.user.role === 'HR_MANAGER' && target.role === 'SUPER_ADMIN') {
      return res.status(403).json({ message: 'HR Managers cannot deactivate a Super Admin account.' });
    }

    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ user });
  } catch (err) { next(err); }
});

router.get('/audit-logs', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    let where = {};
    if (req.user.role !== 'SUPER_ADMIN') {
      // Non-Super-Admins only see activity tied to their clients (or their own actions), and never
      // the money trail — payroll / wallet / access logs belong to the Super Admin.
      const scope = await getScope(req.user);
      const moneyActions = ['PAYROLL_', 'WALLET_', 'ACCESS_'];
      where = {
        AND: [
          { OR: [{ clientId: { in: scope.clientIds } }, { employee: { clientId: { in: scope.clientIds } } }, { actorUserId: req.user.id }] },
          { OR: [{ module: null }, { module: { notIn: ['PAYROLL', 'WALLET', 'ACCESS'] } }] },
          ...moneyActions.map((prefix) => ({ NOT: { action: { startsWith: prefix } } })),
        ],
      };
    }
    const logs = await prisma.activityLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        employee: { select: { firstName: true, lastName: true, employeeCode: true } },
        actor: { select: { email: true, role: true } },
      },
    });
    res.json({ logs });
  } catch (err) { next(err); }
});

export default router;

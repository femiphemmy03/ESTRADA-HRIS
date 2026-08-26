import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { lagosDateBoundary } from '../utils/timezone.js';

const router = Router();
router.use(requireAuth);

router.get('/dashboard-stats', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const today = lagosDateBoundary(new Date());
    const [totalEmployees, activeEmployees, onboardingCount, todayPresent, pendingLeaves, clientsCount] = await Promise.all([
      prisma.employee.count({ where: { archived: false } }),
      prisma.employee.count({ where: { employmentStatus: 'ACTIVE' } }),
      prisma.employee.count({ where: { employmentStatus: 'ONBOARDING' } }),
      prisma.attendance.count({ where: { date: today, status: { in: ['PRESENT', 'LATE', 'OVERTIME'] } } }),
      prisma.leaveRequest.count({ where: { status: { in: ['PENDING_MANAGER', 'PENDING_HR'] } } }),
      prisma.client.count({ where: { isActive: true } }),
    ]);
    res.json({ totalEmployees, activeEmployees, onboardingCount, todayPresent, pendingLeaves, clientsCount });
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
    const logs = await prisma.activityLog.findMany({
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

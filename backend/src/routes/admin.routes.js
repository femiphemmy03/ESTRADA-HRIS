import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/dashboard-stats', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const [totalEmployees, activeEmployees, onboardingCount, todayPresent, pendingLeaves, clientsCount] = await Promise.all([
      prisma.employee.count({ where: { archived: false } }),
      prisma.employee.count({ where: { employmentStatus: 'ACTIVE' } }),
      prisma.employee.count({ where: { employmentStatus: 'ONBOARDING' } }),
      prisma.attendance.count({ where: { date: new Date(new Date().setHours(0, 0, 0, 0)), status: { in: ['PRESENT', 'LATE', 'OVERTIME'] } } }),
      prisma.leaveRequest.count({ where: { status: { in: ['PENDING_MANAGER', 'PENDING_HR'] } } }),
      prisma.client.count({ where: { isActive: true } }),
    ]);
    res.json({ totalEmployees, activeEmployees, onboardingCount, todayPresent, pendingLeaves, clientsCount });
  } catch (err) { next(err); }
});

router.get('/users', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({ include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } } });
    res.json({ users });
  } catch (err) { next(err); }
});

router.patch('/users/:id/role', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { role } = z.object({ role: z.enum(['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD', 'EMPLOYEE']) }).parse(req.body);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { role } });
    res.json({ user });
  } catch (err) { next(err); }
});

router.patch('/users/:id/deactivate', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ user });
  } catch (err) { next(err); }
});

router.get('/audit-logs', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
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

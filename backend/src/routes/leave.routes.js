import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logActivity } from '../utils/activityLog.js';
import { sendLeaveStatusEmail } from '../lib/mailer.js';

const router = Router();
router.use(requireAuth);

// ---------- Leave Types ----------
router.get('/types', async (req, res, next) => {
  try {
    const types = await prisma.leaveType.findMany();
    res.json({ types });
  } catch (err) { next(err); }
});

router.post('/types', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({ name: z.string().min(1), defaultDaysPerYear: z.number(), isPaid: z.boolean().default(true) }).parse(req.body);
    const type = await prisma.leaveType.create({ data });
    res.status(201).json({ type });
  } catch (err) { next(err); }
});

// ---------- Balances ----------
router.get('/balances/:employeeId', async (req, res, next) => {
  try {
    const balances = await prisma.leaveBalance.findMany({ where: { employeeId: req.params.employeeId }, include: { leaveType: true } });
    res.json({ balances });
  } catch (err) { next(err); }
});

router.post('/balances', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({ employeeId: z.string(), leaveTypeId: z.string(), year: z.number(), entitledDays: z.number() }).parse(req.body);
    const balance = await prisma.leaveBalance.upsert({
      where: { employeeId_leaveTypeId_year: { employeeId: data.employeeId, leaveTypeId: data.leaveTypeId, year: data.year } },
      update: { entitledDays: data.entitledDays },
      create: data,
    });
    res.json({ balance });
  } catch (err) { next(err); }
});

// ---------- Requests ----------
const requestSchema = z.object({
  leaveTypeId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  reason: z.string().optional(),
});

router.post('/requests', async (req, res, next) => {
  try {
    const data = requestSchema.parse(req.body);
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    const days = (new Date(data.endDate) - new Date(data.startDate)) / (1000 * 60 * 60 * 24) + 1;

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: data.leaveTypeId,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        daysRequested: days,
        reason: data.reason,
      },
    });

    await logActivity({ employeeId: employee.id, actorUserId: req.user.id, action: 'LEAVE_REQUESTED', description: `Leave requested (${days} days)` });
    res.status(201).json({ leaveRequest });
  } catch (err) { next(err); }
});

router.get('/requests', async (req, res, next) => {
  try {
    const { status, employeeId } = req.query;
    const where = {
      ...(status ? { status } : {}),
      ...(employeeId ? { employeeId } : {}),
      ...(req.user.role === 'TEAM_LEAD' ? { employee: { teamLeadId: req.user.employee?.id } } : {}),
      ...(req.user.role === 'EMPLOYEE' ? { employee: { userId: req.user.id } } : {}),
    };
    const requests = await prisma.leaveRequest.findMany({
      where,
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, user: { select: { email: true } } } }, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests });
  } catch (err) { next(err); }
});

router.post('/requests/:id/manager-approve', requireRole('TEAM_LEAD', 'SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const leaveRequest = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status: 'PENDING_HR', managerApprovedById: req.user.employee?.id, managerApprovedAt: new Date() },
      include: { employee: { include: { user: true } }, leaveType: true },
    });
    res.json({ leaveRequest });
  } catch (err) { next(err); }
});

router.post('/requests/:id/hr-decision', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const { approve, rejectionReason } = z.object({ approve: z.boolean(), rejectionReason: z.string().optional() }).parse(req.body);

    const leaveRequest = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: {
        status: approve ? 'APPROVED' : 'REJECTED',
        hrApprovedById: req.user.employee?.id,
        hrApprovedAt: new Date(),
        rejectionReason: approve ? null : rejectionReason,
      },
      include: { employee: { include: { user: true } }, leaveType: true },
    });

    if (approve) {
      // Reflect on attendance: mark each day within range as ON_LEAVE
      const start = new Date(leaveRequest.startDate);
      const end = new Date(leaveRequest.endDate);
      const days = [];
      for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        days.push(new Date(d));
      }
      await prisma.$transaction(
        days.map((date) => {
          const normalized = new Date(date);
          normalized.setHours(0, 0, 0, 0);
          return prisma.attendance.upsert({
            where: { employeeId_date: { employeeId: leaveRequest.employeeId, date: normalized } },
            update: { status: 'ON_LEAVE' },
            create: { employeeId: leaveRequest.employeeId, date: normalized, status: 'ON_LEAVE' },
          });
        })
      );

      const year = start.getFullYear();
      await prisma.leaveBalance.updateMany({
        where: { employeeId: leaveRequest.employeeId, leaveTypeId: leaveRequest.leaveTypeId, year },
        data: { usedDays: { increment: leaveRequest.daysRequested } },
      });
    }

    await logActivity({ employeeId: leaveRequest.employeeId, actorUserId: req.user.id, action: 'LEAVE_DECISION', description: `Leave request ${approve ? 'approved' : 'rejected'} by HR` });

    await sendLeaveStatusEmail({
      to: leaveRequest.employee.user.email,
      firstName: leaveRequest.employee.firstName,
      status: leaveRequest.status,
      leaveType: leaveRequest.leaveType.name,
    });

    res.json({ leaveRequest });
  } catch (err) { next(err); }
});

router.post('/requests/:id/cancel', async (req, res, next) => {
  try {
    const leaveRequest = await prisma.leaveRequest.update({ where: { id: req.params.id }, data: { status: 'CANCELLED' } });
    res.json({ leaveRequest });
  } catch (err) { next(err); }
});

export default router;

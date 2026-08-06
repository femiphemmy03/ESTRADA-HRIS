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

    // No team lead assigned → skip straight to HR approval instead of getting stuck
    // waiting on a manager stage that has nobody to action it.
    const initialStatus = employee.teamLeadId ? 'PENDING_MANAGER' : 'PENDING_HR';

    const leaveRequest = await prisma.leaveRequest.create({
      data: {
        employeeId: employee.id,
        leaveTypeId: data.leaveTypeId,
        startDate: new Date(data.startDate),
        endDate: new Date(data.endDate),
        daysRequested: days,
        reason: data.reason,
        status: initialStatus,
      },
    });

    await logActivity({
      employeeId: employee.id,
      actorUserId: req.user.id,
      action: 'LEAVE_REQUESTED',
      description: `Leave requested (${days} days)${initialStatus === 'PENDING_HR' ? ' — routed directly to HR, no team lead assigned' : ''}`,
    });
    res.status(201).json({ leaveRequest });
  } catch (err) { next(err); }
});

router.get('/requests', async (req, res, next) => {
  try {
    const { status, employeeId } = req.query;
    const where = {
      ...(status ? { status } : {}),
      ...(employeeId ? { employeeId } : {}),
      // Team Leads only ever see requests from their own direct reports.
      ...(req.user.role === 'TEAM_LEAD' ? { employee: { teamLeadId: req.user.employee?.id } } : {}),
      ...(req.user.role === 'EMPLOYEE' ? { employee: { userId: req.user.id } } : {}),
    };
    const requests = await prisma.leaveRequest.findMany({
      where,
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true, teamLeadId: true, user: { select: { email: true } } } }, leaveType: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ requests });
  } catch (err) { next(err); }
});

router.post('/requests/:id/manager-approve', requireRole('TEAM_LEAD', 'SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const leaveRequest = await prisma.leaveRequest.findUnique({
      where: { id: req.params.id },
      include: { employee: true },
    });
    if (!leaveRequest) return res.status(404).json({ message: 'Leave request not found' });
    if (leaveRequest.status !== 'PENDING_MANAGER') {
      return res.status(400).json({ message: 'This request is not awaiting manager approval' });
    }

    // A Team Lead may only approve requests from their own assigned direct reports —
    // not any employee in the company. HR Admin / Super Admin keep an override for
    // cases where the assigned team lead is unavailable.
    if (req.user.role === 'TEAM_LEAD' && leaveRequest.employee.teamLeadId !== req.user.employee?.id) {
      return res.status(403).json({ message: 'You are only able to approve leave for your own direct reports' });
    }

    const updated = await prisma.leaveRequest.update({
      where: { id: req.params.id },
      data: { status: 'PENDING_HR', managerApprovedById: req.user.employee?.id, managerApprovedAt: new Date() },
      include: { employee: { include: { user: true } }, leaveType: true },
    });
    res.json({ leaveRequest: updated });
  } catch (err) { next(err); }
});

router.post('/requests/:id/hr-decision', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const { approve, rejectionReason } = z.object({ approve: z.boolean(), rejectionReason: z.string().optional() }).parse(req.body);

    const existing = await prisma.leaveRequest.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ message: 'Leave request not found' });
    if (!['PENDING_HR', 'PENDING_MANAGER'].includes(existing.status)) {
      return res.status(400).json({ message: 'This request has already been decided' });
    }

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

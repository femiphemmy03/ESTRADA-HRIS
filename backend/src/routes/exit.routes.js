import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);

const DEFAULT_CLEARANCE_TASKS = [
  'Return company ID badge',
  'Return company assets/equipment',
  'IT access revoked',
  'Handover documentation',
  'Finance clearance',
];

router.post('/initiate', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = z.object({ employeeId: z.string(), reason: z.string().optional(), lastWorkingDay: z.string().optional() }).parse(req.body);

    const exitProcess = await prisma.exitProcess.create({
      data: {
        employeeId: data.employeeId,
        reason: data.reason,
        lastWorkingDay: data.lastWorkingDay ? new Date(data.lastWorkingDay) : null,
        clearanceTasks: { create: DEFAULT_CLEARANCE_TASKS.map((label) => ({ label })) },
      },
      include: { clearanceTasks: true },
    });

    await prisma.employee.update({ where: { id: data.employeeId }, data: { employmentStatus: 'EXITING' } });
    await logActivity({ employeeId: data.employeeId, actorUserId: req.user.id, action: 'EXIT_INITIATED', description: `Exit process initiated${data.reason ? `: ${data.reason}` : ''}` });

    res.status(201).json({ exitProcess });
  } catch (err) { next(err); }
});

router.get('/:employeeId', async (req, res, next) => {
  try {
    const exitProcess = await prisma.exitProcess.findUnique({
      where: { employeeId: req.params.employeeId },
      include: { clearanceTasks: true },
    });
    res.json({ exitProcess });
  } catch (err) { next(err); }
});

router.patch('/clearance-task/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const task = await prisma.exitClearanceTask.update({
      where: { id: req.params.id },
      data: { isComplete: true, completedAt: new Date() },
    });
    res.json({ task });
  } catch (err) { next(err); }
});

router.patch('/:id/interview-notes', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const { notes } = z.object({ notes: z.string() }).parse(req.body);
    const exitProcess = await prisma.exitProcess.update({
      where: { id: req.params.id },
      data: { exitInterviewNotes: notes, status: 'INTERVIEW_DONE' },
    });
    res.json({ exitProcess });
  } catch (err) { next(err); }
});

router.patch('/:id/final-settlement', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'), async (req, res, next) => {
  try {
    const { amount } = z.object({ amount: z.number() }).parse(req.body);
    const exitProcess = await prisma.exitProcess.update({
      where: { id: req.params.id },
      data: { finalSettlementAmount: amount, status: 'FINAL_SETTLEMENT' },
    });
    res.json({ exitProcess });
  } catch (err) { next(err); }
});

router.post('/:id/complete', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const exitProcess = await prisma.exitProcess.update({
      where: { id: req.params.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
    });
    await prisma.employee.update({
      where: { id: exitProcess.employeeId },
      data: { employmentStatus: 'EXITED', archived: true },
    });
    await logActivity({ employeeId: exitProcess.employeeId, actorUserId: req.user.id, action: 'EXIT_COMPLETED', description: 'Exit process completed — employee archived' });
    res.json({ exitProcess });
  } catch (err) { next(err); }
});

export default router;

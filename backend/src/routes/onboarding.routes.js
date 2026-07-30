import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { DEFAULT_ONBOARDING_TASKS } from '../utils/onboardingTasks.js';

const router = Router();
router.use(requireAuth);

// Bulk summary for the HR/Admin Onboarding management screen — one round trip instead of
// one employee list call + N per-employee checklist calls. Must be declared before the
// "/:employeeId" route below so Express doesn't treat "summary" as an employeeId param.
router.get('/summary', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: 'ONBOARDING', archived: false },
      include: { client: true, site: true },
      orderBy: { createdAt: 'desc' },
    });

    const employeeIds = employees.map((e) => e.id);
    const grouped = employeeIds.length
      ? await prisma.onboardingTask.groupBy({
          by: ['employeeId', 'isComplete'],
          where: { employeeId: { in: employeeIds } },
          _count: { _all: true },
        })
      : [];

    const progress = {};
    for (const id of employeeIds) progress[id] = { done: 0, total: 0 };
    for (const row of grouped) {
      progress[row.employeeId].total += row._count._all;
      if (row.isComplete) progress[row.employeeId].done += row._count._all;
    }

    res.json({ employees, progress });
  } catch (err) { next(err); }
});

// Idempotent: if this employee already has checklist tasks (e.g. auto-created on invite),
// this just returns them instead of creating duplicates. Safe to call again for employees
// who were invited before onboarding auto-init existed.
router.post('/:employeeId/initialize', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const existing = await prisma.onboardingTask.findMany({ where: { employeeId: req.params.employeeId }, orderBy: { order: 'asc' } });
    if (existing.length > 0) {
      return res.status(200).json({ tasks: existing, alreadyInitialized: true });
    }
    const tasks = await prisma.$transaction(
      DEFAULT_ONBOARDING_TASKS.map((label, i) =>
        prisma.onboardingTask.create({ data: { employeeId: req.params.employeeId, label, order: i } })
      )
    );
    res.status(201).json({ tasks, alreadyInitialized: false });
  } catch (err) { next(err); }
});

router.get('/:employeeId', async (req, res, next) => {
  try {
    const tasks = await prisma.onboardingTask.findMany({ where: { employeeId: req.params.employeeId }, orderBy: { order: 'asc' } });
    res.json({ tasks });
  } catch (err) { next(err); }
});

router.patch('/task/:id/complete', async (req, res, next) => {
  try {
    const task = await prisma.onboardingTask.update({
      where: { id: req.params.id },
      data: { isComplete: true, completedAt: new Date() },
    });
    res.json({ task });
  } catch (err) { next(err); }
});

export default router;

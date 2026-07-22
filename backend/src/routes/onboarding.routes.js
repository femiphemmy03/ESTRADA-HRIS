import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { DEFAULT_ONBOARDING_TASKS } from '../utils/onboardingTasks.js';

const router = Router();
router.use(requireAuth);

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

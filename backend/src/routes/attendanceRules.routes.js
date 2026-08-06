import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

router.get('/', async (req, res, next) => {
  try {
    const rules = await prisma.attendanceRule.findMany({ include: { site: true } });
    res.json({ rules });
  } catch (err) { next(err); }
});

const ruleSchema = z.object({
  siteId: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  name: z.string().min(1),
  workingDays: z.string().default('MON,TUE,WED,THU,FRI'),
  remoteDays: z.string().optional().default(''), // csv subset of workingDays that are WFH — GPS check skipped
  shiftStart: z.string(),
  shiftEnd: z.string(),
  gracePeriodMinutes: z.number().default(15),
  minimumHours: z.number().default(8),
  halfDayHours: z.number().default(4),
  overtimeThresholdHours: z.number().default(9),
  gpsRadiusMeters: z.number().default(150),
  latePolicy: z.string().optional(),
  earlyCheckoutPolicy: z.string().optional(),
  weekendPolicy: z.string().optional(),
  holidayPolicy: z.string().optional(),
  requiresApproval: z.boolean().default(false),
});

router.post('/', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = ruleSchema.parse(req.body);
    const rule = await prisma.attendanceRule.create({ data });
    res.status(201).json({ rule });
  } catch (err) { next(err); }
});

// Full edit — same validated shape as create, so a rule can be updated in place
// instead of deleted + recreated (which would have orphaned any site pointing at it).
router.patch('/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = ruleSchema.partial().parse(req.body);
    const rule = await prisma.attendanceRule.update({ where: { id: req.params.id }, data });
    res.json({ rule });
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    await prisma.attendanceRule.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;

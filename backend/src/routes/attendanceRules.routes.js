import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getScope, inScope } from '../utils/clientScope.js';
import { httpError } from '../utils/httpError.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);
const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'];

/**
 * Rules can apply to: one SITE, a whole CLIENT (every site of that client without its own rule),
 * or be the company-wide DEFAULT. Super Admin manages everything; HR roles can only create/edit/delete
 * rules for the clients (or sites of the clients) assigned to them, and never the company default.
 */
async function clientIdOfRule(rule) {
  if (rule.clientId) return rule.clientId;
  if (rule.siteId) {
    const site = await prisma.site.findUnique({ where: { id: rule.siteId }, select: { clientId: true } });
    return site?.clientId || null;
  }
  return null; // company default
}

async function assertCanManage(req, rule) {
  if (req.user.role === 'SUPER_ADMIN') return;
  const clientId = await clientIdOfRule(rule);
  if (!clientId) throw httpError(403, 'Only the Super Admin can manage the company-wide default rule.');
  const scope = await getScope(req.user);
  if (!inScope(scope, clientId)) throw httpError(403, 'You are not assigned to this client.');
}

router.get('/', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const rules = await prisma.attendanceRule.findMany({
      where: scope.all
        ? {}
        : { OR: [{ isDefault: true }, { clientId: { in: scope.clientIds } }, { site: { clientId: { in: scope.clientIds } } }] },
      include: { site: { include: { client: { select: { id: true, name: true } } } }, client: { select: { id: true, name: true } } },
    });
    res.json({ rules });
  } catch (err) { next(err); }
});

const ruleSchema = z.object({
  siteId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  isDefault: z.boolean().optional(),
  name: z.string().min(1),
  workingDays: z.string().default('MON,TUE,WED,THU,FRI'),
  remoteDays: z.string().default(''),
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
  requiredDaysPerMonth: z.number().int().min(1).max(31).optional().nullable(),
  prorateSalary: z.boolean().optional(),
});

function validateShape(data) {
  if (data.siteId && data.clientId) throw httpError(400, 'A rule applies to either a site or a whole client, not both.');
  if (data.prorateSalary && !data.requiredDaysPerMonth) {
    throw httpError(400, 'Enter the required number of present days per month to turn on salary proration.');
  }
  if (data.isDefault && (data.siteId || data.clientId)) {
    throw httpError(400, 'The company-wide default rule cannot be tied to a site or client.');
  }
}

function friendlyConflict(err) {
  if (err.code === 'P2002') {
    const target = String(err.meta?.target ?? '');
    if (target.includes('clientId')) return httpError(409, 'This client already has an attendance rule. Edit it instead.');
    if (target.includes('siteId')) return httpError(409, 'This site already has an attendance rule. Edit it instead.');
  }
  return err;
}

router.post('/', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const data = ruleSchema.parse(req.body);
    validateShape(data);
    await assertCanManage(req, data);
    const rule = await prisma.attendanceRule.create({ data: { ...data, siteId: data.siteId || null, clientId: data.clientId || null } });
    await logActivity({ actorUserId: req.user.id, action: 'ATTENDANCE_RULE_CREATED', description: `Attendance rule "${rule.name}" created`, module: 'ATTENDANCE', clientId: rule.clientId || undefined, metadata: { ruleId: rule.id, requiredDaysPerMonth: rule.requiredDaysPerMonth, prorateSalary: rule.prorateSalary } });
    res.status(201).json({ rule });
  } catch (err) { next(friendlyConflict(err)); }
});

router.patch('/:id', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.attendanceRule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Rule not found');
    await assertCanManage(req, existing);

    const data = ruleSchema.partial().parse(req.body);
    const merged = { ...existing, ...data };
    validateShape(merged);
    if (req.user.role !== 'SUPER_ADMIN') await assertCanManage(req, merged); // can't move a rule onto a client you don't have

    const rule = await prisma.attendanceRule.update({
      where: { id: req.params.id },
      data: { ...data, ...(data.siteId !== undefined ? { siteId: data.siteId || null } : {}), ...(data.clientId !== undefined ? { clientId: data.clientId || null } : {}) },
    });
    await logActivity({ actorUserId: req.user.id, action: 'ATTENDANCE_RULE_UPDATED', description: `Attendance rule "${rule.name}" updated`, module: 'ATTENDANCE', clientId: rule.clientId || undefined, metadata: { ruleId: rule.id, changes: data } });
    res.json({ rule });
  } catch (err) { next(friendlyConflict(err)); }
});

router.delete('/:id', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const existing = await prisma.attendanceRule.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Rule not found');
    await assertCanManage(req, existing);
    await prisma.attendanceRule.delete({ where: { id: req.params.id } });
    await logActivity({ actorUserId: req.user.id, action: 'ATTENDANCE_RULE_DELETED', description: `Attendance rule "${existing.name}" deleted`, module: 'ATTENDANCE', clientId: existing.clientId || undefined });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;

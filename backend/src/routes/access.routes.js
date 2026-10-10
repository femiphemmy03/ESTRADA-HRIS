import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { SCOPED_ADMIN_ROLES } from '../utils/clientScope.js';
import { logAccess } from '../utils/activityLog.js';
import { notifyUsers } from '../utils/notify.js';

/**
 * CLIENT ACCESS — Super Admin only.
 * Decides which clients each HR Admin / HR Manager / Payroll Officer works on, and whether
 * they may fund that client's wallet. Everything else in the HRIS is scoped from this.
 */
const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN'));

router.get('/', async (req, res, next) => {
  try {
    const [clients, admins] = await Promise.all([
      prisma.client.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.user.findMany({
        where: { role: { in: SCOPED_ADMIN_ROLES } },
        orderBy: { email: 'asc' },
        select: {
          id: true,
          email: true,
          role: true,
          isActive: true,
          employee: { select: { firstName: true, lastName: true, employeeCode: true } },
          clientAssignments: { select: { clientId: true, canFund: true } },
        },
      }),
    ]);
    res.json({ clients, admins });
  } catch (err) { next(err); }
});

const assignSchema = z.object({
  assignments: z.array(z.object({ clientId: z.string(), canFund: z.boolean().default(true) })).max(500),
});

router.put('/users/:userId', async (req, res, next) => {
  try {
    const { assignments } = assignSchema.parse(req.body);
    const target = await prisma.user.findUnique({
      where: { id: req.params.userId },
      include: { clientAssignments: { include: { client: { select: { name: true } } } } },
    });
    if (!target) return res.status(404).json({ message: 'User not found' });
    if (!SCOPED_ADMIN_ROLES.includes(target.role)) {
      return res.status(400).json({ message: 'Client access only applies to HR Admin, HR Manager and Payroll Officer accounts.' });
    }

    const uniqueIds = [...new Set(assignments.map((a) => a.clientId))];
    const validClients = await prisma.client.findMany({ where: { id: { in: uniqueIds } }, select: { id: true, name: true } });
    const validIds = new Set(validClients.map((c) => c.id));
    const rows = assignments.filter((a, i, arr) => validIds.has(a.clientId) && arr.findIndex((x) => x.clientId === a.clientId) === i);

    await prisma.$transaction([
      prisma.clientAssignment.deleteMany({ where: { userId: target.id } }),
      prisma.clientAssignment.createMany({
        data: rows.map((a) => ({ userId: target.id, clientId: a.clientId, canFund: a.canFund, assignedById: req.user.id })),
      }),
    ]);

    const nameOf = new Map(validClients.map((c) => [c.id, c.name]));
    await logAccess(req, {
      action: 'ACCESS_CLIENTS_ASSIGNED',
      description: `${target.email} now assigned to ${rows.length} client(s): ${rows.map((r) => `${nameOf.get(r.clientId)}${r.canFund ? '' : ' (no funding)'}`).join(', ') || 'none'}`,
      metadata: {
        userId: target.id,
        before: target.clientAssignments.map((a) => ({ client: a.client.name, canFund: a.canFund })),
        after: rows.map((r) => ({ client: nameOf.get(r.clientId), canFund: r.canFund })),
      },
    });
    await notifyUsers([target.id], { title: 'Your client access was updated', message: `You are now assigned to ${rows.length} client(s). Sign out and back in if you don't see the change.`, link: '/dashboard' });

    res.json({ assignments: rows });
  } catch (err) { next(err); }
});

export default router;

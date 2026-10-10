import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getScope, assertClientAccess, clientWhere } from '../utils/clientScope.js';
import { ensureClientWallet } from '../utils/wallet.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);
const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'];

// Everyone only ever sees the clients they're entitled to: Super Admin = all, HR roles = assigned
// clients, Team Lead / Employee = their own client.
router.get('/', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const clients = await prisma.client.findMany({
      where: scope.all ? {} : { id: { in: scope.clientIds } },
      include: { sites: true },
    });
    res.json({ clients });
  } catch (err) { next(err); }
});

// Creating/editing clients is a Super Admin decision — clients drive wallets, admin assignments and payroll.
const clientSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().optional(),
});

router.post('/', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const data = clientSchema.parse(req.body);
    const client = await prisma.client.create({ data });
    try {
      await ensureClientWallet(client.id);
    } catch (walletErr) {
      console.error('[clients] wallet creation deferred:', walletErr.message); // created lazily on first use
    }
    await logActivity({ actorUserId: req.user.id, action: 'CLIENT_CREATED', description: `Client "${client.name}" created`, module: 'CLIENTS', clientId: client.id });
    res.status(201).json({ client });
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const data = clientSchema.partial().extend({ isActive: z.boolean().optional() }).parse(req.body);
    const client = await prisma.client.update({ where: { id: req.params.id }, data });
    await logActivity({ actorUserId: req.user.id, action: 'CLIENT_UPDATED', description: `Client "${client.name}" updated`, module: 'CLIENTS', clientId: client.id, metadata: data });
    res.json({ client });
  } catch (err) { next(err); }
});

router.get('/sites/all', async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const sites = await prisma.site.findMany({
      where: clientWhere(scope, 'clientId'),
      include: { client: true, attendanceRule: true },
    });
    res.json({ sites });
  } catch (err) { next(err); }
});

router.get('/:clientId/sites', async (req, res, next) => {
  try {
    await assertClientAccess(req.user, req.params.clientId);
    const sites = await prisma.site.findMany({ where: { clientId: req.params.clientId }, include: { attendanceRule: true } });
    res.json({ sites });
  } catch (err) { next(err); }
});

const siteSchema = z.object({
  clientId: z.string(),
  name: z.string().min(1),
  address: z.string().optional(),
  latitude: z.number(),
  longitude: z.number(),
  radiusMeters: z.number().optional(),
  shift: z.string().optional(),
});

router.post('/sites', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const data = siteSchema.parse(req.body);
    await assertClientAccess(req.user, data.clientId);
    const isPrivileged = ADMIN_ROLES.includes(req.user.role);
    const site = await prisma.site.create({
      data: {
        ...data,
        proposedById: req.user.employee?.id,
        approvalStatus: isPrivileged ? 'APPROVED' : 'PENDING',
        approvedById: isPrivileged ? req.user.employee?.id : null,
      },
    });
    res.status(201).json({ site });
  } catch (err) { next(err); }
});

async function loadSiteForDecision(req, res) {
  const site = await prisma.site.findUnique({ where: { id: req.params.id } });
  if (!site) {
    res.status(404).json({ message: 'Site not found' });
    return null;
  }
  await assertClientAccess(req.user, site.clientId);
  return site;
}

router.post('/sites/:id/approve', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    if (!(await loadSiteForDecision(req, res))) return;
    const site = await prisma.site.update({
      where: { id: req.params.id },
      data: { approvalStatus: 'APPROVED', approvedById: req.user.employee?.id },
    });
    res.json({ site });
  } catch (err) { next(err); }
});

router.post('/sites/:id/reject', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    if (!(await loadSiteForDecision(req, res))) return;
    const site = await prisma.site.update({ where: { id: req.params.id }, data: { approvalStatus: 'REJECTED' } });
    res.json({ site });
  } catch (err) { next(err); }
});

export default router;

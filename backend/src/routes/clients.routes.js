import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ---------- Clients ----------
router.get('/', async (req, res, next) => {
  try {
    const clients = await prisma.client.findMany({ include: { sites: true } });
    res.json({ clients });
  } catch (err) { next(err); }
});

router.post('/', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = z
      .object({ name: z.string().min(1), contactName: z.string().optional(), contactEmail: z.string().email().optional(), contactPhone: z.string().optional() })
      .parse(req.body);
    const client = await prisma.client.create({ data });
    res.status(201).json({ client });
  } catch (err) { next(err); }
});

router.patch('/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const client = await prisma.client.update({ where: { id: req.params.id }, data: req.body });
    res.json({ client });
  } catch (err) { next(err); }
});

// ---------- Sites ----------
router.get('/:clientId/sites', async (req, res, next) => {
  try {
    const sites = await prisma.site.findMany({ where: { clientId: req.params.clientId }, include: { attendanceRule: true } });
    res.json({ sites });
  } catch (err) { next(err); }
});

router.get('/sites/all', async (req, res, next) => {
  try {
    const sites = await prisma.site.findMany({ include: { client: true, attendanceRule: true } });
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

// Team Lead proposes a new site (pending HR approval), or HR/Admin creates one directly (auto-approved)
router.post('/sites', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const data = siteSchema.parse(req.body);
    const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role);
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

router.post('/sites/:id/approve', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const site = await prisma.site.update({
      where: { id: req.params.id },
      data: { approvalStatus: 'APPROVED', approvedById: req.user.employee?.id },
    });
    res.json({ site });
  } catch (err) { next(err); }
});

router.post('/sites/:id/reject', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const site = await prisma.site.update({ where: { id: req.params.id }, data: { approvalStatus: 'REJECTED' } });
    res.json({ site });
  } catch (err) { next(err); }
});

export default router;

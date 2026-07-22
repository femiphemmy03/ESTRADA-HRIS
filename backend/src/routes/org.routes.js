import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';

const router = Router();
router.use(requireAuth);

// ---------- Departments ----------
router.get('/departments', async (req, res, next) => {
  try {
    const departments = await prisma.department.findMany({ include: { positions: true } });
    res.json({ departments });
  } catch (err) { next(err); }
});

router.post('/departments', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body);
    const department = await prisma.department.create({ data: { name } });
    res.status(201).json({ department });
  } catch (err) { next(err); }
});

router.delete('/departments/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    await prisma.department.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------- Positions ----------
router.get('/positions', async (req, res, next) => {
  try {
    const positions = await prisma.position.findMany({ include: { department: true } });
    res.json({ positions });
  } catch (err) { next(err); }
});

router.post('/positions', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const { title, departmentId } = z
      .object({ title: z.string().min(1), departmentId: z.string().optional() })
      .parse(req.body);
    const position = await prisma.position.create({ data: { title, departmentId } });
    res.status(201).json({ position });
  } catch (err) { next(err); }
});

router.delete('/positions/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    await prisma.position.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;

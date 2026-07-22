import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);

// List / search employees
router.get('/', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const { q, departmentId, clientId, siteId, employmentStatus, archived } = req.query;
    const employees = await prisma.employee.findMany({
      where: {
        archived: archived === 'true',
        ...(departmentId ? { departmentId } : {}),
        ...(clientId ? { clientId } : {}),
        ...(siteId ? { siteId } : {}),
        ...(employmentStatus ? { employmentStatus } : {}),
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { employeeCode: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
        // Team Leads only see their own site's employees
        ...(req.user.role === 'TEAM_LEAD' ? { teamLeadId: req.user.employee?.id } : {}),
      },
      include: { department: true, position: true, client: true, site: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ employees });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({
      where: { id: req.params.id },
      include: {
        department: true,
        position: true,
        client: true,
        site: true,
        educationHistory: true,
        employmentHistory: true,
        documents: { include: { documentType: true } },
        onboardingTasks: { orderBy: { order: 'asc' } },
      },
    });
    if (!employee) return res.status(404).json({ message: 'Employee not found' });
    res.json({ employee });
  } catch (err) {
    next(err);
  }
});

const updateSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  middleName: z.string().optional(),
  phone: z.string().optional(),
  gender: z.string().optional(),
  dateOfBirth: z.string().optional(),
  address: z.string().optional(),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  clientId: z.string().optional(),
  siteId: z.string().optional(),
  teamLeadId: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelationship: z.string().optional(),
  nextOfKinName: z.string().optional(),
  nextOfKinPhone: z.string().optional(),
  nextOfKinRelationship: z.string().optional(),
  bankName: z.string().optional(),
  bankAccountNumber: z.string().optional(),
  bankAccountName: z.string().optional(),
  pensionRSA: z.string().optional(),
  pensionAdmin: z.string().optional(),
});

// Employee completes/edits their own biodata, or HR edits any profile
router.patch('/:id', async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const target = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ message: 'Employee not found' });

    const isSelf = target.userId === req.user.id;
    const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role);
    if (!isSelf && !isPrivileged) return res.status(403).json({ message: 'Not permitted' });

    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { ...data, dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : undefined },
    });

    await logActivity({
      employeeId: employee.id,
      actorUserId: req.user.id,
      action: 'PROFILE_UPDATED',
      description: isSelf ? 'Employee updated their biodata' : 'HR updated employee profile',
    });

    res.json({ employee });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/submit-onboarding', async (req, res, next) => {
  try {
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { onboardingStatus: 'SUBMITTED' },
    });
    await logActivity({ employeeId: employee.id, actorUserId: req.user.id, action: 'ONBOARDING_SUBMITTED', description: 'Employee submitted onboarding for HR review' });
    res.json({ employee });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/approve-onboarding', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { onboardingStatus: 'APPROVED', employmentStatus: 'ACTIVE', dateHired: new Date() },
    });
    await logActivity({ employeeId: employee.id, actorUserId: req.user.id, action: 'ONBOARDING_APPROVED', description: 'HR approved onboarding — employee is now Active' });
    res.json({ employee });
  } catch (err) {
    next(err);
  }
});

router.post('/:id/archive', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const employee = await prisma.employee.update({
      where: { id: req.params.id },
      data: { archived: true, employmentStatus: 'EXITED' },
    });
    await logActivity({ employeeId: employee.id, actorUserId: req.user.id, action: 'EMPLOYEE_ARCHIVED', description: 'Employee record archived' });
    res.json({ employee });
  } catch (err) {
    next(err);
  }
});

router.get('/:id/timeline', async (req, res, next) => {
  try {
    const logs = await prisma.activityLog.findMany({
      where: { employeeId: req.params.id },
      orderBy: { createdAt: 'desc' },
      include: { actor: { select: { email: true, role: true } } },
    });
    res.json({ logs });
  } catch (err) {
    next(err);
  }
});

export default router;

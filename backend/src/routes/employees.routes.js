import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);

const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'];

router.get('/', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
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

router.get('/eligible-team-leads', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const { siteId, excludeEmployeeId } = req.query;
    const candidates = await prisma.employee.findMany({
      where: {
        archived: false,
        ...(excludeEmployeeId ? { id: { not: excludeEmployeeId } } : {}),
        OR: [
          { user: { role: { in: ['HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'] } } },
          { user: { role: 'TEAM_LEAD' }, ...(siteId ? { siteId } : {}) },
        ],
      },
      include: { user: { select: { role: true } } },
      orderBy: { firstName: 'asc' },
    });
    res.json({ candidates });
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
        teamLead: { select: { id: true, firstName: true, lastName: true } },
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
  departmentId: z.string().optional().nullable(),
  positionId: z.string().optional().nullable(),
  clientId: z.string().optional().nullable(),
  siteId: z.string().optional().nullable(),
  teamLeadId: z.string().optional().nullable(),
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

router.patch('/:id', async (req, res, next) => {
  try {
    const data = updateSchema.parse(req.body);
    const target = await prisma.employee.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ message: 'Employee not found' });

    const isSelf = target.userId === req.user.id;
    const isPrivileged = ADMIN_ROLES.includes(req.user.role);
    if (!isSelf && !isPrivileged) return res.status(403).json({ message: 'Not permitted' });

    if (data.teamLeadId) {
      if (data.teamLeadId === target.id) {
        return res.status(400).json({ message: 'An employee cannot be their own team lead' });
      }
      const candidate = await prisma.employee.findUnique({
        where: { id: data.teamLeadId },
        include: { user: { select: { role: true } } },
      });
      if (!candidate || !['TEAM_LEAD', 'HR_ADMIN', 'HR_MANAGER', 'SUPER_ADMIN'].includes(candidate.user.role)) {
        return res.status(400).json({ message: 'Selected team lead must have the Team Lead, HR Admin, HR Manager, or Super Admin role' });
      }
    }

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

router.post('/:id/approve-onboarding', requireRole(...ADMIN_ROLES), async (req, res, next) => {
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

router.post('/:id/archive', requireRole(...ADMIN_ROLES), async (req, res, next) => {
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

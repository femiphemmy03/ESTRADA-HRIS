import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/jwt.js';
import { sendOnboardingInvite } from '../lib/mailer.js';
import { logActivity } from '../utils/activityLog.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { env } from '../config/env.js';
import { DEFAULT_ONBOARDING_TASKS } from '../utils/onboardingTasks.js';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email }, include: { employee: true } });
    if (!user || !user.passwordHash) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.isActive) return res.status(403).json({ message: 'Account is deactivated' });

    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    const refreshToken = signRefreshToken({ sub: user.id, v: user.refreshTokenVersion });

    res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        employeeId: user.employee?.id ?? null,
        mustSetPassword: user.mustSetPassword,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.post('/refresh', async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).json({ message: 'refreshToken is required' });
    const decoded = verifyRefreshToken(refreshToken);
    const user = await prisma.user.findUnique({ where: { id: decoded.sub } });
    if (!user || user.refreshTokenVersion !== decoded.v) {
      return res.status(401).json({ message: 'Invalid refresh token' });
    }
    const accessToken = signAccessToken({ sub: user.id, role: user.role });
    res.json({ accessToken });
  } catch (err) {
    res.status(401).json({ message: 'Invalid or expired refresh token' });
  }
});

// HR/Super Admin creates a new employee shell + sends onboarding invite.
const inviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  role: z.enum(['HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD', 'EMPLOYEE']).default('EMPLOYEE'),
  departmentId: z.string().optional(),
  positionId: z.string().optional(),
  clientId: z.string().optional(),
  siteId: z.string().optional(),
});

router.post('/invite', requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = inviteSchema.parse(req.body);
    const invitationToken = crypto.randomBytes(32).toString('hex');
    const invitationExpiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const employeeCode = `EST-${new Date().getFullYear()}-${String(
      (await prisma.employee.count()) + 1
    ).padStart(4, '0')}`;

    const user = await prisma.user.create({
      data: {
        email: data.email,
        role: data.role,
        invitationToken,
        invitationExpiresAt,
        employee: {
          create: {
            employeeCode,
            firstName: data.firstName,
            lastName: data.lastName,
            departmentId: data.departmentId,
            positionId: data.positionId,
            clientId: data.clientId,
            siteId: data.siteId,
            onboardingStatus: 'INVITED',
            employmentStatus: 'ONBOARDING',
          },
        },
      },
      include: { employee: true },
    });

    await logActivity({
      employeeId: user.employee.id,
      actorUserId: req.user.id,
      action: 'INVITATION_SENT',
      description: `${data.firstName} ${data.lastName} was invited to onboard`,
    });

    // Auto-create the onboarding checklist so it's ready the moment the employee logs in,
    // and so HR/Admin can see progress immediately without a separate manual step.
    await prisma.onboardingTask.createMany({
      data: DEFAULT_ONBOARDING_TASKS.map((label, i) => ({ employeeId: user.employee.id, label, order: i })),
    });

    const invitationLink = `${env.frontendUrl}/onboarding/set-password?token=${invitationToken}`;
    await sendOnboardingInvite({ to: data.email, firstName: data.firstName, invitationLink });

    res.status(201).json({ employee: user.employee });
  } catch (err) {
    next(err);
  }
});

const setPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8),
});

router.post('/set-password', async (req, res, next) => {
  try {
    const { token, password } = setPasswordSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { invitationToken: token }, include: { employee: true } });

    if (!user) {
      return res.status(400).json({ message: 'This invitation link is not valid. Please check the link or ask HR to resend your invitation.' });
    }
    if (!user.mustSetPassword) {
      return res.status(400).json({ message: 'This invitation link has already been used. Please log in instead — if you need a password reset, contact HR.' });
    }
    if (!user.invitationExpiresAt || user.invitationExpiresAt < new Date()) {
      return res.status(400).json({ message: 'This invitation link has expired (links are valid for 72 hours). Please ask HR to resend your invitation.' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, mustSetPassword: false },
    });
    await prisma.employee.update({
      where: { id: user.employee.id },
      data: { onboardingStatus: 'ACCOUNT_CREATED' },
    });
    await logActivity({
      employeeId: user.employee.id,
      action: 'ACCOUNT_CREATED',
      description: 'Employee created their password and logged in for the first time',
    });
    res.json({ message: 'Password set successfully. You may now log in.' });
  } catch (err) {
    next(err);
  }
});

router.get('/me', requireAuth, async (req, res) => {
  const employee = await prisma.employee.findUnique({
    where: { userId: req.user.id },
    include: { department: true, position: true, client: true, site: true },
  });
  res.json({ user: { id: req.user.id, email: req.user.email, role: req.user.role }, employee });
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { distanceInMeters } from '../utils/geo.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);

const WEEKDAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
function todayCode(date) {
  return WEEKDAY_CODES[date.getDay()];
}

async function getRuleForEmployee(employee) {
  if (employee.siteId) {
    const siteRule = await prisma.attendanceRule.findUnique({ where: { siteId: employee.siteId } });
    if (siteRule) return siteRule;
  }
  return prisma.attendanceRule.findFirst({ where: { isDefault: true } });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function parseHHMM(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

const checkInSchema = z.object({ latitude: z.number(), longitude: z.number() });

router.post('/check-in', async (req, res, next) => {
  try {
    const { latitude, longitude } = checkInSchema.parse(req.body);
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id }, include: { site: true } });
    if (!employee) return res.status(404).json({ message: 'Employee profile not found' });
    if (!employee.site) return res.status(400).json({ message: 'You are not assigned to a site yet' });

    const rule = await getRuleForEmployee(employee);
    if (!rule) return res.status(400).json({ message: 'No attendance rule configured for your site' });

    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Hybrid support: if today is a configured remote/WFH day for this rule, skip the
    // geofence check entirely — location is still recorded for reference, just not enforced.
    const remoteDayCodes = (rule.remoteDays || '').split(',').map((d) => d.trim()).filter(Boolean);
    const isRemoteDay = remoteDayCodes.includes(todayCode(now));
    const workMode = isRemoteDay ? 'REMOTE' : 'ONSITE';

    if (!isRemoteDay) {
      const distance = distanceInMeters(latitude, longitude, employee.site.latitude, employee.site.longitude);
      const withinRadius = distance <= rule.gpsRadiusMeters;
      if (!withinRadius) {
        return res.status(403).json({
          message: `You are approximately ${Math.round(distance).toLocaleString()}m from ${employee.site.name}. Allowed check-in radius is ${rule.gpsRadiusMeters}m.`,
          distanceMeters: Math.round(distance),
          allowedRadiusMeters: rule.gpsRadiusMeters,
        });
      }
    }

    const shiftStartMin = parseHHMM(rule.shiftStart);
    const nowMin = minutesSinceMidnight(now);
    const status = nowMin > shiftStartMin + rule.gracePeriodMinutes ? 'LATE' : 'PRESENT';

    const attendance = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      update: { checkInAt: now, checkInLat: latitude, checkInLng: longitude, status, siteId: employee.siteId, workMode },
      create: {
        employeeId: employee.id,
        siteId: employee.siteId,
        date: today,
        checkInAt: now,
        checkInLat: latitude,
        checkInLng: longitude,
        status,
        workMode,
      },
    });

    res.status(201).json({ attendance });
  } catch (err) { next(err); }
});

router.post('/check-out', async (req, res, next) => {
  try {
    const { latitude, longitude } = checkInSchema.parse(req.body);
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id }, include: { site: true } });
    if (!employee) return res.status(404).json({ message: 'Employee profile not found' });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existing = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: today } } });
    if (!existing || !existing.checkInAt) {
      return res.status(400).json({ message: 'You have not checked in today' });
    }

    const rule = await getRuleForEmployee(employee);
    const now = new Date();
    const hoursWorked = (now - new Date(existing.checkInAt)) / (1000 * 60 * 60);

    let status = existing.status;
    if (rule) {
      const shiftEndMin = parseHHMM(rule.shiftEnd);
      const nowMin = minutesSinceMidnight(now);
      if (nowMin < shiftEndMin) status = 'EARLY_DEPARTURE';
      else if (hoursWorked >= rule.overtimeThresholdHours) status = 'OVERTIME';
      else if (hoursWorked < rule.halfDayHours) status = 'HALF_DAY';
    }

    const attendance = await prisma.attendance.update({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      data: {
        checkOutAt: now,
        checkOutLat: latitude,
        checkOutLng: longitude,
        hoursWorked: Math.round(hoursWorked * 100) / 100,
        status,
      },
    });

    res.json({ attendance });
  } catch (err) { next(err); }
});

router.get('/me', async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    const { from, to } = req.query;
    const attendances = await prisma.attendance.findMany({
      where: {
        employeeId: employee.id,
        ...(from && to ? { date: { gte: new Date(from), lte: new Date(to) } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    res.json({ attendances });
  } catch (err) { next(err); }
});

router.get('/', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const { employeeId, siteId, from, to } = req.query;
    const attendances = await prisma.attendance.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        ...(siteId ? { siteId } : {}),
        ...(from && to ? { date: { gte: new Date(from), lte: new Date(to) } } : {}),
      },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } }, site: true },
      orderBy: { date: 'desc' },
    });
    res.json({ attendances });
  } catch (err) { next(err); }
});

// HR/Payroll can manually mark a day (e.g. approved WFH, absence correction)
const manualSchema = z.object({
  employeeId: z.string(),
  date: z.string(),
  status: z.enum(['PRESENT', 'LATE', 'EARLY_DEPARTURE', 'HALF_DAY', 'ABSENT', 'WEEKEND', 'PUBLIC_HOLIDAY', 'ON_LEAVE', 'MISSING_CHECKOUT', 'OVERTIME']),
  notes: z.string().optional(),
});

router.post('/manual', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = manualSchema.parse(req.body);
    const date = new Date(data.date);
    date.setHours(0, 0, 0, 0);
    const attendance = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: data.employeeId, date } },
      update: { status: data.status, notes: data.notes },
      create: { employeeId: data.employeeId, date, status: data.status, notes: data.notes },
    });
    await logActivity({ employeeId: data.employeeId, actorUserId: req.user.id, action: 'ATTENDANCE_MANUAL_EDIT', description: `Attendance manually set to ${data.status}` });
    res.json({ attendance });
  } catch (err) { next(err); }
});

export default router;

import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { distanceInMeters } from '../utils/geo.js';
import { logActivity } from '../utils/activityLog.js';
import { nowInLagos, minutesSinceMidnightLagos, lagosDateBoundary } from '../utils/timezone.js';
import { getRuleForEmployee } from '../utils/attendanceRules.js';

const router = Router();
router.use(requireAuth);

const WEEKDAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

function todayCodeLagos(date = new Date()) {
  const weekdayName = new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Lagos', weekday: 'short' })
    .format(date)
    .toUpperCase();
  return WEEKDAY_CODES.find((c) => weekdayName.startsWith(c)) || WEEKDAY_CODES[date.getDay()];
}

function parseHHMM(str) {
  const [h, m] = str.split(':').map(Number);
  return h * 60 + m;
}

function isRemoteDay(rule, date) {
  const code = todayCodeLagos(date);
  const remoteDays = (rule.remoteDays || '').split(',').filter(Boolean);
  return remoteDays.includes(code);
}

// Converts a "YYYY-MM-DD" query-string date (as typed/picked in the browser) into the
// correct Lagos-midnight UTC instant — the same reference point attendance rows are
// stored with. Using `new Date(dateString)` directly (UTC midnight) was the bug: it
// silently never matched Lagos-boundary-stored rows, making "today" queries return
// nothing even though the data was there.
function parseLagosDateParam(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return lagosDateBoundary(new Date(Date.UTC(y, m - 1, d, 12))); // noon UTC avoids any DST/edge ambiguity
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
    const remote = isRemoteDay(rule, now);

    if (!remote) {
      const distance = distanceInMeters(latitude, longitude, employee.site.latitude, employee.site.longitude);
      if (distance > rule.gpsRadiusMeters) {
        return res.status(403).json({
          message: `You are approximately ${Math.round(distance).toLocaleString()}m from ${employee.site.name}. Allowed check-in radius is ${rule.gpsRadiusMeters}m.`,
          distanceMeters: Math.round(distance),
          allowedRadiusMeters: rule.gpsRadiusMeters,
        });
      }
    }

    const today = lagosDateBoundary(now);
    const shiftStartMin = parseHHMM(rule.shiftStart);
    const nowMin = minutesSinceMidnightLagos(now);
    const status = nowMin > shiftStartMin + rule.gracePeriodMinutes ? 'LATE' : 'PRESENT';

    const attendance = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: employee.id, date: today } },
      update: { checkInAt: now, checkInLat: latitude, checkInLng: longitude, status, siteId: employee.siteId, workMode: remote ? 'REMOTE' : 'ONSITE' },
      create: {
        employeeId: employee.id,
        siteId: employee.siteId,
        date: today,
        checkInAt: now,
        checkInLat: latitude,
        checkInLng: longitude,
        status,
        workMode: remote ? 'REMOTE' : 'ONSITE',
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

    const now = new Date();
    const today = lagosDateBoundary(now);

    const existing = await prisma.attendance.findUnique({ where: { employeeId_date: { employeeId: employee.id, date: today } } });
    if (!existing || !existing.checkInAt) {
      return res.status(400).json({ message: 'You have not checked in today' });
    }

    const rule = await getRuleForEmployee(employee);
    const hoursWorked = (now - new Date(existing.checkInAt)) / (1000 * 60 * 60);

    let status = existing.status;
    if (rule) {
      const shiftEndMin = parseHHMM(rule.shiftEnd);
      const nowMin = minutesSinceMidnightLagos(now);
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
        ...(from && to ? { date: { gte: parseLagosDateParam(from), lte: parseLagosDateParam(to) } } : {}),
      },
      orderBy: { date: 'desc' },
    });
    res.json({ attendances });
  } catch (err) { next(err); }
});

router.get('/', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const { employeeId, siteId, from, to } = req.query;
    const attendances = await prisma.attendance.findMany({
      where: {
        ...(employeeId ? { employeeId } : {}),
        ...(siteId ? { siteId } : {}),
        ...(from && to ? { date: { gte: parseLagosDateParam(from), lte: parseLagosDateParam(to) } } : {}),
      },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } }, site: true },
      orderBy: { date: 'desc' },
    });
    res.json({ attendances });
  } catch (err) { next(err); }
});

const manualSchema = z.object({
  employeeId: z.string(),
  date: z.string(),
  status: z.enum(['PRESENT', 'LATE', 'EARLY_DEPARTURE', 'HALF_DAY', 'ABSENT', 'WEEKEND', 'PUBLIC_HOLIDAY', 'ON_LEAVE', 'MISSING_CHECKOUT', 'OVERTIME']),
  notes: z.string().optional(),
});

router.post('/manual', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const data = manualSchema.parse(req.body);
    const date = parseLagosDateParam(data.date);
    const attendance = await prisma.attendance.upsert({
      where: { employeeId_date: { employeeId: data.employeeId, date } },
      update: { status: data.status, notes: data.notes },
      create: { employeeId: data.employeeId, date, status: data.status, notes: data.notes },
    });
    await logActivity({ employeeId: data.employeeId, actorUserId: req.user.id, action: 'ATTENDANCE_MANUAL_EDIT', description: `Attendance manually set to ${data.status}` });
    res.json({ attendance });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------
// Monthly attendance report
// ---------------------------------------------------------
async function buildMonthlyReport({ month, year, siteId }) {
  // Exclusive upper bound (start of next month, Lagos-local) — cleaner and avoids the
  // hour-math bugs that come from trying to build an inclusive end-of-day instant.
  const start = lagosDateBoundary(new Date(Date.UTC(year, month - 1, 1, 12)));
  const end = lagosDateBoundary(new Date(Date.UTC(year, month, 1, 12)));

  const records = await prisma.attendance.findMany({
    where: {
      date: { gte: start, lt: end },
      ...(siteId ? { siteId } : {}),
    },
    include: {
      employee: {
        select: { id: true, firstName: true, lastName: true, employeeCode: true, site: { select: { name: true } } },
      },
    },
  });

  const byEmployee = {};
  for (const r of records) {
    if (!r.employee) continue;
    const id = r.employee.id;
    if (!byEmployee[id]) {
      byEmployee[id] = {
        employeeId: id,
        firstName: r.employee.firstName,
        lastName: r.employee.lastName,
        employeeCode: r.employee.employeeCode,
        siteName: r.employee.site?.name || null,
        presentCount: 0,
        lateCount: 0,
        absentCount: 0,
        halfDayCount: 0,
        overtimeCount: 0,
        onLeaveCount: 0,
        remoteCount: 0,
        totalHours: 0,
      };
    }
    const row = byEmployee[id];
    if (r.status === 'PRESENT') row.presentCount++;
    if (r.status === 'LATE') row.lateCount++;
    if (r.status === 'ABSENT') row.absentCount++;
    if (r.status === 'HALF_DAY') row.halfDayCount++;
    if (r.status === 'OVERTIME') row.overtimeCount++;
    if (r.status === 'ON_LEAVE') row.onLeaveCount++;
    if (r.workMode === 'REMOTE') row.remoteCount++;
    row.totalHours += r.hoursWorked || 0;
  }

  return Object.values(byEmployee).sort((a, b) => a.lastName.localeCompare(b.lastName));
}

const reportQuerySchema = z.object({
  month: z.coerce.number().min(1).max(12),
  year: z.coerce.number().min(2020),
  siteId: z.string().optional(),
});

router.get('/monthly-report', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'TEAM_LEAD'), async (req, res, next) => {
  try {
    const { month, year, siteId } = reportQuerySchema.parse(req.query);
    const report = await buildMonthlyReport({ month, year, siteId });
    res.json({ report });
  } catch (err) { next(err); }
});

router.get('/monthly-report/export', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'), async (req, res, next) => {
  try {
    const { month, year, siteId } = reportQuerySchema.parse(req.query);
    const report = await buildMonthlyReport({ month, year, siteId });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(`Attendance ${month}-${year}`);
    sheet.columns = [
      { header: 'Employee Code', key: 'employeeCode', width: 18 },
      { header: 'Name', key: 'name', width: 26 },
      { header: 'Site', key: 'siteName', width: 22 },
      { header: 'Present', key: 'presentCount', width: 10 },
      { header: 'Late', key: 'lateCount', width: 10 },
      { header: 'Absent', key: 'absentCount', width: 10 },
      { header: 'Half Day', key: 'halfDayCount', width: 10 },
      { header: 'Overtime', key: 'overtimeCount', width: 10 },
      { header: 'On Leave', key: 'onLeaveCount', width: 10 },
      { header: 'Remote Days', key: 'remoteCount', width: 12 },
      { header: 'Total Hours', key: 'totalHours', width: 12 },
    ];
    report.forEach((r) => {
      sheet.addRow({ ...r, name: `${r.firstName} ${r.lastName}`, totalHours: Math.round(r.totalHours * 100) / 100 });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=attendance-report-${month}-${year}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

export default router;

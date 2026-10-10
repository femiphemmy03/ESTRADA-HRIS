import { prisma } from '../lib/prisma.js';

/**
 * DAYS PRESENT FOR PAYROLL
 * ------------------------
 * Counted per attendance row in the payroll month:
 *   PRESENT, LATE, OVERTIME, EARLY_DEPARTURE, MISSING_CHECKOUT  -> 1 day (they showed up)
 *   HALF_DAY                                                    -> 0.5 day
 *   ON_LEAVE                                                    -> 1 day if the approved leave is paid
 *                                                                  (or no matching request is found), else 0
 *   PUBLIC_HOLIDAY                                              -> 1 day (nobody loses pay for a holiday)
 *   ABSENT, WEEKEND                                             -> 0
 */
const FULL_DAY = new Set(['PRESENT', 'LATE', 'OVERTIME', 'EARLY_DEPARTURE', 'MISSING_CHECKOUT', 'PUBLIC_HOLIDAY']);

function monthRangeLagos(month, year) {
  const mm = String(month).padStart(2, '0');
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  return {
    start: new Date(`${year}-${mm}-01T00:00:00+01:00`),
    end: new Date(`${nextYear}-${String(nextMonth).padStart(2, '0')}-01T00:00:00+01:00`),
  };
}

export async function getDaysPresent(employeeId, month, year) {
  const { start, end } = monthRangeLagos(month, year);
  const rows = await prisma.attendance.findMany({
    where: { employeeId, date: { gte: start, lt: end } },
    select: { date: true, status: true },
  });

  let leaveRequests = [];
  if (rows.some((r) => r.status === 'ON_LEAVE')) {
    leaveRequests = await prisma.leaveRequest.findMany({
      where: { employeeId, status: 'APPROVED', startDate: { lt: end }, endDate: { gte: start } },
      include: { leaveType: { select: { isPaid: true } } },
    });
  }

  let days = 0;
  const counts = {};
  for (const r of rows) {
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (FULL_DAY.has(r.status)) days += 1;
    else if (r.status === 'HALF_DAY') days += 0.5;
    else if (r.status === 'ON_LEAVE') {
      const t = r.date.getTime();
      const covering = leaveRequests.find((l) => l.startDate.getTime() <= t + 86_399_999 && l.endDate.getTime() >= t);
      days += !covering || covering.leaveType.isPaid ? 1 : 0;
    }
  }
  return { daysPresent: days, counts };
}

/** Returns { requiredDays, daysPresent, factor, counts } or null when this employee's rule has no proration. */
export async function getProration(employee, rule, month, year) {
  if (!rule?.prorateSalary || !rule.requiredDaysPerMonth) return null;
  const { daysPresent, counts } = await getDaysPresent(employee.id, month, year);
  const requiredDays = rule.requiredDaysPerMonth;
  const factor = Math.min(1, Math.max(0, daysPresent / requiredDays));
  return { requiredDays, daysPresent, factor: Math.round(factor * 10000) / 10000, counts };
}

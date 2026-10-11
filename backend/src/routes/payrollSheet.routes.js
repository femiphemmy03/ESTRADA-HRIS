import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getScope, inScope } from '../utils/clientScope.js';
import { httpError } from '../utils/httpError.js';
import { logPayroll } from '../utils/activityLog.js';
import { getRuleForEmployee } from '../utils/attendanceRules.js';
import { getDaysPresent } from '../utils/attendanceSummary.js';
import { readTable, buildTable, sendTable, norm } from '../utils/tabular.js';
import {
  INPUT_COLUMNS, COMPONENTS, FULL_SHEET_COLUMNS, mergeRates, ratesToRows, ratesFromRows,
  mapHeaders, parseRow, computeSheetRow, valuesFromPayslip, round2,
} from '../utils/payrollSheet.js';

/**
 * PAYROLL SHEET — template download, upload (preview then commit), run summary report and full-sheet export.
 * Everything is per payroll run (one client, one month) and respects client scoping.
 */
const router = Router();
router.use(requireAuth);

const PAYROLL_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];
const EDITABLE = ['DRAFT', 'REVIEW', 'REJECTED'];
const DEFAULT_TEMPLATE_COLUMNS = ['employeeCode', 'employeeName', 'monthlyGross', 'daysInMonth', 'daysWorked', 'paye', 'eePension', 'otherDeductions'];
const DAY_CODES = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

async function loadRun(req, id) {
  const run = await prisma.payrollRun.findUnique({ where: { id }, include: { client: { select: { id: true, name: true } } } });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (req.user.role !== 'SUPER_ADMIN') {
    const scope = await getScope(req.user);
    if (!run.clientId || !inScope(scope, run.clientId)) throw httpError(403, 'This payroll run belongs to a client you are not assigned to.');
  }
  return run;
}

function workingDaysInMonth(month, year, workingDays) {
  const set = new Set((workingDays || 'MON,TUE,WED,THU,FRI').split(',').map((d) => d.trim().toUpperCase()));
  const last = new Date(year, month, 0).getDate();
  let n = 0;
  for (let d = 1; d <= last; d += 1) if (set.has(DAY_CODES[new Date(year, month - 1, d).getDay()])) n += 1;
  return n;
}

// "Days in month" default for an employee: the client's fixed required days if set, else their working days in the month.
async function attendanceDefaults(emp, run, ruleCache) {
  const key = `${emp.siteId || ''}|${emp.clientId || ''}`;
  if (!ruleCache.has(key)) ruleCache.set(key, await getRuleForEmployee(emp));
  const rule = ruleCache.get(key);
  const daysInMonth = rule?.requiredDaysPerMonth || workingDaysInMonth(run.month, run.year, rule?.workingDays);
  const { daysPresent } = await getDaysPresent(emp.id, run.month, run.year);
  return { daysInMonth, daysWorked: daysPresent };
}


// ---------------------------------------------------------------- template
router.get('/runs/:id/template', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    if (!run.clientId) throw httpError(400, 'Templates are generated per client. This is a legacy run with no client.');
    const requested = String(req.query.columns || '').split(',').map((s) => s.trim()).filter(Boolean);
    const chosen = new Set([...(requested.length ? requested : DEFAULT_TEMPLATE_COLUMNS), 'employeeCode', 'employeeName']);
    const columns = INPUT_COLUMNS.filter((c) => chosen.has(c.key));
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';

    const [employees, saved] = await Promise.all([
      prisma.employee.findMany({
        where: { clientId: run.clientId, archived: false, employmentStatus: 'ACTIVE' },
        include: { salaryStructure: true },
        orderBy: { employeeCode: 'asc' },
      }),
      prisma.payrollSheetRates.findUnique({ where: { clientId: run.clientId } }),
    ]);
    const rates = mergeRates(saved?.rates);
    const ruleCache = new Map();

    const rows = [];
    for (const emp of employees) {
      const needDays = chosen.has('daysInMonth') || chosen.has('daysWorked');
      const days = needDays ? await attendanceDefaults(emp, run, ruleCache) : {};
      const st = emp.salaryStructure;
      const comp = Object.fromEntries(COMPONENTS.map((c) => [c.key, '']));
      let gross = '';
      if (st) {
        comp.basic = st.basicSalary;
        (st.allowances || []).forEach((a) => {
          const c = COMPONENTS.find((x) => norm(x.label) === norm(a.name));
          if (c) comp[c.key] = (Number(comp[c.key]) || 0) + a.amount;
        });
        gross = round2(st.basicSalary + (st.allowances || []).reduce((n, a) => n + a.amount, 0));
      }
      const cells = {
        employeeCode: emp.employeeCode,
        employeeName: `${emp.firstName} ${emp.lastName}`,
        annualGross: gross === '' ? '' : round2(gross * 12),
        monthlyGross: gross,
        ...comp,
        daysInMonth: days.daysInMonth ?? '',
        daysWorked: days.daysWorked ?? '',
        eePension: '', paye: '', leaveDeduction: '', thirteenthDeduction: '', otherDeductions: '', groupLife: '',
      };
      rows.push(columns.map((c) => cells[c.key]));
    }

    const sheets = [{ name: 'Payroll', columns: columns.map((c) => ({ header: c.header, width: c.key === 'employeeName' ? 28 : 16 })), rows }];
    if (format === 'xlsx') {
      sheets.push({ name: 'Rates', columns: [{ header: 'Setting', width: 40 }, { header: 'Value (%)', width: 14 }], rows: ratesToRows(rates) });
      sheets.push({
        name: 'Instructions',
        columns: [{ header: 'How to fill this sheet', width: 110 }],
        rows: [
          ['1. One row per employee. Employee Code must match the HRIS exactly — it is how each row is matched to the employee, their attendance and their statutory settings.'],
          ['2. Fill Gross Salary (monthly) and leave the component columns blank, and the system splits it using the percentages on the Rates sheet. Or fill the components yourself.'],
          ['3. No of Days / No of days worked are pre-filled from the client attendance rule and the employee\'s attendance records. Change them if needed. Pay is prorated by worked ÷ days (max 100%).'],
          ['4. EE pension and PAYE: leave blank to let the system calculate them (pension at the Rates % of Basic+Housing+Transport, PAYE from your statutory settings). Type 0 to exclude someone, or type an amount to override.'],
          ['5. Calculated columns (net salary, employer pension, ITF, NSITF, management fees, VAT, amount payable to service provider) are worked out by the system — you do not fill them.'],
          ['6. The Rates sheet is saved for this client when you upload, so next month starts from the same percentages.'],
        ],
      });
    }
    const built = await buildTable(sheets, format);
    sendTable(res, built, `payroll-template-${run.client?.name || 'client'}-${run.year}-${String(run.month).padStart(2, '0')}`);
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- upload (preview | commit)
const uploadSchema = z.object({
  fileName: z.string().default('payroll.xlsx'),
  contentBase64: z.string().min(10),
  mode: z.enum(['preview', 'commit']).default('preview'),
});

router.post('/runs/:id/upload', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const { fileName, contentBase64, mode } = uploadSchema.parse(req.body);
    const run = await loadRun(req, req.params.id);
    if (!run.clientId) throw httpError(400, 'Uploads are per client. This is a legacy run with no client.');
    if (!EDITABLE.includes(run.status)) throw httpError(400, `This run is "${run.status}" — payroll can only be uploaded while it is still being prepared (Draft, Review or Rejected).`);

    const sheets = await readTable(contentBase64, fileName);
    const payrollSheet = sheets.find((s) => norm(s.name) === 'payroll') || sheets[0];
    const ratesSheet = sheets.find((s) => norm(s.name) === 'rates');

    // locate the header row
    let headerIdx = -1;
    let map = {};
    for (let i = 0; i < Math.min(payrollSheet.rows.length, 15); i += 1) {
      const m = mapHeaders(payrollSheet.rows[i]);
      if (m.employeeCode !== undefined) { headerIdx = i; map = m; break; }
    }
    if (headerIdx < 0) throw httpError(400, 'Could not find an "Employee Code" column. Use the template downloaded from this page.');

    const saved = await prisma.payrollSheetRates.findUnique({ where: { clientId: run.clientId } });
    const sheetRates = ratesSheet ? ratesFromRows(ratesSheet.rows.slice(1), saved?.rates) : null;
    const rates = sheetRates || mergeRates(saved?.rates);

    const employees = await prisma.employee.findMany({
      where: { clientId: run.clientId, archived: false },
      include: { salaryStructure: true },
    });
    const byCode = new Map(employees.map((e) => [norm(e.employeeCode), e]));

    const asOfDate = new Date(run.year, run.month - 1, 1);
    const ruleCache = new Map();
    const seen = new Set();
    const results = [];

    for (let i = headerIdx + 1; i < payrollSheet.rows.length; i += 1) {
      const raw = payrollSheet.rows[i];
      if (!raw || raw.every((c) => c === '' || c == null)) continue;
      const row = parseRow(raw, map);
      const code = row.employeeCode;
      const base = { rowNumber: i + 1, code, name: row.employeeName || '' };
      if (!code) { results.push({ ...base, status: 'ERROR', errors: ['Employee Code is blank.'], warnings: [] }); continue; }
      const emp = byCode.get(norm(code));
      if (!emp) { results.push({ ...base, status: 'ERROR', errors: ['No employee with this code under this client.'], warnings: [] }); continue; }
      if (seen.has(emp.id)) { results.push({ ...base, name: `${emp.firstName} ${emp.lastName}`, status: 'ERROR', errors: ['Duplicate row for this employee.'], warnings: [] }); continue; }
      seen.add(emp.id);

      let defaults = {};
      if (row.daysInMonth == null || row.daysWorked == null) defaults = await attendanceDefaults(emp, run, ruleCache);
      const calc = await computeSheetRow({ row, rates, clientId: run.clientId, asOfDate, defaults });
      results.push({
        ...base,
        employeeId: emp.id,
        name: `${emp.firstName} ${emp.lastName}`,
        status: calc.errors.length ? 'ERROR' : calc.warnings.length ? 'WARNING' : 'OK',
        errors: calc.errors,
        warnings: calc.warnings,
        summary: calc.values
          ? {
              grossSalary: calc.values.grossSalary, payableGross: calc.values.payableGross, eePension: calc.values.eePension,
              paye: calc.values.paye, totalDeduction: calc.values.totalDeduction, netSalary: calc.values.netSalary,
              daysInMonth: calc.values.daysInMonth, daysWorked: calc.values.daysWorked, payableToProvider: calc.values.payableToProvider,
            }
          : null,
        payslipData: calc.payslipData,
      });
    }

    const good = results.filter((r) => r.status !== 'ERROR');
    const missing = employees
      .filter((e) => e.employmentStatus === 'ACTIVE' && !seen.has(e.id))
      .map((e) => ({ code: e.employeeCode, name: `${e.firstName} ${e.lastName}` }));
    const sum = (key) => round2(good.reduce((n, r) => n + (r.summary?.[key] || 0), 0));
    const summary = {
      rows: results.length, ok: results.filter((r) => r.status === 'OK').length, warnings: results.filter((r) => r.status === 'WARNING').length,
      errors: results.filter((r) => r.status === 'ERROR').length, missingFromSheet: missing.length,
      totals: { grossSalary: sum('grossSalary'), payableGross: sum('payableGross'), paye: sum('paye'), eePension: sum('eePension'), netSalary: sum('netSalary'), payableToProvider: sum('payableToProvider') },
      ratesFromFile: !!sheetRates,
    };

    if (mode === 'commit') {
      if (good.length === 0) throw httpError(400, 'There are no valid rows to import. Fix the errors and upload again.');
      await prisma.$transaction(async (tx) => {
        for (const r of good) {
          await tx.payslip.upsert({
            where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: r.employeeId } },
            update: { ...r.payslipData, paymentApproval: 'PENDING', paymentStatus: 'NOT_PAID', paymentMessage: null },
            create: { payrollRunId: run.id, employeeId: r.employeeId, ...r.payslipData },
          });
        }
        await tx.payrollRun.update({
          where: { id: run.id },
          data: { status: 'REVIEW', sourceFileName: fileName, uploadedAt: new Date(), uploadedById: req.user.id },
        });
        if (sheetRates) {
          await tx.payrollSheetRates.upsert({
            where: { clientId: run.clientId },
            update: { rates: sheetRates, updatedById: req.user.id },
            create: { clientId: run.clientId, rates: sheetRates, updatedById: req.user.id },
          });
        }
      }, { timeout: 60000 });
      await logPayroll(req, {
        action: 'PAYROLL_SHEET_UPLOADED',
        clientId: run.clientId,
        description: `Payroll sheet "${fileName}" imported for ${run.client?.name} (${run.month}/${run.year}): ${good.length} payslip(s), ${summary.errors} row(s) skipped`,
        metadata: { runId: run.id, fileName, imported: good.length, skipped: summary.errors, totals: summary.totals, ratesUpdated: !!sheetRates },
      });
    }

    res.json({
      mode,
      committed: mode === 'commit',
      imported: mode === 'commit' ? good.length : 0,
      summary,
      missing,
      rows: results.map(({ payslipData, ...rest }) => rest),
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- summary report
const sumBy = (list, fn) => round2(list.reduce((n, x) => n + (fn(x) || 0), 0));

async function buildSummary(run) {
  const payslips = await prisma.payslip.findMany({
    where: { payrollRunId: run.id },
    include: { employee: { select: { employeeCode: true, firstName: true, lastName: true } } },
  });
  const sheet = (p) => p.breakdown?.sheet;
  const hasEmployer = payslips.some((p) => sheet(p)?.totalEmolument != null);
  const ranked = [...payslips].sort((a, b) => b.netPay - a.netPay);
  const who = (p) => (p ? { name: `${p.employee.firstName} ${p.employee.lastName}`, code: p.employee.employeeCode, amount: p.netPay } : null);

  const paid = payslips.filter((p) => p.paymentStatus === 'SUCCESS');
  const totals = {
    grossPay: sumBy(payslips, (p) => p.basicSalary + p.grossAllowances),
    basic: sumBy(payslips, (p) => p.basicSalary),
    allowances: sumBy(payslips, (p) => p.grossAllowances),
    overtime: sumBy(payslips, (p) => p.overtimePay),
    paye: sumBy(payslips, (p) => p.paye),
    pensionEmployee: sumBy(payslips, (p) => p.pensionEmployee),
    nhf: sumBy(payslips, (p) => p.nhf),
    totalDeductions: sumBy(payslips, (p) => p.totalDeductions),
    net: sumBy(payslips, (p) => p.netPay),
    totalPayable: sumBy(payslips, (p) => p.totalPayable),
  };
  const employer = hasEmployer
    ? {
        pensionEmployer: sumBy(payslips, (p) => sheet(p)?.employerPension), itf: sumBy(payslips, (p) => sheet(p)?.itf),
        nsitf: sumBy(payslips, (p) => sheet(p)?.nsitf), groupLife: sumBy(payslips, (p) => sheet(p)?.groupLife),
        totalAdditions: sumBy(payslips, (p) => sheet(p)?.totalAdditions), totalEmolument: sumBy(payslips, (p) => sheet(p)?.totalEmolument),
        managementFees: sumBy(payslips, (p) => sheet(p)?.managementFees), vat: sumBy(payslips, (p) => sheet(p)?.vat),
        payableToProvider: sumBy(payslips, (p) => sheet(p)?.payableToProvider),
      }
    : null;

  // previous month for the same client -> month-on-month movement
  const prevMonth = run.month === 1 ? 12 : run.month - 1;
  const prevYear = run.month === 1 ? run.year - 1 : run.year;
  const prevRun = run.clientId ? await prisma.payrollRun.findFirst({ where: { clientId: run.clientId, month: prevMonth, year: prevYear } }) : null;
  let previous = null;
  if (prevRun) {
    const agg = await prisma.payslip.aggregate({ where: { payrollRunId: prevRun.id }, _sum: { netPay: true }, _count: { _all: true } });
    const prevNet = round2(agg._sum.netPay || 0);
    previous = { month: prevMonth, year: prevYear, headcount: agg._count._all, net: prevNet, netChangePct: prevNet > 0 ? round2(((totals.net - prevNet) / prevNet) * 100) : null };
  }

  return {
    run: { id: run.id, month: run.month, year: run.year, status: run.status, client: run.client || null, sourceFileName: run.sourceFileName, uploadedAt: run.uploadedAt },
    headcount: payslips.length,
    totals,
    employer,
    attendance: {
      prorated: payslips.filter((p) => p.prorationFactor != null && p.prorationFactor < 1).length,
      averageDaysPresent: payslips.filter((p) => p.daysPresent != null).length
        ? round2(sumBy(payslips, (p) => p.daysPresent || 0) / payslips.filter((p) => p.daysPresent != null).length)
        : null,
    },
    payments: {
      approved: payslips.filter((p) => p.paymentApproval === 'APPROVED').length,
      paid: paid.length,
      failed: payslips.filter((p) => p.paymentStatus === 'FAILED').length,
      unpaid: payslips.length - paid.length,
      paidTotal: sumBy(paid, (p) => p.totalPayable),
      outstandingTotal: sumBy(payslips.filter((p) => p.paymentStatus !== 'SUCCESS'), (p) => p.totalPayable),
    },
    highlights: {
      highestNet: who(ranked[0]),
      lowestNet: who(ranked[ranked.length - 1]),
      averageNet: payslips.length ? round2(totals.net / payslips.length) : 0,
    },
    previous,
    _payslips: payslips,
  };
}

router.get('/runs/:id/summary', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    const { _payslips, ...summary } = await buildSummary(run);
    res.json({ summary });
  } catch (err) { next(err); }
});

// Full payroll sheet (same column layout as the business's own sheet) + a summary sheet.
router.get('/runs/:id/export', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';
    const { _payslips, ...summary } = await buildSummary(run);

    const rows = _payslips
      .sort((a, b) => a.employee.employeeCode.localeCompare(b.employee.employeeCode))
      .map((p) => {
        const v = p.breakdown?.sheet || valuesFromPayslip(p);
        const e = { code: p.employee.employeeCode, name: `${p.employee.firstName} ${p.employee.lastName}` };
        return FULL_SHEET_COLUMNS.map(([, get]) => get(v, e) ?? '');
      });
    const sheets = [{ name: 'Payroll', columns: FULL_SHEET_COLUMNS.map(([h]) => ({ header: h, width: 18 })), rows }];

    if (format === 'xlsx') {
      const t = summary.totals;
      const e = summary.employer;
      const lines = [
        ['Client', run.client?.name || ''], ['Period', `${run.month}/${run.year}`], ['Status', run.status], ['Employees', summary.headcount],
        ['Gross pay', t.grossPay], ['PAYE', t.paye], ['Employee pension', t.pensionEmployee], ['Total deductions', t.totalDeductions], ['Net pay', t.net],
        ...(e ? [['Employer pension', e.pensionEmployer], ['ITF', e.itf], ['NSITF', e.nsitf], ['Group life', e.groupLife], ['Total employee emolument', e.totalEmolument], ['Management fees', e.managementFees], ['VAT', e.vat], ['Amount payable to service provider', e.payableToProvider]] : []),
        ['Prorated for attendance', summary.attendance.prorated], ['Paid', summary.payments.paid], ['Not yet paid', summary.payments.unpaid], ['Paid total', summary.payments.paidTotal], ['Outstanding', summary.payments.outstandingTotal],
      ];
      sheets.push({ name: 'Summary', columns: [{ header: 'Item', width: 38 }, { header: 'Value', width: 22 }], rows: lines });
    }
    const built = await buildTable(sheets, format);
    await logPayroll(req, { action: 'PAYROLL_REPORT_EXPORTED', clientId: run.clientId || undefined, description: `Payroll report exported for ${run.client?.name || 'run'} (${run.month}/${run.year})`, metadata: { runId: run.id, format } });
    sendTable(res, built, `payroll-report-${run.client?.name || 'all'}-${run.year}-${String(run.month).padStart(2, '0')}`);
  } catch (err) { next(err); }
});

export default router;

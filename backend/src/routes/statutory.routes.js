import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getScope, inScope } from '../utils/clientScope.js';
import { httpError } from '../utils/httpError.js';
import { logPayroll } from '../utils/activityLog.js';
import { readTable, buildTable, sendTable, norm, toNumber } from '../utils/tabular.js';

/**
 * PAYE & PENSION — history, month-on-month reporting, uploaded remittance schedules and exports.
 *  - "Expected" amounts come from the payroll runs (payslips).
 *  - "Remitted" amounts come from the PAYE / Pension schedules the business actually uploads (the sheets used to pay).
 *  - Outstanding = expected - remitted, per month, per client.
 *  - Employees are split into those whose record has a usable PAYE number / RSA PIN and those without.
 * Everything is client-scoped: HR roles only ever see their assigned clients.
 */
const router = Router();
router.use(requireAuth, requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'));

const COUNTED = ['REVIEW', 'PENDING_HR_MANAGER', 'PENDING_SUPER_ADMIN', 'APPROVED', 'PAID'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Heuristic format checks (shown as "valid" / "missing or invalid" — they do not call any tax/pension authority).
export const isValidPaye = (s) => !!s && /^[A-Z0-9][A-Z0-9\-/]{4,24}$/i.test(String(s).trim());
export const isValidRsa = (s) => !!s && /^PEN\d{12}$/i.test(String(s).replace(/\s/g, ''));
const validFor = (type, s) => (type === 'PAYE' ? isValidPaye(s) : isValidRsa(s));

/** null = every client (Super Admin, no filter); otherwise the list of client ids the caller may use. */
async function resolveClients(req, clientId) {
  const scope = await getScope(req.user);
  if (clientId) {
    if (!inScope(scope, clientId)) throw httpError(403, 'You are not assigned to this client.');
    return [clientId];
  }
  return scope.all ? null : scope.clientIds;
}

async function assertClient(req, clientId) {
  const scope = await getScope(req.user);
  if (!inScope(scope, clientId)) throw httpError(403, 'You are not assigned to this client.');
}

const employerPension = (p) => Number(p.breakdown?.sheet?.employerPension) || 0;

// ---------------------------------------------------------------- overview / history
router.get('/overview', async (req, res, next) => {
  try {
    const clientIds = await resolveClients(req, req.query.clientId);
    const year = Number(req.query.year) || new Date().getFullYear();
    const clientFilter = clientIds ? { clientId: { in: clientIds } } : {};

    const [payslips, remittances, lineSums, employees] = await Promise.all([
      prisma.payslip.findMany({
        where: { payrollRun: { status: { in: COUNTED }, ...clientFilter } },
        select: {
          paye: true, pensionEmployee: true, netPay: true, totalPayable: true, paymentStatus: true, breakdown: true,
          employee: { select: { payeNumber: true, pensionRSA: true } },
          payrollRun: { select: { month: true, year: true } },
        },
      }),
      prisma.statutoryRemittance.findMany({ where: clientFilter, select: { id: true, type: true, month: true, year: true, totalAmount: true } }),
      prisma.statutoryRemittanceLine.groupBy({ by: ['remittanceId', 'hasValidId'], where: { remittance: clientFilter }, _sum: { amount: true } }),
      prisma.employee.findMany({ where: { archived: false, employmentStatus: 'ACTIVE', ...clientFilter }, select: { payeNumber: true, pensionRSA: true } }),
    ]);

    const blank = (month, y) => ({
      month, year: y, headcount: 0, gross: 0, net: 0, paid: 0,
      paye: { expected: 0, expectedWithId: 0, expectedWithoutId: 0, remitted: 0, remittedWithId: 0, remittedWithoutId: 0 },
      pension: { expectedEmployee: 0, expectedEmployer: 0, expected: 0, expectedWithId: 0, expectedWithoutId: 0, remitted: 0, remittedWithId: 0, remittedWithoutId: 0 },
    });
    const buckets = new Map();
    const get = (m, y) => {
      const k = `${y}-${m}`;
      if (!buckets.has(k)) buckets.set(k, blank(m, y));
      return buckets.get(k);
    };

    for (const p of payslips) {
      const b = get(p.payrollRun.month, p.payrollRun.year);
      b.headcount += 1;
      b.net += p.netPay;
      if (p.paymentStatus === 'SUCCESS') b.paid += p.totalPayable;
      const payeOk = isValidPaye(p.employee.payeNumber);
      const rsaOk = isValidRsa(p.employee.pensionRSA);
      b.paye.expected += p.paye;
      b.paye[payeOk ? 'expectedWithId' : 'expectedWithoutId'] += p.paye;
      const er = employerPension(p);
      b.pension.expectedEmployee += p.pensionEmployee;
      b.pension.expectedEmployer += er;
      b.pension.expected += p.pensionEmployee + er;
      b.pension[rsaOk ? 'expectedWithId' : 'expectedWithoutId'] += p.pensionEmployee + er;
    }
    // true gross (basic + allowances)
    const grossRows = await prisma.payslip.groupBy({
      by: ['payrollRunId'], where: { payrollRun: { status: { in: COUNTED }, ...clientFilter } }, _sum: { basicSalary: true, grossAllowances: true },
    });
    if (grossRows.length) {
      const runs = await prisma.payrollRun.findMany({ where: { id: { in: grossRows.map((g) => g.payrollRunId) } }, select: { id: true, month: true, year: true } });
      const runById = new Map(runs.map((r) => [r.id, r]));
      for (const g of grossRows) {
        const r = runById.get(g.payrollRunId);
        if (r) get(r.month, r.year).gross += (g._sum.basicSalary || 0) + (g._sum.grossAllowances || 0);
      }
    }

    const remById = new Map(remittances.map((r) => [r.id, r]));
    for (const ls of lineSums) {
      const r = remById.get(ls.remittanceId);
      if (!r) continue;
      const bucket = get(r.month, r.year)[r.type === 'PAYE' ? 'paye' : 'pension'];
      const amt = ls._sum.amount || 0;
      bucket.remitted += amt;
      bucket[ls.hasValidId ? 'remittedWithId' : 'remittedWithoutId'] += amt;
    }
    // a remittance with no lines still counts for its total
    const withLines = new Set(lineSums.map((l) => l.remittanceId));
    for (const r of remittances) {
      if (!withLines.has(r.id) && r.totalAmount) get(r.month, r.year)[r.type === 'PAYE' ? 'paye' : 'pension'].remitted += r.totalAmount;
    }

    const finish = (b) => {
      for (const k of ['paye', 'pension']) {
        const o = b[k];
        Object.keys(o).forEach((f) => { o[f] = round2(o[f]); });
        o.outstanding = round2(Math.max(0, o.expected - o.remitted));
        o.overpaid = round2(Math.max(0, o.remitted - o.expected));
      }
      b.gross = round2(b.gross); b.net = round2(b.net); b.paid = round2(b.paid);
      return b;
    };

    const all = [...buckets.values()].map(finish).sort((a, b) => a.year - b.year || a.month - b.month);
    const months = Array.from({ length: 12 }, (_, i) => all.find((b) => b.year === year && b.month === i + 1) || finish(blank(i + 1, year)));

    const sumInto = (list) => {
      const t = blank(0, 0);
      list.forEach((b) => {
        t.headcount += b.headcount; t.gross += b.gross; t.net += b.net; t.paid += b.paid;
        for (const k of ['paye', 'pension']) Object.keys(t[k]).forEach((f) => { t[k][f] += b[k][f] || 0; });
      });
      return finish(t);
    };
    const yearTotals = sumInto(months);
    const inception = sumInto(all);
    // outstanding to date is the sum of each month's shortfall (an overpaid month doesn't offset another month)
    inception.paye.outstanding = round2(all.reduce((n, b) => n + b.paye.outstanding, 0));
    inception.pension.outstanding = round2(all.reduce((n, b) => n + b.pension.outstanding, 0));

    // projection: next month ~ average of the last 3 months that have payroll
    const recent = all.filter((b) => b.headcount > 0).slice(-3);
    let projection = null;
    if (recent.length) {
      const last = recent[recent.length - 1];
      const nm = last.month === 12 ? 1 : last.month + 1;
      const ny = last.month === 12 ? last.year + 1 : last.year;
      projection = {
        month: nm, year: ny, basedOnMonths: recent.length,
        paye: round2(recent.reduce((n, b) => n + b.paye.expected, 0) / recent.length),
        pension: round2(recent.reduce((n, b) => n + b.pension.expected, 0) / recent.length),
      };
    }

    res.json({
      year,
      months,
      totals: { year: yearTotals, inception },
      projection,
      idCoverage: {
        employees: employees.length,
        withPayeNumber: employees.filter((e) => isValidPaye(e.payeNumber)).length,
        withoutPayeNumber: employees.filter((e) => !isValidPaye(e.payeNumber)).length,
        withRsaPin: employees.filter((e) => isValidRsa(e.pensionRSA)).length,
        withoutRsaPin: employees.filter((e) => !isValidRsa(e.pensionRSA)).length,
      },
    });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- employee IDs (PAYE number / RSA PIN)
router.get('/employees', async (req, res, next) => {
  try {
    const clientIds = await resolveClients(req, req.query.clientId);
    const type = req.query.type === 'PENSION' ? 'PENSION' : 'PAYE';
    const rows = await prisma.employee.findMany({
      where: { archived: false, employmentStatus: 'ACTIVE', ...(clientIds ? { clientId: { in: clientIds } } : {}) },
      select: { id: true, employeeCode: true, firstName: true, lastName: true, payeNumber: true, pensionRSA: true, pensionAdmin: true, client: { select: { name: true } } },
      orderBy: { employeeCode: 'asc' },
      take: 2000,
    });
    res.json({
      employees: rows.map((e) => ({
        id: e.id, employeeCode: e.employeeCode, name: `${e.firstName} ${e.lastName}`, client: e.client?.name || null,
        payeNumber: e.payeNumber, pensionRSA: e.pensionRSA, pensionAdmin: e.pensionAdmin,
        valid: validFor(type, type === 'PAYE' ? e.payeNumber : e.pensionRSA),
      })),
    });
  } catch (err) { next(err); }
});

router.patch('/employees/:id/ids', async (req, res, next) => {
  try {
    const data = z.object({ payeNumber: z.string().max(40).optional(), pensionRSA: z.string().max(40).optional(), pensionAdmin: z.string().max(80).optional() }).parse(req.body);
    const emp = await prisma.employee.findUnique({ where: { id: req.params.id }, select: { id: true, clientId: true, employeeCode: true, firstName: true, lastName: true, payeNumber: true, pensionRSA: true, pensionAdmin: true } });
    if (!emp) throw httpError(404, 'Employee not found');
    if (emp.clientId) await assertClient(req, emp.clientId);
    else if (req.user.role !== 'SUPER_ADMIN') throw httpError(403, 'This employee is not under any client yet.');

    const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, v.trim() || null]));
    const updated = await prisma.employee.update({ where: { id: emp.id }, data: clean, select: { payeNumber: true, pensionRSA: true, pensionAdmin: true } });
    await logPayroll(req, {
      action: 'PAYROLL_STATUTORY_IDS_UPDATED', employeeId: emp.id, clientId: emp.clientId || undefined,
      description: `PAYE/pension details updated for ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
      metadata: { before: { payeNumber: emp.payeNumber, pensionRSA: emp.pensionRSA, pensionAdmin: emp.pensionAdmin }, after: updated },
    });
    res.json({ employee: updated });
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- remittance schedules (PAYE / Pension sheets that were paid)
const FIELD_SYNONYMS = {
  code: ['employeecode', 'staffid', 'employeeid', 'staffno', 'staffnumber', 'code', 'empcode', 'empid'],
  name: ['name', 'employeename', 'fullname', 'staffname', 'employee', 'nameofemployee'],
  first: ['firstname'],
  last: ['lastname', 'surname'],
  paye: ['payenumber', 'payeno', 'payeid', 'taxid', 'tin', 'taxidentificationnumber', 'taxpayerid', 'taxnumber', 'payeref', 'tinno', 'taxidno'],
  rsa: ['rsapin', 'rsa', 'pin', 'pensionpin', 'rsapinnumber', 'rsano', 'pensionnumber'],
  eeContribution: ['employeecontribution', 'employeepension', 'eepension', 'eecontribution'],
  erContribution: ['employercontribution', 'employerpension', 'erpension', 'ercontribution'],
};
const AMOUNT_SYNONYMS = {
  PAYE: ['payeamount', 'paye', 'taxamount', 'taxdeducted', 'taxpayable', 'monthlytax', 'incometax', 'amount', 'tax'],
  PENSION: ['totalcontribution', 'totalpension', 'totalremittance', 'pensionamount', 'pensioncontribution', 'amount', 'total', 'pension'],
};

function mapScheduleHeaders(row, type) {
  const map = {};
  const amountOrder = AMOUNT_SYNONYMS[type];
  let amountRank = Infinity;
  row.forEach((h, idx) => {
    const n = norm(h);
    if (!n) return;
    for (const [field, syns] of Object.entries(FIELD_SYNONYMS)) {
      if (syns.includes(n) && map[field] === undefined) map[field] = idx;
    }
    const rank = amountOrder.indexOf(n);
    if (rank >= 0 && rank < amountRank) { amountRank = rank; map.amount = idx; }
  });
  return map;
}

const tokens = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

function buildMatcher(employees) {
  const byCode = new Map(employees.map((e) => [norm(e.employeeCode), e]));
  const byPaye = new Map(employees.filter((e) => e.payeNumber).map((e) => [norm(e.payeNumber), e]));
  const byRsa = new Map(employees.filter((e) => e.pensionRSA).map((e) => [norm(e.pensionRSA), e]));
  const withTokens = employees.map((e) => ({ e, t: new Set(tokens(`${e.firstName} ${e.lastName}`)) }));
  return ({ code, idInFile, name, type }) => {
    if (code && byCode.has(norm(code))) return { emp: byCode.get(norm(code)), by: 'Employee code' };
    if (idInFile) {
      const hit = (type === 'PAYE' ? byPaye : byRsa).get(norm(idInFile));
      if (hit) return { emp: hit, by: type === 'PAYE' ? 'PAYE number' : 'RSA PIN' };
    }
    const st = tokens(name);
    if (st.length >= 2) {
      const sset = new Set(st);
      const exact = withTokens.filter((x) => x.t.size === sset.size && [...x.t].every((tk) => sset.has(tk)));
      if (exact.length === 1) return { emp: exact[0].e, by: 'Name' };
      if (exact.length > 1) return { ambiguous: true };
      const loose = withTokens.filter((x) => st.every((tk) => x.t.has(tk)) || [...x.t].every((tk) => sset.has(tk)));
      if (loose.length === 1) return { emp: loose[0].e, by: 'Name (partial)' };
      if (loose.length > 1) return { ambiguous: true };
    }
    return null;
  };
}

async function expectedForMonth(clientId, month, year) {
  const slips = await prisma.payslip.findMany({
    where: { payrollRun: { clientId, month, year, status: { in: COUNTED } } },
    select: { employeeId: true, paye: true, pensionEmployee: true, breakdown: true },
  });
  return new Map(slips.map((p) => [p.employeeId, { paye: p.paye, pension: p.pensionEmployee + employerPension(p) }]));
}

async function analyseSchedule({ type, clientId, month, year, fileName, contentBase64 }) {
  const sheets = await readTable(contentBase64, fileName);
  const sheet = sheets[0];
  let headerIdx = -1;
  let map = {};
  for (let i = 0; i < Math.min(sheet.rows.length, 20); i += 1) {
    const m = mapScheduleHeaders(sheet.rows[i], type);
    const hasId = m.code !== undefined || m.name !== undefined || m.first !== undefined;
    if (hasId && m.amount !== undefined) { headerIdx = i; map = m; break; }
    if (hasId && type === 'PENSION' && m.eeContribution !== undefined && m.erContribution !== undefined) { headerIdx = i; map = m; break; }
  }
  if (headerIdx < 0) throw httpError(400, 'Could not recognise this schedule. It needs a name or employee-code column and an amount column.');

  const employees = await prisma.employee.findMany({
    where: { clientId },
    select: { id: true, employeeCode: true, firstName: true, lastName: true, payeNumber: true, pensionRSA: true },
  });
  const match = buildMatcher(employees);
  const expected = await expectedForMonth(clientId, month, year);

  const lines = [];
  for (let i = headerIdx + 1; i < sheet.rows.length; i += 1) {
    const r = sheet.rows[i];
    if (!r || r.every((c) => c === '' || c == null)) continue;
    const cell = (k) => (map[k] === undefined ? '' : String(r[map[k]] ?? '').trim());
    const name = cell('name') || [cell('first'), cell('last')].filter(Boolean).join(' ');
    const code = cell('code');
    if (/^total/i.test(name) || /^total/i.test(code)) continue;
    let amount = map.amount !== undefined ? toNumber(r[map.amount]) : null;
    if (amount == null && map.eeContribution !== undefined) {
      amount = (toNumber(r[map.eeContribution]) || 0) + (map.erContribution !== undefined ? toNumber(r[map.erContribution]) || 0 : 0);
    }
    if (!name && !code && !amount) continue;
    const idInFile = type === 'PAYE' ? cell('paye') : cell('rsa');

    const hit = match({ code, idInFile, name, type });
    const line = { rowNumber: i + 1, name: name || code || '(blank)', code, idInFile, amount: round2(amount || 0) };
    if (!hit || hit.ambiguous) {
      Object.assign(line, { status: 'UNMATCHED', hasValidId: false, note: hit?.ambiguous ? 'More than one employee has this name — add the employee code.' : 'No employee found under this client.' });
    } else {
      const emp = hit.emp;
      const recordId = type === 'PAYE' ? emp.payeNumber : emp.pensionRSA;
      Object.assign(line, { employeeId: emp.id, employeeCode: emp.employeeCode, employeeName: `${emp.firstName} ${emp.lastName}`, matchedBy: hit.by });
      if (!recordId) {
        Object.assign(line, { status: 'MATCHED_NO_ID', hasValidId: false, note: `Employee record has no ${type === 'PAYE' ? 'PAYE number' : 'RSA PIN'}${idInFile ? ` (the file has ${idInFile})` : ''}.` });
      } else if (idInFile && norm(idInFile) !== norm(recordId)) {
        Object.assign(line, { status: 'ID_MISMATCH', hasValidId: false, note: `File has ${idInFile} but the employee record has ${recordId}.` });
      } else if (!validFor(type, recordId)) {
        Object.assign(line, { status: 'ID_INVALID', hasValidId: false, note: `${recordId} doesn't look like a valid ${type === 'PAYE' ? 'PAYE number' : 'RSA PIN (PEN + 12 digits)'}.` });
      } else {
        Object.assign(line, { status: 'MATCHED_OK', hasValidId: true, note: null });
      }
      const exp = expected.get(emp.id);
      if (exp) {
        const want = type === 'PAYE' ? exp.paye : exp.pension;
        line.expected = round2(want);
        if (Math.abs(want - line.amount) > 1) line.note = [line.note, `Schedule ${line.amount.toLocaleString()} vs payroll ${round2(want).toLocaleString()}.`].filter(Boolean).join(' ');
        line.amountMismatch = Math.abs(want - line.amount) > 1;
      }
    }
    lines.push(line);
  }

  const matchedIds = new Set(lines.filter((l) => l.employeeId).map((l) => l.employeeId));
  const empById = new Map(employees.map((e) => [e.id, e]));
  const notRemitted = [...expected.entries()]
    .filter(([id, v]) => !matchedIds.has(id) && (type === 'PAYE' ? v.paye : v.pension) > 0)
    .map(([id, v]) => {
      const e = empById.get(id);
      return { employeeCode: e?.employeeCode, name: e ? `${e.firstName} ${e.lastName}` : '', expected: round2(type === 'PAYE' ? v.paye : v.pension), hasValidId: validFor(type, type === 'PAYE' ? e?.payeNumber : e?.pensionRSA) };
    });

  const count = (s) => lines.filter((l) => l.status === s).length;
  const amountOf = (pred) => round2(lines.filter(pred).reduce((n, l) => n + l.amount, 0));
  return {
    lines,
    notRemitted,
    summary: {
      rows: lines.length,
      total: amountOf(() => true),
      withValidId: { count: count('MATCHED_OK'), amount: amountOf((l) => l.status === 'MATCHED_OK') },
      withoutValidId: { count: lines.filter((l) => ['MATCHED_NO_ID', 'ID_MISMATCH', 'ID_INVALID'].includes(l.status)).length, amount: amountOf((l) => ['MATCHED_NO_ID', 'ID_MISMATCH', 'ID_INVALID'].includes(l.status)) },
      unmatched: { count: count('UNMATCHED'), amount: amountOf((l) => l.status === 'UNMATCHED') },
      amountMismatches: lines.filter((l) => l.amountMismatch).length,
      expectedTotal: round2([...expected.values()].reduce((n, v) => n + (type === 'PAYE' ? v.paye : v.pension), 0)),
      notRemittedCount: notRemitted.length,
      notRemittedAmount: round2(notRemitted.reduce((n, x) => n + x.expected, 0)),
    },
  };
}

const remittanceSchema = z.object({
  type: z.enum(['PAYE', 'PENSION']),
  clientId: z.string().min(1),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2000).max(2100),
  fileName: z.string().default('schedule.xlsx'),
  contentBase64: z.string().min(10),
  mode: z.enum(['preview', 'commit']).default('preview'),
});

router.post('/remittances', async (req, res, next) => {
  try {
    const body = remittanceSchema.parse(req.body);
    await assertClient(req, body.clientId);
    const result = await analyseSchedule(body);

    if (body.mode === 'commit') {
      if (result.lines.length === 0) throw httpError(400, 'No rows found in this schedule.');
      const rem = await prisma.statutoryRemittance.create({
        data: {
          type: body.type, clientId: body.clientId, month: body.month, year: body.year, fileName: body.fileName, uploadedById: req.user.id,
          totalAmount: result.summary.total, rowCount: result.lines.length, matchedCount: result.lines.filter((l) => l.employeeId).length,
          lines: {
            create: result.lines.map((l) => ({
              employeeId: l.employeeId || null, employeeCode: l.employeeCode || l.code || null, name: l.name, idInFile: l.idInFile || null,
              amount: l.amount, status: l.status, hasValidId: l.hasValidId, note: l.note || null,
            })),
          },
        },
      });
      await logPayroll(req, {
        action: `PAYROLL_${body.type}_SCHEDULE_UPLOADED`, clientId: body.clientId,
        description: `${body.type} schedule "${body.fileName}" uploaded for ${body.month}/${body.year}: ${result.lines.length} line(s), total ${result.summary.total.toLocaleString()}`,
        metadata: { remittanceId: rem.id, summary: result.summary },
      });
      return res.status(201).json({ committed: true, remittanceId: rem.id, ...result });
    }
    res.json({ committed: false, ...result });
  } catch (err) { next(err); }
});

router.get('/remittances', async (req, res, next) => {
  try {
    const clientIds = await resolveClients(req, req.query.clientId);
    const where = {
      ...(clientIds ? { clientId: { in: clientIds } } : {}),
      ...(req.query.type ? { type: req.query.type } : {}),
      ...(req.query.year ? { year: Number(req.query.year) } : {}),
    };
    const rows = await prisma.statutoryRemittance.findMany({
      where, orderBy: [{ year: 'desc' }, { month: 'desc' }, { createdAt: 'desc' }], take: 200,
      include: { client: { select: { name: true } } },
    });
    res.json({ remittances: rows });
  } catch (err) { next(err); }
});

router.get('/remittances/:id', async (req, res, next) => {
  try {
    const rem = await prisma.statutoryRemittance.findUnique({ where: { id: req.params.id }, include: { lines: true, client: { select: { name: true } } } });
    if (!rem) throw httpError(404, 'Schedule not found');
    await assertClient(req, rem.clientId);
    res.json({ remittance: rem });
  } catch (err) { next(err); }
});

router.delete('/remittances/:id', async (req, res, next) => {
  try {
    const rem = await prisma.statutoryRemittance.findUnique({ where: { id: req.params.id } });
    if (!rem) throw httpError(404, 'Schedule not found');
    await assertClient(req, rem.clientId);
    await prisma.statutoryRemittance.delete({ where: { id: rem.id } });
    await logPayroll(req, { action: `PAYROLL_${rem.type}_SCHEDULE_DELETED`, clientId: rem.clientId, description: `${rem.type} schedule "${rem.fileName}" (${rem.month}/${rem.year}) deleted`, metadata: { totalAmount: rem.totalAmount } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------------------------------------------------------------- exports (Excel or CSV)
router.get('/export', async (req, res, next) => {
  try {
    const report = ['paye', 'pension', 'payroll'].includes(req.query.report) ? req.query.report : null;
    if (!report) throw httpError(400, 'report must be paye, pension or payroll');
    const clientIds = await resolveClients(req, req.query.clientId);
    const year = Number(req.query.year) || new Date().getFullYear();
    const month = req.query.month ? Number(req.query.month) : null;
    const format = req.query.format === 'csv' ? 'csv' : 'xlsx';

    const payslips = await prisma.payslip.findMany({
      where: { payrollRun: { status: { in: COUNTED }, year, ...(month ? { month } : {}), ...(clientIds ? { clientId: { in: clientIds } } : {}) } },
      include: {
        employee: { select: { employeeCode: true, firstName: true, lastName: true, payeNumber: true, pensionRSA: true, pensionAdmin: true } },
        payrollRun: { select: { month: true, year: true, client: { select: { name: true } } } },
      },
      orderBy: [{ payrollRun: { month: 'asc' } }, { employee: { employeeCode: 'asc' } }],
    });

    const base = (p) => [p.payrollRun.client?.name || '', `${String(p.payrollRun.month).padStart(2, '0')}/${p.payrollRun.year}`, p.employee.employeeCode, `${p.employee.firstName} ${p.employee.lastName}`];
    let sheet;
    if (report === 'paye') {
      sheet = {
        name: 'PAYE',
        columns: ['Client', 'Period', 'Employee Code', 'Employee Name', 'PAYE Number', 'PAYE Number Status', 'PAYE Amount'].map((h) => ({ header: h, width: 20 })),
        rows: payslips.map((p) => [...base(p), p.employee.payeNumber || '', isValidPaye(p.employee.payeNumber) ? 'Valid' : p.employee.payeNumber ? 'Check format' : 'Missing', p.paye]),
      };
    } else if (report === 'pension') {
      sheet = {
        name: 'Pension',
        columns: ['Client', 'Period', 'Employee Code', 'Employee Name', 'RSA PIN', 'RSA Status', 'PFA', 'Employee Contribution', 'Employer Contribution', 'Total'].map((h) => ({ header: h, width: 20 })),
        rows: payslips.map((p) => [...base(p), p.employee.pensionRSA || '', isValidRsa(p.employee.pensionRSA) ? 'Valid' : p.employee.pensionRSA ? 'Check format' : 'Missing', p.employee.pensionAdmin || '', p.pensionEmployee, employerPension(p), round2(p.pensionEmployee + employerPension(p))]),
      };
    } else {
      sheet = {
        name: 'Payroll',
        columns: ['Client', 'Period', 'Employee Code', 'Employee Name', 'Basic', 'Allowances', 'Overtime', 'PAYE', 'Employee Pension', 'NHF', 'Total Deductions', 'Net Pay', 'Total Payable', 'Payment Status'].map((h) => ({ header: h, width: 18 })),
        rows: payslips.map((p) => [...base(p), p.basicSalary, p.grossAllowances, p.overtimePay, p.paye, p.pensionEmployee, p.nhf, p.totalDeductions, p.netPay, p.totalPayable, p.paymentStatus]),
      };
    }
    const built = await buildTable([sheet], format);
    await logPayroll(req, { action: `PAYROLL_${report.toUpperCase()}_EXPORTED`, clientId: req.query.clientId || undefined, description: `${report} report exported (${year}${month ? `/${month}` : ''}, ${payslips.length} row(s))`, metadata: { report, year, month, format } });
    sendTable(res, built, `${report}-report-${year}${month ? `-${String(month).padStart(2, '0')}` : ''}`);
  } catch (err) { next(err); }
});

export default router;

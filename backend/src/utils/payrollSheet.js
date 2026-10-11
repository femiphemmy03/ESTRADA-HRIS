import { computePayslip } from './payrollEngine.js';
import { norm, toNumber } from './tabular.js';

/**
 * PAYROLL SHEET
 * -------------
 * The admin downloads a template (any subset of the columns below), fills it, and uploads it. The system
 * matches every row to an employee by Employee Code, then recomputes everything itself — any calculated
 * columns in an uploaded file (Net Salary, Management fees, …) are ignored, so the numbers always come from
 * one place. Percent rates (component split, pensions, ITF, NSITF, management fee, VAT) live per client.
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const COMPONENTS = [
  { key: 'basic', header: 'Basic', label: 'Basic' },
  { key: 'housing', header: 'Housing', label: 'Housing' },
  { key: 'transport', header: 'Transport', label: 'Transport' },
  { key: 'feeding', header: 'Feeding', label: 'Feeding' },
  { key: 'bonus13th', header: '13th Month / Bonus', label: '13th Month / Bonus' },
  { key: 'utility', header: 'Utility', label: 'Utility' },
  { key: 'leave', header: 'Leave', label: 'Leave' },
  { key: 'entertainment', header: 'Entertainment', label: 'Entertainment' },
  { key: 'furniture', header: 'Furniture', label: 'Furniture' },
  { key: 'education', header: 'Education', label: 'Education' },
  { key: 'domestic', header: 'Domestic', label: 'Domestic' },
];

// Columns the admin can put in the template. `group` drives the checklist in the UI.
export const INPUT_COLUMNS = [
  { key: 'employeeCode', header: 'Employee Code', group: 'Identity', locked: true, synonyms: ['employeecode', 'empcode', 'staffid', 'staffno', 'employeeid', 'staffnumber', 'code'] },
  { key: 'employeeName', header: 'Employee Name', group: 'Identity', locked: true, synonyms: ['employeename', 'name', 'fullname', 'staffname'] },
  { key: 'annualGross', header: 'Annual Gross', group: 'Pay', synonyms: ['annualgross', 'annualgrosssalary'] },
  { key: 'monthlyGross', header: 'Gross Salary', group: 'Pay', synonyms: ['grosssalary', 'monthlygross', 'gross', 'monthlygrosssalary'] },
  ...COMPONENTS.map((c) => ({
    key: c.key,
    header: c.header,
    group: 'Pay components',
    synonyms: c.key === 'bonus13th' ? ['13thmonthbonus', 'bonus', '13thmonthpay'] : c.key === 'leave' ? ['leave', 'leaveallowance'] : [norm(c.header)],
  })),
  { key: 'daysInMonth', header: 'No of Days', group: 'Attendance', synonyms: ['noofdays', 'daysinmonth', 'requireddays', 'workingdays'] },
  { key: 'daysWorked', header: 'No of days worked', group: 'Attendance', synonyms: ['noofdaysworked', 'daysworked', 'dayspresent'] },
  { key: 'eePension', header: 'EE pension', group: 'Deductions', synonyms: ['eepension', 'employeepension', 'employeepensioncontribution'] },
  { key: 'paye', header: 'PAYE', group: 'Deductions', synonyms: ['paye', 'tax', 'incometax'] },
  { key: 'leaveDeduction', header: 'Leave Deduction', group: 'Deductions', synonyms: ['leavededuction'] },
  { key: 'thirteenthDeduction', header: '13th Month Deduction', group: 'Deductions', synonyms: ['13thmonth', '13thmonthdeduction'] },
  { key: 'otherDeductions', header: 'Other Deductions', group: 'Deductions', synonyms: ['otherdeductions', 'otherdeduction'] },
  { key: 'groupLife', header: 'Group Life Insurance', group: 'Employer costs', synonyms: ['grouplifeinsurance', 'grouplife'] },
];

export const DEFAULT_RATES = {
  split: { basic: 30, housing: 20, transport: 10, feeding: 20, bonus13th: 3, utility: 13, leave: 4, entertainment: 0, furniture: 0, education: 0, domestic: 0 },
  eePensionPct: 8,
  erPensionPct: 10,
  itfPct: 1,
  nsitfPct: 1,
  groupLifePct: 0,
  mgmtFeePct: 12,
  vatPct: 7.5,
};

// Labels used on the "Rates" sheet of the template. label -> setter
const RATE_LABELS = [
  ...COMPONENTS.map((c) => ({ label: `${c.label} % of gross`, get: (r) => r.split[c.key], set: (r, v) => { r.split[c.key] = v; } })),
  { label: 'Employee pension % of BHT', get: (r) => r.eePensionPct, set: (r, v) => { r.eePensionPct = v; } },
  { label: 'Employer pension % of BHT', get: (r) => r.erPensionPct, set: (r, v) => { r.erPensionPct = v; } },
  { label: 'ITF % of gross', get: (r) => r.itfPct, set: (r, v) => { r.itfPct = v; } },
  { label: 'NSITF % of gross', get: (r) => r.nsitfPct, set: (r, v) => { r.nsitfPct = v; } },
  { label: 'Group life % of gross', get: (r) => r.groupLifePct, set: (r, v) => { r.groupLifePct = v; } },
  { label: 'Management fee % of total emolument', get: (r) => r.mgmtFeePct, set: (r, v) => { r.mgmtFeePct = v; } },
  { label: 'VAT % of management fee', get: (r) => r.vatPct, set: (r, v) => { r.vatPct = v; } },
];

export function mergeRates(saved) {
  const base = JSON.parse(JSON.stringify(DEFAULT_RATES));
  if (saved && typeof saved === 'object') {
    Object.assign(base.split, saved.split || {});
    for (const k of ['eePensionPct', 'erPensionPct', 'itfPct', 'nsitfPct', 'groupLifePct', 'mgmtFeePct', 'vatPct']) {
      if (typeof saved[k] === 'number') base[k] = saved[k];
    }
  }
  return base;
}

export const ratesToRows = (rates) => RATE_LABELS.map((l) => [l.label, l.get(rates)]);

/** Reads the "Rates" sheet (label/value rows). Returns rates or null if the sheet isn't there. */
export function ratesFromRows(rows, current) {
  if (!rows?.length) return null;
  const rates = mergeRates(current);
  let found = 0;
  const byLabel = new Map(RATE_LABELS.map((l) => [norm(l.label), l]));
  for (const row of rows) {
    const def = byLabel.get(norm(row[0]));
    const val = toNumber(row[1]);
    if (def && val != null && val >= 0 && val <= 100) {
      def.set(rates, val);
      found += 1;
    }
  }
  return found ? rates : null;
}

/** Maps a header row to column keys. Handles legacy sheets that repeat "Leave" / "Gross Salary". */
export function mapHeaders(headerRow) {
  const bySyn = new Map();
  INPUT_COLUMNS.forEach((c) => c.synonyms.forEach((s) => { if (!bySyn.has(s)) bySyn.set(s, c.key); }));
  const map = {};
  const seen = new Set();
  headerRow.forEach((h, idx) => {
    const n = norm(h);
    if (!n) return;
    let key = bySyn.get(n);
    if (key && seen.has(key)) {
      // second "Leave" is the deduction; second "13th Month" etc. is ignored
      key = key === 'leave' ? 'leaveDeduction' : null;
      if (key && seen.has(key)) key = null;
    }
    if (key) {
      map[key] = idx;
      seen.add(key);
    }
  });
  return map;
}

export function parseRow(row, map) {
  const out = {};
  for (const [key, idx] of Object.entries(map)) {
    const raw = row[idx];
    if (key === 'employeeCode' || key === 'employeeName') out[key] = String(raw ?? '').trim();
    else out[key] = toNumber(raw);
  }
  return out;
}

const n0 = (v) => (v == null || Number.isNaN(v) ? 0 : v);

/**
 * Computes one employee's row. Returns { errors, warnings, values, payslipData }.
 * `defaults.daysInMonth` / `defaults.daysWorked` come from the client's attendance rule and the employee's
 * attendance records, used when the sheet leaves those cells blank.
 */
export async function computeSheetRow({ row, rates, clientId, asOfDate, defaults = {} }) {
  const errors = [];
  const warnings = [];

  // ---- earnings
  const comps = {};
  COMPONENTS.forEach((c) => { comps[c.key] = n0(row[c.key]); });
  if (Object.values(comps).some((v) => v < 0)) errors.push('Pay components cannot be negative.');
  const compSum = Object.values(comps).reduce((a, b) => a + b, 0);
  const statedGross = row.monthlyGross != null ? row.monthlyGross : row.annualGross != null ? row.annualGross / 12 : null;

  let gross;
  if (compSum > 0) {
    gross = round2(compSum);
    if (statedGross != null && Math.abs(statedGross - gross) > 1) {
      warnings.push(`Components add up to ${gross.toLocaleString()} but Gross Salary says ${round2(statedGross).toLocaleString()} — components were used.`);
    }
  } else if (statedGross != null && statedGross > 0) {
    gross = round2(statedGross);
    let allocated = 0;
    for (const c of COMPONENTS) {
      comps[c.key] = round2((gross * (rates.split[c.key] || 0)) / 100);
      allocated += comps[c.key];
    }
    comps.basic = round2(comps.basic + (gross - allocated)); // rounding drift goes to basic
    if (Object.values(rates.split).reduce((a, b) => a + b, 0) !== 100) warnings.push('The component split rates do not add up to 100%.');
  } else {
    errors.push('No salary figures: fill Gross Salary (or Annual Gross), or the pay components.');
    return { errors, warnings, values: null, payslipData: null };
  }

  // ---- attendance factor
  const daysInMonth = row.daysInMonth ?? defaults.daysInMonth ?? null;
  let daysWorked = row.daysWorked ?? defaults.daysWorked ?? daysInMonth;
  let factor = 1;
  if (daysInMonth && daysInMonth > 0) {
    if (daysWorked > daysInMonth) {
      warnings.push(`Days worked (${daysWorked}) is more than days in month (${daysInMonth}) — capped at full pay.`);
    }
    factor = Math.min(1, Math.max(0, n0(daysWorked) / daysInMonth));
  } else {
    daysWorked = null;
  }

  const p = {};
  COMPONENTS.forEach((c) => { p[c.key] = round2(comps[c.key] * factor); });
  const payableGross = round2(Object.values(p).reduce((a, b) => a + b, 0));
  const bht = round2(p.basic + p.housing + p.transport);

  // ---- deductions
  const eePension = row.eePension != null ? row.eePension : round2((bht * rates.eePensionPct) / 100);
  let paye = row.paye;
  let payeNote = null;
  if (paye == null) {
    const calc = await computePayslip({
      salaryStructure: {
        basicSalary: p.basic,
        allowances: COMPONENTS.filter((c) => c.key !== 'basic').map((c) => ({ name: c.label, amount: p[c.key] })),
        deductions: [],
        payeEnabled: true,
        pensionEnabled: false,
        nhfEnabled: false,
      },
      clientId,
      asOfDate,
      overrides: { pensionEmployee: eePension },
    });
    paye = calc.paye;
    if (!calc.breakdown.statutorySettingsUsed.paye) {
      payeNote = 'No PAYE setting is configured for this client (or company-wide), so PAYE was 0. Fill the PAYE column or add a PAYE setting.';
    }
  }
  if (payeNote) warnings.push(payeNote);

  const leaveDed = n0(row.leaveDeduction);
  const thirteenthDed = n0(row.thirteenthDeduction);
  const otherDed = n0(row.otherDeductions);
  if ([eePension, paye, leaveDed, thirteenthDed, otherDed].some((v) => v < 0)) errors.push('Deductions cannot be negative.');
  const totalDeduction = round2(eePension + paye + leaveDed + thirteenthDed + otherDed);
  const netSalary = round2(payableGross - totalDeduction);
  if (netSalary < 0) errors.push('Deductions are more than the payable gross, so net pay would be negative.');

  // ---- employer side / invoice to client
  const erPension = round2((bht * rates.erPensionPct) / 100);
  const itf = round2((payableGross * rates.itfPct) / 100);
  const nsitf = round2((payableGross * rates.nsitfPct) / 100);
  const groupLife = row.groupLife != null ? row.groupLife : round2((payableGross * rates.groupLifePct) / 100);
  const totalAdditions = round2(erPension + itf + nsitf + groupLife);
  const totalEmolument = round2(payableGross + totalAdditions);
  const managementFees = round2((totalEmolument * rates.mgmtFeePct) / 100);
  const vat = round2((managementFees * rates.vatPct) / 100);
  const payableToProvider = round2(totalEmolument + managementFees + vat);

  const values = {
    annualGross: round2(gross * 12),
    grossSalary: gross,
    payableGross,
    ...comps, // full-month component amounts
    payableComponents: p,
    eePension,
    paye,
    leaveDeduction: leaveDed,
    thirteenthDeduction: thirteenthDed,
    otherDeductions: otherDed,
    totalDeduction,
    netSalary,
    daysInMonth: daysInMonth ?? null,
    daysWorked: daysWorked ?? null,
    dailyGrossRate: daysInMonth ? round2(gross / daysInMonth) : null,
    employerPension: erPension,
    itf,
    nsitf,
    groupLife,
    totalAdditions,
    totalEmolument,
    managementFees,
    vat,
    payableToProvider,
  };

  const allowances = COMPONENTS.filter((c) => c.key !== 'basic' && p[c.key] > 0).map((c) => ({ name: c.label, amount: p[c.key] }));
  const deductions = [
    ...(leaveDed ? [{ name: 'Leave', amount: leaveDed }] : []),
    ...(thirteenthDed ? [{ name: '13th Month', amount: thirteenthDed }] : []),
    ...(otherDed ? [{ name: 'Other Deductions', amount: otherDed }] : []),
  ];

  const payslipData = {
    basicSalary: p.basic,
    grossAllowances: round2(payableGross - p.basic),
    overtimePay: 0,
    paye,
    pensionEmployee: eePension,
    nhf: 0,
    totalDeductions: totalDeduction,
    netPay: netSalary,
    totalPayable: netSalary,
    daysPresent: daysWorked ?? null,
    requiredDays: daysInMonth ? Math.round(daysInMonth) : null,
    prorationFactor: daysInMonth ? Math.round(factor * 10000) / 10000 : null,
    breakdown: {
      source: 'SHEET',
      allowances,
      deductions,
      grossPay: payableGross,
      statutoryApplied: { paye: paye > 0, pension: eePension > 0, nhf: false },
      statutorySettingsUsed: { paye: row.paye != null ? 'Uploaded sheet' : null, pension: row.eePension != null ? 'Uploaded sheet' : `${rates.eePensionPct}% of BHT`, nhf: null },
      sheet: values,
    },
  };

  return { errors, warnings, values, payslipData };
}

/** Column layout of the full payroll sheet export (mirrors the sheet the business already uses). */
export const FULL_SHEET_COLUMNS = [
  ['Employee Code', (v, e) => e.code],
  ['Employee Name', (v, e) => e.name],
  ['Annual Gross', (v) => v.annualGross],
  ['Gross Salary', (v) => v.grossSalary],
  ['Payable Gross Salary', (v) => v.payableGross],
  ...COMPONENTS.map((c) => [c.header, (v) => v[c.key]]),
  ['EE pension', (v) => v.eePension],
  ['PAYE', (v) => v.paye],
  ['Leave Deduction', (v) => v.leaveDeduction],
  ['13th Month Deduction', (v) => v.thirteenthDeduction],
  ['Other Deductions', (v) => v.otherDeductions],
  ['Total deduction', (v) => v.totalDeduction],
  ['Net Salary', (v) => v.netSalary],
  ['No of Days', (v) => v.daysInMonth],
  ['No of days worked', (v) => v.daysWorked],
  ['Daily Gross Rate', (v) => v.dailyGrossRate],
  ["Employer's pension", (v) => v.employerPension],
  ['ITF', (v) => v.itf],
  ['NSITF', (v) => v.nsitf],
  ['Group Life Insurance', (v) => v.groupLife],
  ['Total addition provision', (v) => v.totalAdditions],
  ['Total Employee Emolument', (v) => v.totalEmolument],
  ['Management fees', (v) => v.managementFees],
  ['VAT', (v) => v.vat],
  ['Amount payable to service provider', (v) => v.payableToProvider],
];

/** Builds the `sheet` values for a payslip that did NOT come from an upload (best-effort from stored fields). */
export function valuesFromPayslip(p) {
  const comps = Object.fromEntries(COMPONENTS.map((c) => [c.key, 0]));
  comps.basic = p.basicSalary;
  (p.breakdown?.allowances || []).forEach((a) => {
    const c = COMPONENTS.find((x) => norm(x.label) === norm(a.name));
    if (c) comps[c.key] += a.amount;
  });
  const payableGross = round2(p.basicSalary + p.grossAllowances);
  const other = (p.breakdown?.deductions || []).reduce((n, d) => n + d.amount, 0);
  return {
    annualGross: round2(payableGross * 12),
    grossSalary: payableGross,
    payableGross,
    ...comps,
    eePension: p.pensionEmployee,
    paye: p.paye,
    leaveDeduction: 0,
    thirteenthDeduction: 0,
    otherDeductions: round2(other),
    totalDeduction: p.totalDeductions,
    netSalary: p.netPay,
    daysInMonth: p.requiredDays ?? null,
    daysWorked: p.daysPresent ?? null,
    dailyGrossRate: null,
    employerPension: null, itf: null, nsitf: null, groupLife: null, totalAdditions: null,
    totalEmolument: null, managementFees: null, vat: null, payableToProvider: null,
  };
}

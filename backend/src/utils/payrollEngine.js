import { prisma } from '../lib/prisma.js';

/**
 * Fetches the active PayrollSettings rows for a given "as of" date.
 * Effective-dated so historical payroll runs stay accurate even after rules change.
 */
async function getActiveSettings(type, asOfDate) {
  return prisma.payrollSettings.findFirst({
    where: {
      type,
      isActive: true,
      effectiveFrom: { lte: asOfDate },
      OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
    },
    orderBy: { effectiveFrom: 'desc' },
  });
}

/**
 * A PayrollSettings.config for type=PAYE looks like:
 * { "mode": "BRACKETS", "consolidatedReliefFlat": 200000, "consolidatedReliefPercent": 0.01,
 *   "brackets": [{ "upTo": 300000, "rate": 0.07 }, { "upTo": 600000, "rate": 0.11 }, ...] }
 * For PENSION_EMPLOYEE / NHF: { "mode": "FLAT_PERCENT", "percent": 0.08, "base": "BASIC_PLUS_HOUSING_TRANSPORT" }
 * Admins configure this from the Payroll Settings screen — nothing here is hardcoded to Nigerian law directly.
 */
function applyFlatPercent(config, base) {
  return round2(base * (config.percent ?? 0));
}

function applyBrackets(config, annualTaxable) {
  let remaining = annualTaxable;
  let tax = 0;
  let lastCap = 0;
  for (const band of config.brackets ?? []) {
    const bandSize = band.upTo - lastCap;
    const taxableInBand = Math.min(Math.max(remaining, 0), bandSize);
    tax += taxableInBand * band.rate;
    remaining -= taxableInBand;
    lastCap = band.upTo;
    if (remaining <= 0) break;
  }
  if (remaining > 0 && config.topRate) {
    tax += remaining * config.topRate;
  }
  return tax;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Computes a full payslip breakdown for one employee for one payroll period.
 */
export async function computePayslip({ salaryStructure, overtimeHours = 0, overtimeRate = 0, asOfDate = new Date() }) {
  const basic = salaryStructure.basicSalary;
  const allowances = salaryStructure.allowances || [];
  const deductions = salaryStructure.deductions || [];

  const grossAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
  const grossPay = basic + grossAllowances;
  const overtimePay = round2(overtimeHours * overtimeRate);

  const pensionSettings = await getActiveSettings('PENSION_EMPLOYEE', asOfDate);
  const nhfSettings = await getActiveSettings('NHF', asOfDate);
  const payeSettings = await getActiveSettings('PAYE', asOfDate);

  const pensionBase = basic + grossAllowances;
  const pensionEmployee = pensionSettings ? applyFlatPercent(pensionSettings.config, pensionBase) : 0;
  const nhf = nhfSettings ? applyFlatPercent(nhfSettings.config, basic) : 0;

  let paye = 0;
  if (payeSettings) {
    const annualGross = grossPay * 12;
    const relief =
      (payeSettings.config.consolidatedReliefFlat ?? 0) +
      annualGross * (payeSettings.config.consolidatedReliefPercent ?? 0);
    const annualTaxable = Math.max(annualGross - relief - pensionEmployee * 12, 0);
    const annualTax = applyBrackets(payeSettings.config, annualTaxable);
    paye = round2(annualTax / 12);
  }

  const otherDeductions = deductions.reduce((sum, d) => sum + d.amount, 0);
  const totalDeductions = round2(pensionEmployee + nhf + paye + otherDeductions);
  const netPay = round2(grossPay + overtimePay - totalDeductions);

  return {
    basicSalary: basic,
    grossAllowances: round2(grossAllowances),
    overtimePay,
    paye: round2(paye),
    pensionEmployee: round2(pensionEmployee),
    nhf: round2(nhf),
    totalDeductions,
    netPay,
    breakdown: {
      allowances,
      deductions,
      pensionBase,
      grossPay: round2(grossPay),
    },
  };
}

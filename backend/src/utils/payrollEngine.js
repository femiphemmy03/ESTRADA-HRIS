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
 *
 * PAYE, Pension, and NHF are only applied if the employee's salary structure has the
 * corresponding toggle enabled (payeEnabled / pensionEnabled / nhfEnabled) — these default
 * to false, so nothing is deducted for an employee until someone explicitly turns it on.
 * This matters because not every employee has the same statutory arrangement (contractors,
 * exempt staff, different pension schemes, etc.) — a blanket company-wide rule doesn't fit.
 */
export async function computePayslip({ salaryStructure, overtimeHours = 0, overtimeRate = 0, asOfDate = new Date() }) {
  const basic = salaryStructure.basicSalary;
  const allowances = salaryStructure.allowances || [];
  const deductions = salaryStructure.deductions || [];

  const grossAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
  const grossPay = basic + grossAllowances;
  const overtimePay = round2(overtimeHours * overtimeRate);

  let pensionEmployee = 0;
  if (salaryStructure.pensionEnabled) {
    const pensionSettings = await getActiveSettings('PENSION_EMPLOYEE', asOfDate);
    const pensionBase = basic + grossAllowances;
    pensionEmployee = pensionSettings ? applyFlatPercent(pensionSettings.config, pensionBase) : 0;
  }

  let nhf = 0;
  if (salaryStructure.nhfEnabled) {
    const nhfSettings = await getActiveSettings('NHF', asOfDate);
    nhf = nhfSettings ? applyFlatPercent(nhfSettings.config, basic) : 0;
  }

  let paye = 0;
  if (salaryStructure.payeEnabled) {
    const payeSettings = await getActiveSettings('PAYE', asOfDate);
    if (payeSettings) {
      const annualGross = grossPay * 12;
      const relief =
        (payeSettings.config.consolidatedReliefFlat ?? 0) +
        annualGross * (payeSettings.config.consolidatedReliefPercent ?? 0);
      const annualTaxable = Math.max(annualGross - relief - pensionEmployee * 12, 0);
      const annualTax = applyBrackets(payeSettings.config, annualTaxable);
      paye = round2(annualTax / 12);
    }
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
      grossPay: round2(grossPay),
      statutoryApplied: {
        paye: !!salaryStructure.payeEnabled,
        pension: !!salaryStructure.pensionEnabled,
        nhf: !!salaryStructure.nhfEnabled,
      },
    },
  };
}

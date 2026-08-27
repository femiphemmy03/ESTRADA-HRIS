import { prisma } from '../lib/prisma.js';

/**
 * Fetches the applicable PayrollSettings row for a given type/date/client.
 * A client-specific rate (clientId matches) takes priority over the company-wide
 * fallback (clientId is null) if both exist for the same period — this lets an
 * outsourcing company honor a specific client's contractual pension/statutory
 * arrangement without it leaking into every other client's payroll.
 */
async function getActiveSettings(type, asOfDate, clientId) {
  if (clientId) {
    const clientSpecific = await prisma.payrollSettings.findFirst({
      where: {
        type,
        clientId,
        isActive: true,
        effectiveFrom: { lte: asOfDate },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: asOfDate } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (clientSpecific) return clientSpecific;
  }

  return prisma.payrollSettings.findFirst({
    where: {
      type,
      clientId: null,
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
 *
 * The actual rates come from Statutory Settings, resolved per-client (falls back to the
 * company-wide rate if the employee's client has no specific override). There is no
 * hardcoded/example rate anywhere in this file — if nothing has been configured yet,
 * the toggle simply has no effect, rather than silently applying a guessed number.
 */
export async function computePayslip({ salaryStructure, clientId = null, overtimeHours = 0, overtimeRate = 0, asOfDate = new Date() }) {
  const basic = salaryStructure.basicSalary;
  const allowances = salaryStructure.allowances || [];
  const deductions = salaryStructure.deductions || [];

  const grossAllowances = allowances.reduce((sum, a) => sum + a.amount, 0);
  const grossPay = basic + grossAllowances;
  const overtimePay = round2(overtimeHours * overtimeRate);

  let pensionEmployee = 0;
  let pensionSettingsUsed = null;
  if (salaryStructure.pensionEnabled) {
    const pensionSettings = await getActiveSettings('PENSION_EMPLOYEE', asOfDate, clientId);
    const pensionBase = basic + grossAllowances;
    pensionEmployee = pensionSettings ? applyFlatPercent(pensionSettings.config, pensionBase) : 0;
    pensionSettingsUsed = pensionSettings?.name || null;
  }

  let nhf = 0;
  let nhfSettingsUsed = null;
  if (salaryStructure.nhfEnabled) {
    const nhfSettings = await getActiveSettings('NHF', asOfDate, clientId);
    nhf = nhfSettings ? applyFlatPercent(nhfSettings.config, basic) : 0;
    nhfSettingsUsed = nhfSettings?.name || null;
  }

  let paye = 0;
  let payeSettingsUsed = null;
  if (salaryStructure.payeEnabled) {
    const payeSettings = await getActiveSettings('PAYE', asOfDate, clientId);
    if (payeSettings) {
      const annualGross = grossPay * 12;
      const relief =
        (payeSettings.config.consolidatedReliefFlat ?? 0) +
        annualGross * (payeSettings.config.consolidatedReliefPercent ?? 0);
      const annualTaxable = Math.max(annualGross - relief - pensionEmployee * 12, 0);
      const annualTax = applyBrackets(payeSettings.config, annualTaxable);
      paye = round2(annualTax / 12);
      payeSettingsUsed = payeSettings.name;
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
      // Which specific rate/settings row was actually used, for auditability.
      statutorySettingsUsed: {
        paye: payeSettingsUsed,
        pension: pensionSettingsUsed,
        nhf: nhfSettingsUsed,
      },
    },
  };
}

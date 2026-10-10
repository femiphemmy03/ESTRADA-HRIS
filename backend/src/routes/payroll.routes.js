import { Router } from 'express';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { computePayslip } from '../utils/payrollEngine.js';
import { uploadToSupabase } from '../lib/supabase.js';
import { sendPayslipReadyEmail } from '../lib/mailer.js';
import { logPayroll } from '../utils/activityLog.js';
import { getScope, inScope, clientWhere } from '../utils/clientScope.js';
import { getRuleForEmployee } from '../utils/attendanceRules.js';
import { getProration } from '../utils/attendanceSummary.js';
import { disburseSalary } from '../utils/wallet.js';
import { notifyUsers, notifyClientAdmins } from '../utils/notify.js';
import { httpError } from '../utils/httpError.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'estrada-logo.png');

const router = Router();
router.use(requireAuth);
// PAYROLL_ROLES: can edit salary structures, statutory settings, create/process runs, submit for approval.
// APPROVAL_ROLES: can act on runs pending approval. HR_MANAGER sits in both — full access except
// the very last step (final-approve), which stays Super-Admin-only by design.
const PAYROLL_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];
const APPROVAL_ROLES = ['SUPER_ADMIN', 'HR_MANAGER'];
const VIEW_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];

// Client scoping: Super Admin works across all clients; every other payroll role only touches the
// clients the Super Admin assigned to them. Employees not yet placed under any client are treated as
// an unassigned pool and stay reachable so their salary can be set up before placement.
async function assertEmployeeInScope(req, employeeId) {
  const emp = await prisma.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, clientId: true, firstName: true, lastName: true, employeeCode: true },
  });
  if (!emp) throw httpError(404, 'Employee not found');
  if (req.user.role !== 'SUPER_ADMIN' && emp.clientId) {
    const scope = await getScope(req.user);
    if (!inScope(scope, emp.clientId)) throw httpError(403, 'This employee belongs to a client you are not assigned to.');
  }
  return emp;
}

// Loads a payroll run and enforces client scoping. Runs belong to one client; legacy runs from before
// client-wise payroll (clientId = null) are Super Admin only.
async function loadRun(req, id) {
  const run = await prisma.payrollRun.findUnique({ where: { id } });
  if (!run) throw httpError(404, 'Payroll run not found');
  if (req.user.role !== 'SUPER_ADMIN') {
    const scope = await getScope(req.user);
    if (!run.clientId || !inScope(scope, run.clientId)) throw httpError(403, 'This payroll run belongs to a client you are not assigned to.');
  }
  return run;
}

const naira = (n) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const pickStructure = (st) => ({
  basicSalary: st.basicSalary,
  allowances: st.allowances,
  deductions: st.deductions,
  payeEnabled: st.payeEnabled,
  pensionEnabled: st.pensionEnabled,
  nhfEnabled: st.nhfEnabled,
});

// ---------- Salary Structure ----------
const salarySchema = z.object({
  employeeId: z.string(),
  basicSalary: z.number(),
  allowances: z.array(z.object({ name: z.string(), amount: z.number() })).default([]),
  deductions: z.array(z.object({ name: z.string(), amount: z.number() })).default([]),
  payeEnabled: z.boolean().default(false),
  pensionEnabled: z.boolean().default(false),
  nhfEnabled: z.boolean().default(false),
});

router.put('/salary-structure', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const data = salarySchema.parse(req.body);
    const emp = await assertEmployeeInScope(req, data.employeeId);
    const before = await prisma.salaryStructure.findUnique({ where: { employeeId: data.employeeId } });
    const structure = await prisma.salaryStructure.upsert({
      where: { employeeId: data.employeeId },
      update: {
        basicSalary: data.basicSalary,
        allowances: data.allowances,
        deductions: data.deductions,
        payeEnabled: data.payeEnabled,
        pensionEnabled: data.pensionEnabled,
        nhfEnabled: data.nhfEnabled,
        effectiveFrom: new Date(),
      },
      create: data,
    });
    await logPayroll(req, {
      action: before ? 'PAYROLL_SALARY_STRUCTURE_UPDATED' : 'PAYROLL_SALARY_STRUCTURE_CREATED',
      employeeId: emp.id,
      clientId: emp.clientId || undefined,
      description: `Salary structure ${before ? 'updated' : 'set'} for ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`,
      metadata: { before: before ? pickStructure(before) : null, after: pickStructure(structure) },
    });
    res.json({ structure });
  } catch (err) { next(err); }
});

router.get('/salary-structure/:employeeId', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    await assertEmployeeInScope(req, req.params.employeeId);
    const structure = await prisma.salaryStructure.findUnique({ where: { employeeId: req.params.employeeId } });
    res.json({ structure });
  } catch (err) { next(err); }
});

// ---------- Payroll Settings ----------
router.get('/settings', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const settings = await prisma.payrollSettings.findMany({
      // Company-wide settings are visible to all payroll roles; client-specific ones only to their assigned admins.
      where: scope.all ? {} : { OR: [{ clientId: null }, { clientId: { in: scope.clientIds } }] },
      orderBy: { effectiveFrom: 'desc' },
      include: { client: { select: { name: true } } },
    });
    res.json({ settings });
  } catch (err) { next(err); }
});

const settingsSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['PAYE', 'PENSION_EMPLOYEE', 'PENSION_EMPLOYER', 'NHF', 'CUSTOM']),
  config: z.record(z.any()),
  clientId: z.string().optional().nullable(), // null/omitted = company-wide fallback
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
});

router.post('/settings', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const data = settingsSchema.parse(req.body);
    if (req.user.role !== 'SUPER_ADMIN') {
      const scope = await getScope(req.user);
      if (!data.clientId) throw httpError(403, 'Only the Super Admin can set company-wide statutory settings. Choose one of your assigned clients.');
      if (!inScope(scope, data.clientId)) throw httpError(403, 'You are not assigned to this client.');
    }
    const setting = await prisma.payrollSettings.create({
      data: {
        ...data,
        clientId: data.clientId || null,
        effectiveFrom: new Date(data.effectiveFrom),
        effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null,
      },
    });
    await logPayroll(req, {
      action: 'PAYROLL_SETTING_CREATED',
      clientId: setting.clientId || undefined,
      description: `Statutory setting "${setting.name}" (${setting.type}) created${setting.clientId ? '' : ' — company-wide'}, effective ${data.effectiveFrom}`,
      metadata: { settingId: setting.id, type: setting.type, config: setting.config },
    });
    res.status(201).json({ setting });
  } catch (err) { next(err); }
});

router.patch('/settings/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const patch = z
      .object({
        name: z.string().min(1).optional(),
        config: z.record(z.any()).optional(),
        isActive: z.boolean().optional(),
        effectiveFrom: z.string().optional(),
        effectiveTo: z.string().nullable().optional(),
      })
      .parse(req.body);
    const existing = await prisma.payrollSettings.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Setting not found');
    if (req.user.role !== 'SUPER_ADMIN') {
      const scope = await getScope(req.user);
      if (!inScope(scope, existing.clientId)) throw httpError(403, 'Only the Super Admin can change company-wide settings, or settings for clients you are not assigned to.');
    }
    const setting = await prisma.payrollSettings.update({
      where: { id: req.params.id },
      data: {
        ...patch,
        effectiveFrom: patch.effectiveFrom ? new Date(patch.effectiveFrom) : undefined,
        effectiveTo: patch.effectiveTo === undefined ? undefined : patch.effectiveTo ? new Date(patch.effectiveTo) : null,
      },
    });
    await logPayroll(req, {
      action: patch.isActive === false ? 'PAYROLL_SETTING_DEACTIVATED' : 'PAYROLL_SETTING_UPDATED',
      clientId: setting.clientId || undefined,
      description: `Statutory setting "${setting.name}" (${setting.type}) ${patch.isActive === false ? 'deactivated' : 'updated'}`,
      metadata: { settingId: setting.id, before: { name: existing.name, config: existing.config, isActive: existing.isActive }, changes: patch },
    });
    res.json({ setting });
  } catch (err) { next(err); }
});

// ---------- Loans & Advances ----------
router.post('/loans', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const data = z.object({ employeeId: z.string(), principal: z.number(), monthlyDeduction: z.number(), reason: z.string().optional() }).parse(req.body);
    const emp = await assertEmployeeInScope(req, data.employeeId);
    const loan = await prisma.loan.create({ data: { ...data, balanceRemaining: data.principal } });
    await logPayroll(req, { action: 'PAYROLL_LOAN_CREATED', employeeId: emp.id, clientId: emp.clientId || undefined, description: `Loan of ${data.principal} recorded for ${emp.firstName} ${emp.lastName} (${emp.employeeCode})`, metadata: { loanId: loan.id, principal: data.principal, monthlyDeduction: data.monthlyDeduction } });
    res.status(201).json({ loan });
  } catch (err) { next(err); }
});

router.post('/advances', async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) throw httpError(400, 'Only employees can request a salary advance.');
    const data = z.object({ amount: z.number(), reason: z.string().optional() }).parse(req.body);
    const advance = await prisma.salaryAdvance.create({ data: { employeeId: employee.id, ...data } });
    await logPayroll(req, { action: 'PAYROLL_ADVANCE_REQUESTED', employeeId: employee.id, clientId: employee.clientId || undefined, description: `Salary advance of ${data.amount} requested by ${employee.firstName} ${employee.lastName}`, metadata: { advanceId: advance.id, amount: data.amount } });
    res.status(201).json({ advance });
  } catch (err) { next(err); }
});

router.post('/advances/:id/decision', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    const existing = await prisma.salaryAdvance.findUnique({ where: { id: req.params.id } });
    if (!existing) throw httpError(404, 'Advance not found');
    const emp = await assertEmployeeInScope(req, existing.employeeId);
    const advance = await prisma.salaryAdvance.update({ where: { id: req.params.id }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
    await logPayroll(req, { action: approve ? 'PAYROLL_ADVANCE_APPROVED' : 'PAYROLL_ADVANCE_REJECTED', employeeId: emp.id, clientId: emp.clientId || undefined, description: `Salary advance of ${existing.amount} for ${emp.firstName} ${emp.lastName} ${approve ? 'approved' : 'rejected'}`, metadata: { advanceId: advance.id } });
    res.json({ advance });
  } catch (err) { next(err); }
});

// ---------- Payroll Runs ----------
router.post('/runs', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const { month, year, clientId } = z.object({ month: z.number().min(1).max(12), year: z.number(), clientId: z.string().min(1, 'Choose a client for this payroll run') }).parse(req.body);
    if (req.user.role !== 'SUPER_ADMIN') {
      const scope = await getScope(req.user);
      if (!inScope(scope, clientId)) throw httpError(403, 'You are not assigned to this client.');
    }
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
    if (!client) throw httpError(404, 'Client not found');

    // One run per client per month.
    let run = await prisma.payrollRun.findFirst({ where: { month, year, clientId } });
    const created = !run;
    if (!run) run = await prisma.payrollRun.create({ data: { month, year, clientId } });
    if (created) {
      await logPayroll(req, { action: 'PAYROLL_RUN_CREATED', clientId, description: `Payroll run ${month}/${year} opened for ${client.name}`, metadata: { runId: run.id, month, year } });
    }
    res.status(created ? 201 : 200).json({ run });
  } catch (err) { next(err); }
});

router.get('/runs', requireRole(...VIEW_ROLES), async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const runs = await prisma.payrollRun.findMany({
      where: scope.all ? {} : { clientId: { in: scope.clientIds } }, // legacy (client-less) runs are Super Admin only
      orderBy: [{ year: 'desc' }, { month: 'desc' }],
      include: { client: { select: { id: true, name: true } } },
    });
    res.json({ runs });
  } catch (err) { next(err); }
});

router.post('/runs/:id/process', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    if (!['DRAFT', 'REVIEW', 'REJECTED'].includes(run.status)) {
      return res.status(400).json({ message: 'This run has already been submitted for approval and can no longer be reprocessed. Reject it back to Review first if changes are needed.' });
    }

    // A run covers one client's active employees. (Legacy client-less runs, Super Admin only, cover everyone.)
    const employees = await prisma.employee.findMany({
      where: { employmentStatus: 'ACTIVE', salaryStructure: { isNot: null }, ...(run.clientId ? { clientId: run.clientId } : {}) },
      include: { salaryStructure: true },
    });

    const asOfDate = new Date(run.year, run.month - 1, 1);
    const results = [];
    const ruleCache = new Map();
    let prorated = 0;

    for (const emp of employees) {
      // Client attendance rule with a fixed number of required present days -> prorate pay
      const ruleKey = `${emp.siteId || ''}|${emp.clientId || ''}`;
      if (!ruleCache.has(ruleKey)) ruleCache.set(ruleKey, await getRuleForEmployee(emp));
      const proration = await getProration(emp, ruleCache.get(ruleKey), run.month, run.year);
      if (proration && proration.factor < 1) prorated += 1;

      const computed = await computePayslip({
        salaryStructure: emp.salaryStructure,
        clientId: emp.clientId,
        asOfDate,
        prorationFactor: proration ? proration.factor : 1,
        attendanceInfo: proration ? { daysPresent: proration.daysPresent, requiredDays: proration.requiredDays, counts: proration.counts } : null,
      });
      const payslip = await prisma.payslip.upsert({
        where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: emp.id } },
        update: computed,
        create: { payrollRunId: run.id, employeeId: emp.id, ...computed },
      });
      results.push(payslip);
    }

    await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'REVIEW' } });
    await logPayroll(req, {
      action: 'PAYROLL_RUN_PROCESSED',
      clientId: run.clientId || undefined,
      description: `Payroll run ${run.month}/${run.year} processed — ${results.length} payslip(s) computed${prorated ? `, ${prorated} prorated for attendance` : ''}`,
      metadata: { runId: run.id, payslips: results.length, prorated, netTotal: Math.round(results.reduce((n, p) => n + p.netPay, 0) * 100) / 100 },
    });
    res.json({ payslips: results });
  } catch (err) { next(err); }
});

router.post('/runs/:id/submit-for-approval', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    if (run.status !== 'REVIEW') {
      return res.status(400).json({ message: 'Only a processed run in Review status can be submitted for approval.' });
    }
    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'PENDING_HR_MANAGER',
        submittedById: req.user.employee?.id,
        submittedAt: new Date(),
        rejectionReason: null,
      },
    });
    await logPayroll(req, { action: 'PAYROLL_RUN_SUBMITTED', description: `Payroll run ${run.month}/${run.year} submitted for HR Manager approval`, metadata: { runId: run.id } });
    res.json({ run: updated });
  } catch (err) { next(err); }
});

router.post('/runs/:id/hr-manager-approve', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    if (run.status !== 'PENDING_HR_MANAGER') {
      return res.status(400).json({ message: 'This run is not awaiting HR Manager approval.' });
    }
    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: {
        status: 'PENDING_SUPER_ADMIN',
        hrManagerApprovedById: req.user.employee?.id,
        hrManagerApprovedAt: new Date(),
      },
    });
    await logPayroll(req, { action: 'PAYROLL_HR_MANAGER_APPROVED', metadata: { runId: run.id }, description: `Payroll run ${run.month}/${run.year} approved by HR Manager, sent to Super Admin` });
    res.json({ run: updated });
  } catch (err) { next(err); }
});

router.post('/runs/:id/final-approve', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    if (run.status !== 'PENDING_SUPER_ADMIN') {
      return res.status(400).json({ message: 'This run is not awaiting final approval.' });
    }

    await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'APPROVED', approvedById: req.user.employee?.id, approvedAt: new Date() },
    });

    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: run.id },
      include: { employee: { include: { user: true } }, payrollRun: true },
    });

    const generated = [];
    for (const payslip of payslips) {
      try {
        const updated = await generateAndStorePayslipPdf(payslip);
        generated.push(updated);
      } catch (pdfErr) {
        console.error(`[payroll] Failed to generate PDF for payslip ${payslip.id}:`, pdfErr.message);
      }
    }

    await logPayroll(req, { action: 'PAYROLL_FINAL_APPROVED', metadata: { runId: run.id, payslipsGenerated: generated.length }, description: `Payroll run ${run.month}/${run.year} given final approval by Super Admin — ${generated.length} payslip(s) generated` });

    res.json({ run: { ...run, status: 'APPROVED' }, payslipsGenerated: generated.length });
  } catch (err) { next(err); }
});

router.post('/runs/:id/reject', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const run = await loadRun(req, req.params.id);
    if (!['PENDING_HR_MANAGER', 'PENDING_SUPER_ADMIN'].includes(run.status)) {
      return res.status(400).json({ message: 'This run is not in a state that can be rejected.' });
    }
    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'REVIEW', rejectionReason: reason },
    });
    await logPayroll(req, { action: 'PAYROLL_REJECTED', metadata: { runId: run.id, reason }, description: `Payroll run ${run.month}/${run.year} sent back to Review: ${reason}` });
    res.json({ run: updated });
  } catch (err) { next(err); }
});

router.get('/runs/:id/payslips', requireRole(...VIEW_ROLES), async (req, res, next) => {
  try {
    await loadRun(req, req.params.id);
    const scope = await getScope(req.user);
    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: req.params.id, employee: clientWhere(scope, 'clientId') },
      orderBy: { employee: { firstName: 'asc' } },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });
    res.json({ payslips });
  } catch (err) { next(err); }
});

router.get('/payslips/me', async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    if (!employee) return res.json({ payslips: [] });
    const payslips = await prisma.payslip.findMany({
      where: { employeeId: employee.id, payrollRun: { status: { in: ['APPROVED', 'PAID'] } } },
      include: { payrollRun: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ payslips });
  } catch (err) { next(err); }
});

async function generateAndStorePayslipPdf(payslip) {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  try {
    const logoBytes = fs.readFileSync(LOGO_PATH);
    const logoImage = await pdfDoc.embedPng(logoBytes);
    const logoWidth = 130;
    const logoHeight = (logoImage.height / logoImage.width) * logoWidth;
    const logoX = 595 - logoWidth - 50;
    const logoY = 842 - logoHeight - 40;
    page.drawImage(logoImage, { x: logoX, y: logoY, width: logoWidth, height: logoHeight });
  } catch (logoErr) {
    console.error('[payroll] Logo not embedded (asset missing?):', logoErr.message);
  }

  let y = 800;
  const draw = (text, size = 11, f = font, color = rgb(0, 0, 0)) => {
    page.drawText(text, { x: 50, y, size, font: f, color });
    y -= size + 8;
  };

  draw('ESTRADA INTERNATIONAL — PAYSLIP', 16, bold, rgb(0.93, 0.2, 0.13));
  draw(`${payslip.employee.firstName} ${payslip.employee.lastName} (${payslip.employee.employeeCode})`, 12, bold);
  draw(`Period: ${payslip.payrollRun.month}/${payslip.payrollRun.year}`);
  y -= 10;
  draw(`Basic Salary: ${payslip.basicSalary.toFixed(2)}`);
  draw(`Gross Allowances: ${payslip.grossAllowances.toFixed(2)}`);
  draw(`Overtime Pay: ${payslip.overtimePay.toFixed(2)}`);
  draw(`PAYE: -${payslip.paye.toFixed(2)}`);
  draw(`Pension (Employee): -${payslip.pensionEmployee.toFixed(2)}`);
  draw(`NHF: -${payslip.nhf.toFixed(2)}`);
  draw(`Total Deductions: -${payslip.totalDeductions.toFixed(2)}`);
  y -= 10;
  draw(`NET PAY: ${payslip.netPay.toFixed(2)}`, 14, bold, rgb(0.11, 0.16, 0.29));

  const pdfBytes = await pdfDoc.save();
  const destinationPath = `payslips/${payslip.employeeId}/${payslip.payrollRun.year}-${payslip.payrollRun.month}.pdf`;
  const { url } = await uploadToSupabase(Buffer.from(pdfBytes), destinationPath, 'application/pdf');

  const updated = await prisma.payslip.update({ where: { id: payslip.id }, data: { pdfUrl: url } });

  await sendPayslipReadyEmail({
    to: payslip.employee.user.email,
    firstName: payslip.employee.firstName,
    month: payslip.payrollRun.month,
    year: payslip.payrollRun.year,
  });

  return updated;
}

router.post('/payslips/:id/generate-pdf', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const payslip = await prisma.payslip.findUnique({
      where: { id: req.params.id },
      include: { employee: { include: { user: true } }, payrollRun: true },
    });
    if (!payslip) return res.status(404).json({ message: 'Payslip not found' });
    if (!['APPROVED', 'PAID'].includes(payslip.payrollRun.status)) {
      return res.status(400).json({ message: 'This payslip belongs to a run that has not completed approval yet.' });
    }
    const updated = await generateAndStorePayslipPdf(payslip);
    await logPayroll(req, { action: 'PAYROLL_PAYSLIP_PDF_GENERATED', employeeId: payslip.employeeId, description: `Payslip PDF regenerated for ${payslip.employee.firstName} ${payslip.employee.lastName} (${payslip.payrollRun.month}/${payslip.payrollRun.year})`, metadata: { payslipId: payslip.id } });
    res.json({ payslip: updated });
  } catch (err) { next(err); }
});

router.get('/runs/:id/export', requireRole(...VIEW_ROLES), async (req, res, next) => {
  try {
    await loadRun(req, req.params.id);
    const scope = await getScope(req.user);
    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: req.params.id, employee: clientWhere(scope, 'clientId') },
      include: { employee: true },
    });
    await logPayroll(req, { action: 'PAYROLL_RUN_EXPORTED', description: `Payroll run ${req.params.id} exported to Excel (${payslips.length} row(s))`, metadata: { runId: req.params.id, rows: payslips.length } });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Payroll');
    sheet.columns = [
      { header: 'Employee Code', key: 'code', width: 18 },
      { header: 'Name', key: 'name', width: 28 },
      { header: 'Basic', key: 'basic', width: 14 },
      { header: 'Allowances', key: 'allowances', width: 14 },
      { header: 'Overtime', key: 'overtime', width: 14 },
      { header: 'PAYE', key: 'paye', width: 14 },
      { header: 'Pension', key: 'pension', width: 14 },
      { header: 'NHF', key: 'nhf', width: 12 },
      { header: 'Net Pay', key: 'net', width: 14 },
      { header: 'Total Payable', key: 'payable', width: 14 },
      { header: 'Days Present', key: 'days', width: 13 },
      { header: 'Required Days', key: 'required', width: 14 },
      { header: 'Payment Approval', key: 'approval', width: 17 },
      { header: 'Payment Status', key: 'status', width: 16 },
    ];
    payslips.forEach((p) => {
      sheet.addRow({
        code: p.employee.employeeCode,
        name: `${p.employee.firstName} ${p.employee.lastName}`,
        basic: p.basicSalary,
        allowances: p.grossAllowances,
        overtime: p.overtimePay,
        paye: p.paye,
        pension: p.pensionEmployee,
        nhf: p.nhf,
        net: p.netPay,
        payable: p.totalPayable,
        days: p.daysPresent ?? '',
        required: p.requiredDays ?? '',
        approval: p.paymentApproval,
        status: p.paymentStatus,
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=payroll-${req.params.id}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

// ---------- Payment approval & disbursement (Super Admin only) ----------
// After a run is fully approved, the Super Admin ticks which employees are approved for payment, then
// disburses. HR Admin / HR Manager / Payroll Officer can see these columns but can never approve or disburse.
router.post('/runs/:id/payment-approval', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { payslipIds, approve = true } = z.object({ payslipIds: z.array(z.string()).optional(), approve: z.boolean().optional() }).parse(req.body || {});
    const run = await loadRun(req, req.params.id);
    if (!['APPROVED', 'PAID'].includes(run.status)) {
      throw httpError(400, 'Payroll must be fully approved before individual payments can be approved.');
    }
    const where = {
      payrollRunId: run.id,
      paymentStatus: { in: ['NOT_PAID', 'FAILED'] }, // never touch anything already paid / in flight
      ...(payslipIds?.length ? { id: { in: payslipIds } } : {}),
    };
    const result = await prisma.payslip.updateMany({
      where,
      data: approve
        ? { paymentApproval: 'APPROVED', paymentApprovedById: req.user.id, paymentApprovedAt: new Date() }
        : { paymentApproval: 'PENDING', paymentApprovedById: null, paymentApprovedAt: null },
    });
    const total = await prisma.payslip.aggregate({ where: { ...where, paymentApproval: approve ? 'APPROVED' : 'PENDING' }, _sum: { totalPayable: true } });
    await logPayroll(req, {
      action: approve ? 'PAYROLL_PAYMENT_APPROVED' : 'PAYROLL_PAYMENT_APPROVAL_REMOVED',
      clientId: run.clientId || undefined,
      description: `${approve ? 'Approved' : 'Removed approval for'} ${result.count} payment(s) in run ${run.month}/${run.year}`,
      metadata: { runId: run.id, count: result.count, payslipIds: payslipIds || 'ALL' },
    });
    res.json({ updated: result.count, totalPayable: total._sum.totalPayable || 0 });
  } catch (err) { next(err); }
});

router.post('/runs/:id/disburse', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const run = await loadRun(req, req.params.id);
    if (!run.clientId) throw httpError(400, 'This is a legacy run with no client, so there is no client wallet to pay from.');
    if (!['APPROVED', 'PAID'].includes(run.status)) throw httpError(400, 'Payroll must be fully approved before disbursing.');

    const client = await prisma.client.findUnique({ where: { id: run.clientId }, select: { name: true } });
    const queue = await prisma.payslip.findMany({
      where: { payrollRunId: run.id, paymentApproval: 'APPROVED', paymentStatus: { in: ['NOT_PAID', 'FAILED'] } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (queue.length === 0) throw httpError(400, 'No approved, unpaid payments to disburse. Approve employees for payment first.');

    let succeeded = 0;
    let failed = 0;
    let paidTotal = 0;
    const failures = [];
    for (const item of queue) {
      const r = await disburseSalary({ payslipId: item.id, actor: req.user });
      if (r.ok) {
        succeeded += 1;
        paidTotal += r.amount;
        await notifyUsers([r.userId], { title: 'Salary credited', message: `Your salary for ${String(run.month).padStart(2, '0')}/${run.year} (${naira(r.amount)}) has been credited to your wallet.`, link: '/wallet' });
      } else if (!r.skipped) {
        failed += 1;
        failures.push(r.message);
      }
    }

    // Mark the run PAID once every payslip in it has been paid.
    const unpaid = await prisma.payslip.count({ where: { payrollRunId: run.id, paymentStatus: { not: 'SUCCESS' } } });
    if (unpaid === 0) await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'PAID' } });

    await logPayroll(req, {
      action: 'PAYROLL_DISBURSED',
      clientId: run.clientId,
      description: `Disbursed ${naira(paidTotal)} to ${succeeded} employee wallet(s) for ${client?.name} (${run.month}/${run.year})${failed ? ` — ${failed} failed` : ''}`,
      metadata: { runId: run.id, succeeded, failed, total: Math.round(paidTotal * 100) / 100, failures: [...new Set(failures)] },
    });
    if (succeeded > 0) {
      await notifyClientAdmins(run.clientId, { title: 'Salaries disbursed', message: `Salaries for ${client?.name} (${String(run.month).padStart(2, '0')}/${run.year}) were paid to ${succeeded} employee wallet(s).`, link: '/payroll' });
    }

    res.json({ succeeded, failed, total: Math.round(paidTotal * 100) / 100, failures: [...new Set(failures)], runStatus: unpaid === 0 ? 'PAID' : run.status });
  } catch (err) { next(err); }
});

// ---------- Money activity trail (Super Admin) ----------
// Every payroll, wallet and client-access action is written to the audit log; this is the
// Super Admin's window onto it, filterable by module, client, action, text and date.
router.get('/activity', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { module = 'ALL', clientId, action, q, from, to } = req.query;
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize) || 50));

    const moduleFilters = {
      PAYROLL: [{ module: 'PAYROLL' }, { action: { startsWith: 'PAYROLL_' } }],
      WALLET: [{ module: 'WALLET' }, { action: { startsWith: 'WALLET_' } }],
      ACCESS: [{ module: 'ACCESS' }, { action: { startsWith: 'ACCESS_' } }],
    };
    const moduleOr = module === 'ALL' ? Object.values(moduleFilters).flat() : moduleFilters[module] || Object.values(moduleFilters).flat();

    const where = {
      AND: [
        { OR: moduleOr },
        ...(clientId ? [{ clientId }] : []),
        ...(action ? [{ action }] : []),
        ...(q ? [{ description: { contains: String(q), mode: 'insensitive' } }] : []),
        ...(from || to ? [{ createdAt: { ...(from ? { gte: new Date(from) } : {}), ...(to ? { lte: new Date(`${to}T23:59:59.999Z`) } : {}) } }] : []),
      ],
    };

    const [total, logs] = await Promise.all([
      prisma.activityLog.count({ where }),
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          employee: { select: { firstName: true, lastName: true, employeeCode: true } },
          actor: { select: { email: true, role: true } },
        },
      }),
    ]);

    const clientIds = [...new Set(logs.map((l) => l.clientId).filter(Boolean))];
    const clients = clientIds.length ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } }) : [];
    const clientName = new Map(clients.map((c) => [c.id, c.name]));

    res.json({
      total,
      page,
      pageSize,
      logs: logs.map((l) => ({ ...l, clientName: l.clientId ? clientName.get(l.clientId) || null : null })),
    });
  } catch (err) { next(err); }
});

export default router;

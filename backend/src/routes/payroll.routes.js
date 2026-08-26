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
import { logActivity } from '../utils/activityLog.js';

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
    res.json({ structure });
  } catch (err) { next(err); }
});

router.get('/salary-structure/:employeeId', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const structure = await prisma.salaryStructure.findUnique({ where: { employeeId: req.params.employeeId } });
    res.json({ structure });
  } catch (err) { next(err); }
});

// ---------- Payroll Settings ----------
router.get('/settings', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const settings = await prisma.payrollSettings.findMany({ orderBy: { effectiveFrom: 'desc' } });
    res.json({ settings });
  } catch (err) { next(err); }
});

const settingsSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['PAYE', 'PENSION_EMPLOYEE', 'PENSION_EMPLOYER', 'NHF', 'CUSTOM']),
  config: z.record(z.any()),
  effectiveFrom: z.string(),
  effectiveTo: z.string().optional(),
});

router.post('/settings', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const data = settingsSchema.parse(req.body);
    const setting = await prisma.payrollSettings.create({
      data: { ...data, effectiveFrom: new Date(data.effectiveFrom), effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null },
    });
    res.status(201).json({ setting });
  } catch (err) { next(err); }
});

router.patch('/settings/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'), async (req, res, next) => {
  try {
    const setting = await prisma.payrollSettings.update({ where: { id: req.params.id }, data: req.body });
    res.json({ setting });
  } catch (err) { next(err); }
});

// ---------- Loans & Advances ----------
router.post('/loans', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const data = z.object({ employeeId: z.string(), principal: z.number(), monthlyDeduction: z.number(), reason: z.string().optional() }).parse(req.body);
    const loan = await prisma.loan.create({ data: { ...data, balanceRemaining: data.principal } });
    res.status(201).json({ loan });
  } catch (err) { next(err); }
});

router.post('/advances', async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
    const data = z.object({ amount: z.number(), reason: z.string().optional() }).parse(req.body);
    const advance = await prisma.salaryAdvance.create({ data: { employeeId: employee.id, ...data } });
    res.status(201).json({ advance });
  } catch (err) { next(err); }
});

router.post('/advances/:id/decision', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const { approve } = z.object({ approve: z.boolean() }).parse(req.body);
    const advance = await prisma.salaryAdvance.update({ where: { id: req.params.id }, data: { status: approve ? 'APPROVED' : 'REJECTED' } });
    res.json({ advance });
  } catch (err) { next(err); }
});

// ---------- Payroll Runs ----------
router.post('/runs', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const { month, year } = z.object({ month: z.number().min(1).max(12), year: z.number() }).parse(req.body);
    const run = await prisma.payrollRun.upsert({
      where: { month_year: { month, year } },
      update: {},
      create: { month, year },
    });
    res.status(201).json({ run });
  } catch (err) { next(err); }
});

router.get('/runs', requireRole(...VIEW_ROLES), async (req, res, next) => {
  try {
    const runs = await prisma.payrollRun.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    res.json({ runs });
  } catch (err) { next(err); }
});

router.post('/runs/:id/process', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    if (!['DRAFT', 'REVIEW', 'REJECTED'].includes(run.status)) {
      return res.status(400).json({ message: 'This run has already been submitted for approval and can no longer be reprocessed. Reject it back to Review first if changes are needed.' });
    }

    const employees = await prisma.employee.findMany({
      where: { employmentStatus: 'ACTIVE', salaryStructure: { isNot: null } },
      include: { salaryStructure: true },
    });

    const asOfDate = new Date(run.year, run.month - 1, 1);
    const results = [];

    for (const emp of employees) {
      const computed = await computePayslip({ salaryStructure: emp.salaryStructure, asOfDate });
      const payslip = await prisma.payslip.upsert({
        where: { payrollRunId_employeeId: { payrollRunId: run.id, employeeId: emp.id } },
        update: computed,
        create: { payrollRunId: run.id, employeeId: emp.id, ...computed },
      });
      results.push(payslip);
    }

    await prisma.payrollRun.update({ where: { id: run.id }, data: { status: 'REVIEW' } });
    res.json({ payslips: results });
  } catch (err) { next(err); }
});

router.post('/runs/:id/submit-for-approval', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
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
    res.json({ run: updated });
  } catch (err) { next(err); }
});

router.post('/runs/:id/hr-manager-approve', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
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
    await logActivity({ actorUserId: req.user.id, action: 'PAYROLL_HR_MANAGER_APPROVED', description: `Payroll run ${run.month}/${run.year} approved by HR Manager, sent to Super Admin` });
    res.json({ run: updated });
  } catch (err) { next(err); }
});

router.post('/runs/:id/final-approve', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
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

    await logActivity({ actorUserId: req.user.id, action: 'PAYROLL_FINAL_APPROVED', description: `Payroll run ${run.month}/${run.year} given final approval by Super Admin — ${generated.length} payslip(s) generated` });

    res.json({ run: { ...run, status: 'APPROVED' }, payslipsGenerated: generated.length });
  } catch (err) { next(err); }
});

router.post('/runs/:id/reject', requireRole('HR_MANAGER', 'SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().min(1) }).parse(req.body);
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });
    if (!['PENDING_HR_MANAGER', 'PENDING_SUPER_ADMIN'].includes(run.status)) {
      return res.status(400).json({ message: 'This run is not in a state that can be rejected.' });
    }
    const updated = await prisma.payrollRun.update({
      where: { id: run.id },
      data: { status: 'REVIEW', rejectionReason: reason },
    });
    await logActivity({ actorUserId: req.user.id, action: 'PAYROLL_REJECTED', description: `Payroll run ${run.month}/${run.year} sent back to Review: ${reason}` });
    res.json({ run: updated });
  } catch (err) { next(err); }
});

router.get('/runs/:id/payslips', requireRole(...VIEW_ROLES), async (req, res, next) => {
  try {
    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: req.params.id },
      include: { employee: { select: { firstName: true, lastName: true, employeeCode: true } } },
    });
    res.json({ payslips });
  } catch (err) { next(err); }
});

router.get('/payslips/me', async (req, res, next) => {
  try {
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
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
    res.json({ payslip: updated });
  } catch (err) { next(err); }
});

router.get('/runs/:id/export', requireRole(...VIEW_ROLES), async (req, res, next) => {
  try {
    const payslips = await prisma.payslip.findMany({
      where: { payrollRunId: req.params.id },
      include: { employee: true },
    });

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
      });
    });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=payroll-${req.params.id}.xlsx`);
    await workbook.xlsx.write(res);
    res.end();
  } catch (err) { next(err); }
});

export default router;

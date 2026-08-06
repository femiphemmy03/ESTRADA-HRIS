import { Router } from 'express';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import ExcelJS from 'exceljs';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
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
const PAYROLL_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'];

// ---------- Salary Structure ----------
const salarySchema = z.object({
  employeeId: z.string(),
  basicSalary: z.number(),
  allowances: z.array(z.object({ name: z.string(), amount: z.number() })).default([]),
  deductions: z.array(z.object({ name: z.string(), amount: z.number() })).default([]),
});

router.put('/salary-structure', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const data = salarySchema.parse(req.body);
    const structure = await prisma.salaryStructure.upsert({
      where: { employeeId: data.employeeId },
      update: { basicSalary: data.basicSalary, allowances: data.allowances, deductions: data.deductions, effectiveFrom: new Date() },
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

// ---------- Payroll Settings (configurable statutory rules) ----------
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

router.post('/settings', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const data = settingsSchema.parse(req.body);
    const setting = await prisma.payrollSettings.create({
      data: { ...data, effectiveFrom: new Date(data.effectiveFrom), effectiveTo: data.effectiveTo ? new Date(data.effectiveTo) : null },
    });
    res.status(201).json({ setting });
  } catch (err) { next(err); }
});

router.patch('/settings/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
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

router.get('/runs', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const runs = await prisma.payrollRun.findMany({ orderBy: [{ year: 'desc' }, { month: 'desc' }] });
    res.json({ runs });
  } catch (err) { next(err); }
});

// Process/compute payslips for every active employee with a salary structure
router.post('/runs/:id/process', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.findUnique({ where: { id: req.params.id } });
    if (!run) return res.status(404).json({ message: 'Payroll run not found' });

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

router.post('/runs/:id/approve', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const run = await prisma.payrollRun.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', approvedById: req.user.employee?.id, approvedAt: new Date() },
    });
    res.json({ run });
  } catch (err) { next(err); }
});

router.get('/runs/:id/payslips', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
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
    const payslips = await prisma.payslip.findMany({ where: { employeeId: employee.id }, include: { payrollRun: true }, orderBy: { createdAt: 'desc' } });
    res.json({ payslips });
  } catch (err) { next(err); }
});

// Generate a PDF payslip, push to Supabase, store URL
router.post('/payslips/:id/generate-pdf', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
  try {
    const payslip = await prisma.payslip.findUnique({
      where: { id: req.params.id },
      include: { employee: { include: { user: true } }, payrollRun: true },
    });
    if (!payslip) return res.status(404).json({ message: 'Payslip not found' });

    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([595, 842]);
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const pageWidth = 595;
    const margin = 50;

    // Logo — top right corner, for document authenticity.
    let headerBottomY = 800;
    try {
      const logoBytes = fs.readFileSync(LOGO_PATH);
      const logoImage = await pdfDoc.embedPng(logoBytes);
      const maxLogoWidth = 110;
      const scale = maxLogoWidth / logoImage.width;
      const logoWidth = logoImage.width * scale;
      const logoHeight = logoImage.height * scale;
      const logoX = pageWidth - margin - logoWidth;
      const logoY = 842 - 40 - logoHeight;
      page.drawImage(logoImage, { x: logoX, y: logoY, width: logoWidth, height: logoHeight });
      headerBottomY = logoY - 10;
    } catch (logoErr) {
      // If the logo asset is ever missing, don't fail payslip generation over it —
      // just fall back to a text-only header.
      console.error('[payslip] Could not embed logo:', logoErr.message);
    }

    let y = Math.min(800, headerBottomY);
    const draw = (text, size = 11, f = font, color = rgb(0, 0, 0)) => {
      page.drawText(text, { x: margin, y, size, font: f, color });
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

    await logActivity({ employeeId: payslip.employeeId, actorUserId: req.user.id, action: 'PAYROLL_PROCESSED', description: `Payslip generated for ${payslip.payrollRun.month}/${payslip.payrollRun.year}` });

    res.json({ payslip: updated });
  } catch (err) { next(err); }
});

// Excel export of a payroll run
router.get('/runs/:id/export', requireRole(...PAYROLL_ROLES), async (req, res, next) => {
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

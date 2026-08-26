import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { uploadToSupabase, removeFromSupabase } from '../lib/supabase.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);
const ADMIN_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'];

// ---------- Document Types (employee-owned, e.g. CV, Passport) ----------
router.get('/types', async (req, res, next) => {
  try {
    const types = await prisma.documentType.findMany();
    res.json({ types });
  } catch (err) { next(err); }
});

router.post('/types', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const data = z
      .object({
        name: z.string().min(1),
        owner: z.enum(['COMPANY', 'EMPLOYEE']),
        requiresAck: z.boolean().default(false),
        expiryTrackingEnabled: z.boolean().default(false),
      })
      .parse(req.body);
    const type = await prisma.documentType.create({ data });
    res.status(201).json({ type });
  } catch (err) { next(err); }
});

// ---------- Employee document upload (CV, ID, Passport, etc.) ----------
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { documentTypeId, employeeId, expiryDate } = req.body;
    if (!req.file) return res.status(400).json({ message: 'file is required' });

    const docType = await prisma.documentType.findUnique({ where: { id: documentTypeId } });
    if (!docType) return res.status(404).json({ message: 'Document type not found' });

    const isSelf = employeeId ? (await prisma.employee.findUnique({ where: { id: employeeId } }))?.userId === req.user.id : false;
    const isPrivileged = ADMIN_ROLES.includes(req.user.role);
    if (docType.owner === 'EMPLOYEE' && !isSelf && !isPrivileged) {
      return res.status(403).json({ message: 'Not permitted to upload for this employee' });
    }

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destinationPath = employeeId
      ? `employees/${employeeId}/${Date.now()}_${safeName}`
      : `company/${Date.now()}_${safeName}`;

    const { url, path } = await uploadToSupabase(req.file.buffer, destinationPath, req.file.mimetype);

    const document = await prisma.document.create({
      data: {
        documentTypeId,
        employeeId: employeeId || null,
        fileUrl: url,
        fileName: req.file.originalname,
        storagePath: path,
        ackStatus: docType.requiresAck ? 'PENDING' : 'NOT_REQUIRED',
        expiryDate: expiryDate ? new Date(expiryDate) : null,
      },
    });

    if (employeeId) {
      await logActivity({ employeeId, actorUserId: req.user.id, action: 'DOCUMENT_UPLOADED', description: `${docType.name} uploaded` });
    }

    res.status(201).json({ document });
  } catch (err) { next(err); }
});

router.get('/', async (req, res, next) => {
  try {
    const { employeeId } = req.query;
    const documents = await prisma.document.findMany({
      where: employeeId ? { employeeId } : { employeeId: null },
      include: { documentType: true },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ documents });
  } catch (err) { next(err); }
});

router.post('/:id/acknowledge', async (req, res, next) => {
  try {
    const document = await prisma.document.update({
      where: { id: req.params.id },
      data: { ackStatus: 'ACKNOWLEDGED', acknowledgedAt: new Date() },
    });
    if (document.employeeId) {
      await logActivity({ employeeId: document.employeeId, actorUserId: req.user.id, action: 'DOCUMENT_ACKNOWLEDGED', description: 'Employee acknowledged a company document/policy' });
    }
    res.json({ document });
  } catch (err) { next(err); }
});

// ---------- Company documents — free-form title + department scoping, no preset types ----------
router.get('/company', async (req, res, next) => {
  try {
    const isPrivileged = ADMIN_ROLES.includes(req.user.role);
    const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });

    const documents = await prisma.document.findMany({
      where: {
        employeeId: null,
        documentTypeId: null,
        ...(isPrivileged ? {} : { OR: [{ departmentId: null }, { departmentId: employee?.departmentId || undefined }] }),
      },
      include: { department: true },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ documents });
  } catch (err) { next(err); }
});

router.post('/company-upload', requireRole(...ADMIN_ROLES), upload.single('file'), async (req, res, next) => {
  try {
    const { title, departmentId } = req.body;
    if (!req.file) return res.status(400).json({ message: 'file is required' });
    if (!title) return res.status(400).json({ message: 'title is required' });

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destinationPath = `company/${Date.now()}_${safeName}`;
    const { url, path } = await uploadToSupabase(req.file.buffer, destinationPath, req.file.mimetype);

    const document = await prisma.document.create({
      data: {
        title,
        departmentId: departmentId || null,
        fileUrl: url,
        fileName: req.file.originalname,
        storagePath: path,
        ackStatus: 'NOT_REQUIRED',
      },
    });

    res.status(201).json({ document });
  } catch (err) { next(err); }
});

router.delete('/company/:id', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: 'Not found' });
    await removeFromSupabase(document.storagePath);
    await prisma.document.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------- Employee document matrix — HR/Admin overview of every employee's uploads ----------
router.get('/employee-matrix', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const employees = await prisma.employee.findMany({
      where: { archived: false },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        employeeCode: true,
        department: { select: { name: true } },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    const documentTypes = await prisma.documentType.findMany({
      where: { owner: 'EMPLOYEE' },
      orderBy: { name: 'asc' },
    });

    const documents = await prisma.document.findMany({
      where: { employeeId: { not: null }, documentTypeId: { not: null } },
      select: { employeeId: true, documentTypeId: true, fileUrl: true, fileName: true, uploadedAt: true },
      orderBy: { uploadedAt: 'desc' },
    });

    const matrix = {};
    for (const d of documents) {
      if (!matrix[d.employeeId]) matrix[d.employeeId] = {};
      if (!matrix[d.employeeId][d.documentTypeId]) matrix[d.employeeId][d.documentTypeId] = d;
    }

    res.json({ employees, documentTypes, matrix });
  } catch (err) { next(err); }
});

router.delete('/:id', requireRole(...ADMIN_ROLES), async (req, res, next) => {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: 'Not found' });
    await removeFromSupabase(document.storagePath);
    await prisma.document.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;

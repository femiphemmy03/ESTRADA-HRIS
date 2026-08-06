import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { uploadToSupabase, removeFromSupabase } from '../lib/supabase.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);

// ---------- Document Types (still used for EMPLOYEE-owned personal documents) ----------
router.get('/types', async (req, res, next) => {
  try {
    const types = await prisma.documentType.findMany();
    res.json({ types });
  } catch (err) { next(err); }
});

router.post('/types', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
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

// ---------- Upload (EMPLOYEE-owned personal documents — CV, ID, certificates, etc.) ----------
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { documentTypeId, employeeId, expiryDate } = req.body;
    if (!req.file) return res.status(400).json({ message: 'file is required' });
    if (!documentTypeId) return res.status(400).json({ message: 'documentTypeId is required for personal document uploads' });

    const docType = await prisma.documentType.findUnique({ where: { id: documentTypeId } });
    if (!docType) return res.status(404).json({ message: 'Document type not found' });

    const isSelf = employeeId ? (await prisma.employee.findUnique({ where: { id: employeeId } }))?.userId === req.user.id : false;
    const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role);
    if (!isSelf && !isPrivileged) {
      return res.status(403).json({ message: 'Not permitted to upload for this employee' });
    }

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destinationPath = `employees/${employeeId}/${Date.now()}_${safeName}`;

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
      where: { employeeId: employeeId || null },
      include: { documentType: true },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ documents });
  } catch (err) { next(err); }
});

// ---------- Company documents — free-form title + department scoping, no preset types ----------
// HR/Admin uploads with a plain title and picks a department (or leaves it for "all departments").
// Employees only ever see docs that are either department-wide-none (visible to everyone) or match
// their own department. HR/Admin see everything, across all departments, for management purposes.
router.post('/company-upload', requireRole('SUPER_ADMIN', 'HR_ADMIN'), upload.single('file'), async (req, res, next) => {
  try {
    const { title, departmentId } = req.body;
    if (!req.file) return res.status(400).json({ message: 'file is required' });
    if (!title || !title.trim()) return res.status(400).json({ message: 'title is required' });

    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const destinationPath = `company/${Date.now()}_${safeName}`;
    const { url, path } = await uploadToSupabase(req.file.buffer, destinationPath, req.file.mimetype);

    const document = await prisma.document.create({
      data: {
        title: title.trim(),
        departmentId: departmentId || null,
        employeeId: null,
        documentTypeId: null,
        fileUrl: url,
        fileName: req.file.originalname,
        storagePath: path,
        ackStatus: 'NOT_REQUIRED',
      },
    });

    res.status(201).json({ document });
  } catch (err) { next(err); }
});

router.get('/company', async (req, res, next) => {
  try {
    const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role);
    let where = { employeeId: null, documentTypeId: null };

    if (!isPrivileged) {
      const employee = await prisma.employee.findUnique({ where: { userId: req.user.id } });
      where = {
        ...where,
        OR: [{ departmentId: null }, { departmentId: employee?.departmentId || '__none__' }],
      };
    }

    const documents = await prisma.document.findMany({
      where,
      include: { department: true },
      orderBy: { uploadedAt: 'desc' },
    });
    res.json({ documents });
  } catch (err) { next(err); }
});

router.delete('/company/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: 'Not found' });
    await removeFromSupabase(document.storagePath);
    await prisma.document.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

// ---------- Acknowledgement / deletion (shared by both document families) ----------
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

router.delete('/:id', requireRole('SUPER_ADMIN', 'HR_ADMIN'), async (req, res, next) => {
  try {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document) return res.status(404).json({ message: 'Not found' });
    await removeFromSupabase(document.storagePath);
    await prisma.document.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (err) { next(err); }
});

export default router;

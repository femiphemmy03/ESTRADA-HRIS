import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { upload } from '../middleware/upload.js';
import { uploadToSupabase, removeFromSupabase } from '../lib/supabase.js';
import { logActivity } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);

// ---------- Document Types ----------
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

// ---------- Upload ----------
router.post('/upload', upload.single('file'), async (req, res, next) => {
  try {
    const { documentTypeId, employeeId, expiryDate } = req.body;
    if (!req.file) return res.status(400).json({ message: 'file is required' });

    const docType = await prisma.documentType.findUnique({ where: { id: documentTypeId } });
    if (!docType) return res.status(404).json({ message: 'Document type not found' });

    const isSelf = employeeId ? (await prisma.employee.findUnique({ where: { id: employeeId } }))?.userId === req.user.id : false;
    const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(req.user.role);
    if (docType.owner === 'EMPLOYEE' && !isSelf && !isPrivileged) {
      return res.status(403).json({ message: 'Not permitted to upload for this employee' });
    }
    if (docType.owner === 'COMPANY' && !isPrivileged) {
      return res.status(403).json({ message: 'Only HR can upload company-wide documents' });
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

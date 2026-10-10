import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { getScope, inScope } from '../utils/clientScope.js';
import { httpError } from '../utils/httpError.js';
import {
  ensurePersonalWallet,
  ensureClientWallet,
  createFundingRequest,
  confirmFunding,
  rejectFunding,
  directFund,
  serializeTxn,
  toNum,
  round2,
} from '../utils/wallet.js';
import { notifyUsers, notifyClientAdmins, notifySuperAdmins } from '../utils/notify.js';
import { logWallet } from '../utils/activityLog.js';

const router = Router();
router.use(requireAuth);

// HR Admin / HR Manager can FUND a client wallet (for clients they're assigned to). They can never
// disburse. Disbursement is Super Admin only and lives in the payroll module.
const FUND_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'];
const naira = (n) => `₦${Number(n).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function fundingInstructions() {
  const configured = !!(env.fundingBankName && env.fundingAccountNumber);
  return {
    configured,
    bankName: env.fundingBankName,
    accountName: env.fundingAccountName,
    accountNumber: env.fundingAccountNumber,
    note: env.fundingNote,
  };
}

// ---------- My wallet (everyone) ----------
router.get('/me', async (req, res, next) => {
  try {
    const wallet = await ensurePersonalWallet(req.user);
    const transactions = await prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    res.json({
      wallet: {
        id: wallet.id,
        walletCode: wallet.walletCode,
        status: wallet.status,
        currency: wallet.currency,
        balance: toNum(wallet.balance),
        employeeCode: req.user.employee?.employeeCode || null,
      },
      transactions: transactions.map(serializeTxn),
      // Loans are shown but not active: each client sets its own loan policy (later batch).
      loans: { enabled: false },
    });
  } catch (err) { next(err); }
});

// ---------- Client wallets ----------
router.get('/funding-instructions', requireRole(...FUND_ROLES), (req, res) => {
  res.json({ instructions: fundingInstructions() });
});

router.get('/clients', requireRole(...FUND_ROLES), async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const isSuper = req.user.role === 'SUPER_ADMIN';
    const clients = await prisma.client.findMany({
      where: { isActive: true, ...(scope.all ? {} : { id: { in: scope.clientIds } }) },
      orderBy: { name: 'asc' },
      include: {
        wallet: true,
        assignments: { include: { user: { select: { id: true, email: true, role: true, employee: { select: { firstName: true, lastName: true } } } } } },
      },
    });
    const pending = await prisma.walletTransaction.groupBy({
      by: ['clientId'],
      where: { type: 'FUNDING', status: 'PENDING', ...(scope.all ? {} : { clientId: { in: scope.clientIds } }) },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const pendingMap = new Map(pending.map((p) => [p.clientId, p]));

    const rows = clients.map((c) => {
      const p = pendingMap.get(c.id);
      const base = {
        clientId: c.id,
        name: c.name,
        pendingCount: p?._count._all || 0,
        pendingAmount: toNum(p?._sum.amount),
        canFund: isSuper || !!scope.assignments.find((a) => a.clientId === c.id)?.canFund,
      };
      // Only the Super Admin sees balances and who is assigned. Admins just see what they need to fund.
      return isSuper
        ? { ...base, walletCode: c.wallet?.walletCode || null, balance: toNum(c.wallet?.balance), admins: c.assignments.map((a) => ({ userId: a.user.id, email: a.user.email, role: a.user.role, name: a.user.employee ? `${a.user.employee.firstName} ${a.user.employee.lastName}` : a.user.email, canFund: a.canFund })) }
        : base;
    });
    res.json({ clients: rows });
  } catch (err) { next(err); }
});

const fundSchema = z.object({
  amount: z.number().positive().max(1_000_000_000_000),
  note: z.string().max(300).optional(),
  paymentReference: z.string().max(120).optional(),
});

// Admin / HR: "I have paid into the Estrada account for this client" -> pending request.
router.post('/clients/:clientId/fund-requests', requireRole(...FUND_ROLES), async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const data = fundSchema.parse(req.body);
    const scope = await getScope(req.user);
    if (!inScope(scope, clientId)) throw httpError(403, 'You are not assigned to this client.');
    if (!scope.all && !scope.assignments.find((a) => a.clientId === clientId)?.canFund) {
      throw httpError(403, 'Funding has been disabled for you on this client. Contact the Super Admin.');
    }
    const client = await prisma.client.findUnique({ where: { id: clientId }, select: { name: true } });
    if (!client) throw httpError(404, 'Client not found.');

    const txn = await createFundingRequest({
      clientId,
      amount: data.amount,
      initiatedById: req.user.id,
      note: data.note,
      paymentReference: data.paymentReference,
    });

    await logWallet(req, { action: 'WALLET_FUNDING_REQUESTED', clientId, description: `Funding of ${naira(data.amount)} submitted for ${client.name} (ref ${txn.reference})`, metadata: { reference: txn.reference, amount: data.amount } });
    await notifySuperAdmins({ title: 'Funding awaiting confirmation', message: `${req.user.email} reported a ${naira(data.amount)} payment for ${client.name} (ref ${txn.reference}).`, link: '/wallet' });

    res.status(201).json({ transaction: serializeTxn(txn), instructions: fundingInstructions() });
  } catch (err) { next(err); }
});

router.get('/funding-requests', requireRole(...FUND_ROLES), async (req, res, next) => {
  try {
    const scope = await getScope(req.user);
    const { status, clientId } = req.query;
    const rows = await prisma.walletTransaction.findMany({
      where: {
        type: 'FUNDING',
        ...(status ? { status } : {}),
        ...(clientId ? { clientId } : {}),
        ...(scope.all ? {} : { clientId: { in: scope.clientIds } }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { wallet: { include: { client: { select: { id: true, name: true } } } } },
    });
    const userIds = [...new Set(rows.map((r) => r.initiatedById).filter(Boolean))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } });
    const emailById = new Map(users.map((u) => [u.id, u.email]));

    const isSuper = req.user.role === 'SUPER_ADMIN';
    res.json({
      requests: rows.map((r) => ({
        id: r.id,
        reference: r.reference,
        amount: toNum(r.amount),
        status: r.status,
        description: r.description,
        createdAt: r.createdAt,
        confirmedAt: r.confirmedAt,
        client: r.wallet?.client || null,
        requestedBy: emailById.get(r.initiatedById) || null,
        paymentReference: r.metadata?.paymentReference || null,
        // Balances after the transaction are Super Admin eyes only.
        ...(isSuper ? { balanceAfter: r.balanceAfter == null ? null : toNum(r.balanceAfter) } : {}),
      })),
    });
  } catch (err) { next(err); }
});

router.post('/funding-requests/:id/confirm', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { txn } = await confirmFunding({ txnId: req.params.id, actorId: req.user.id });
    const client = await prisma.client.findUnique({ where: { id: txn.clientId }, select: { name: true } });
    await logWallet(req, { action: 'WALLET_FUNDING_CONFIRMED', clientId: txn.clientId, description: `Funding ${txn.reference} of ${naira(txn.amount)} confirmed for ${client?.name}`, metadata: { reference: txn.reference, amount: toNum(txn.amount) } });
    const payload = { title: 'Payment received', message: `Your payment of ${naira(txn.amount)} for ${client?.name} (ref ${txn.reference}) has been received and the client wallet funded.`, link: '/wallet' };
    await notifyUsers([txn.initiatedById], payload);
    await notifyClientAdmins(txn.clientId, payload, { excludeUserId: txn.initiatedById });
    res.json({ transaction: serializeTxn(txn) });
  } catch (err) { next(err); }
});

router.post('/funding-requests/:id/reject', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const { reason } = z.object({ reason: z.string().max(300).optional() }).parse(req.body || {});
    const txn = await rejectFunding({ txnId: req.params.id, actorId: req.user.id, reason });
    const client = await prisma.client.findUnique({ where: { id: txn.clientId }, select: { name: true } });
    await logWallet(req, { action: 'WALLET_FUNDING_REJECTED', clientId: txn.clientId, description: `Funding ${txn.reference} for ${client?.name} rejected${reason ? `: ${reason}` : ''}`, metadata: { reference: txn.reference } });
    await notifyUsers([txn.initiatedById], { title: 'Payment not confirmed', message: `Funding ${txn.reference} for ${client?.name} could not be confirmed${reason ? `: ${reason}` : '.'}`, link: '/wallet' });
    res.json({ transaction: serializeTxn(txn) });
  } catch (err) { next(err); }
});

// Super Admin tops up a client wallet directly.
router.post('/clients/:clientId/fund', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const data = fundSchema.parse(req.body);
    const client = await prisma.client.findUnique({ where: { id: req.params.clientId }, select: { id: true, name: true } });
    if (!client) throw httpError(404, 'Client not found.');
    const { txn, wallet } = await directFund({ clientId: client.id, amount: data.amount, actorId: req.user.id, note: data.note });
    await logWallet(req, { action: 'WALLET_FUNDED_DIRECT', clientId: client.id, description: `Super Admin funded ${client.name} wallet with ${naira(data.amount)} (ref ${txn.reference})`, metadata: { reference: txn.reference, amount: round2(data.amount) } });
    await notifyClientAdmins(client.id, { title: 'Client wallet funded', message: `${client.name}'s wallet was funded with ${naira(data.amount)} (ref ${txn.reference}).`, link: '/wallet' });
    res.status(201).json({ transaction: serializeTxn(txn), balance: toNum(wallet.balance) });
  } catch (err) { next(err); }
});

// Full ledger for one client wallet — Super Admin only.
router.get('/clients/:clientId/transactions', requireRole('SUPER_ADMIN'), async (req, res, next) => {
  try {
    const wallet = await ensureClientWallet(req.params.clientId);
    const transactions = await prisma.walletTransaction.findMany({ where: { walletId: wallet.id }, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json({ wallet: { walletCode: wallet.walletCode, balance: toNum(wallet.balance) }, transactions: transactions.map(serializeTxn) });
  } catch (err) { next(err); }
});

// ---------- Notifications ----------
router.get('/notifications', async (req, res, next) => {
  try {
    const [notifications, unreadCount] = await Promise.all([
      prisma.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 30 }),
      prisma.notification.count({ where: { userId: req.user.id, isRead: false } }),
    ]);
    res.json({ notifications, unreadCount });
  } catch (err) { next(err); }
});

router.post('/notifications/read', async (req, res, next) => {
  try {
    const { ids } = z.object({ ids: z.array(z.string()).optional() }).parse(req.body || {});
    await prisma.notification.updateMany({
      where: { userId: req.user.id, isRead: false, ...(ids?.length ? { id: { in: ids } } : {}) },
      data: { isRead: true },
    });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;

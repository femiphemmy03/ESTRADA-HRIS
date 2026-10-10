import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { httpError } from './httpError.js';

/**
 * WALLET SERVICE
 * --------------
 * Every balance change goes through here so the rules live in one place:
 *   - Wallet IDs (walletCode) are random and independent of employeeCode.
 *   - A client wallet can only be DEBITED by a Super Admin (disbursement).
 *   - Funding is a two-step flow: a PENDING request, then a confirmation that credits the wallet.
 *     (A Flutterwave webhook will call confirmFunding() in the payments batch.)
 *   - Balance changes happen inside a DB transaction together with their ledger row.
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
export const toNum = (d) => (d == null ? 0 : Number(d));

function randomCode(prefix) {
  return `${prefix}${String(crypto.randomInt(0, 10_000_000_000)).padStart(10, '0')}`;
}

export function newReference(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

async function createWallet(data) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await prisma.wallet.create({ data: { ...data, walletCode: randomCode('WLT') } });
    } catch (err) {
      const target = String(err.meta?.target ?? '');
      if (err.code === 'P2002' && target.includes('walletCode')) continue; // code collision — retry
      throw err;
    }
  }
  throw httpError(500, 'Could not allocate a unique wallet ID. Please try again.');
}

/** Returns the person's wallet, creating it on first use. Works for users with or without an employee record. */
export async function ensurePersonalWallet(user) {
  const employeeId = user.employee?.id ?? null;
  const find = async () =>
    (await prisma.wallet.findUnique({ where: { userId: user.id } })) ||
    (employeeId ? await prisma.wallet.findUnique({ where: { employeeId } }) : null);

  let wallet = await find();
  if (wallet) {
    if (employeeId && !wallet.employeeId) {
      wallet = await prisma.wallet.update({ where: { id: wallet.id }, data: { employeeId } }).catch(() => wallet);
    }
    return wallet;
  }
  try {
    return await createWallet({ kind: 'PERSONAL', userId: user.id, employeeId });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await find();
      if (again) return again;
    }
    throw err;
  }
}

export async function ensureClientWallet(clientId) {
  const existing = await prisma.wallet.findUnique({ where: { clientId } });
  if (existing) return existing;
  try {
    return await createWallet({ kind: 'CLIENT', clientId });
  } catch (err) {
    if (err.code === 'P2002') {
      const again = await prisma.wallet.findUnique({ where: { clientId } });
      if (again) return again;
    }
    throw err;
  }
}

/** Step 1 of funding: record that money is expected. Does NOT change the balance. */
export async function createFundingRequest({ clientId, amount, initiatedById, note, paymentReference }) {
  const wallet = await ensureClientWallet(clientId);
  return prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      clientId,
      type: 'FUNDING',
      direction: 'CREDIT',
      amount: round2(amount),
      status: 'PENDING',
      reference: newReference('FND'),
      description: note || 'Client wallet funding',
      initiatedById,
      provider: 'MANUAL',
      metadata: paymentReference ? { paymentReference } : undefined,
    },
  });
}

/** Step 2 of funding: money confirmed received — credit the client wallet. Safe against double-confirmation. */
export async function confirmFunding({ txnId, actorId = null, providerRef }) {
  return prisma.$transaction(async (tx) => {
    const txn = await tx.walletTransaction.findUnique({ where: { id: txnId } });
    if (!txn || txn.type !== 'FUNDING') throw httpError(404, 'Funding request not found.');

    const claimed = await tx.walletTransaction.updateMany({
      where: { id: txnId, status: 'PENDING' },
      data: { status: 'SUCCESS', confirmedById: actorId, confirmedAt: new Date(), ...(providerRef ? { providerRef } : {}) },
    });
    if (claimed.count === 0) throw httpError(409, 'This funding request has already been processed.');

    const wallet = await tx.wallet.update({ where: { id: txn.walletId }, data: { balance: { increment: txn.amount } } });
    const updated = await tx.walletTransaction.update({ where: { id: txnId }, data: { balanceAfter: wallet.balance } });
    return { txn: updated, wallet };
  });
}

export async function rejectFunding({ txnId, actorId = null, reason }) {
  const result = await prisma.walletTransaction.updateMany({
    where: { id: txnId, type: 'FUNDING', status: 'PENDING' },
    data: { status: 'REJECTED', confirmedById: actorId, confirmedAt: new Date(), description: reason ? `Rejected: ${reason}` : undefined },
  });
  if (result.count === 0) throw httpError(409, 'This funding request is not pending (already processed or not found).');
  return prisma.walletTransaction.findUnique({ where: { id: txnId } });
}

/** Super Admin tops up a client wallet directly — recorded and credited immediately. */
export async function directFund({ clientId, amount, actorId, note }) {
  const wallet = await ensureClientWallet(clientId);
  return prisma.$transaction(async (tx) => {
    const updated = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: round2(amount) } } });
    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        clientId,
        type: 'FUNDING',
        direction: 'CREDIT',
        amount: round2(amount),
        balanceAfter: updated.balance,
        status: 'SUCCESS',
        reference: newReference('FND'),
        description: note || 'Funded directly by Super Admin',
        initiatedById: actorId,
        confirmedById: actorId,
        confirmedAt: new Date(),
        provider: 'MANUAL',
      },
    });
    return { txn, wallet: updated };
  });
}

/**
 * Takes money OUT of a client wallet (salary disbursement). Only a Super Admin may do this —
 * HR/Admin roles can fund a client wallet but never spend from it. The payroll disbursement
 * endpoint (next batch) is built on this function.
 */
export async function debitClientWallet({ clientId, amount, actor, type = 'DISBURSEMENT', description, metadata }) {
  if (!actor || actor.role !== 'SUPER_ADMIN') {
    throw httpError(403, 'Only a Super Admin can disburse money from a client wallet.');
  }
  const wallet = await ensureClientWallet(clientId);
  const value = round2(amount);
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.wallet.updateMany({
      where: { id: wallet.id, status: 'ACTIVE', balance: { gte: value } },
      data: { balance: { decrement: value } },
    });
    if (claimed.count === 0) throw httpError(400, 'Insufficient balance in the client wallet (or the wallet is not active).');
    const updated = await tx.wallet.findUnique({ where: { id: wallet.id } });
    const txn = await tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        clientId,
        type,
        direction: 'DEBIT',
        amount: value,
        balanceAfter: updated.balance,
        status: 'SUCCESS',
        reference: newReference('DSB'),
        description,
        initiatedById: actor.id,
        confirmedById: actor.id,
        confirmedAt: new Date(),
        provider: 'MANUAL',
        metadata,
      },
    });
    return { txn, wallet: updated };
  });
}

/**
 * SALARY DISBURSEMENT (one payslip)
 * ---------------------------------
 * Moves the payslip's totalPayable from the CLIENT wallet into the EMPLOYEE's wallet, atomically:
 * client wallet debit + employee wallet credit + both ledger rows + payslip marked paid all happen
 * in one DB transaction, so money can never leave one wallet without arriving in the other.
 * Only a Super Admin may do this, and only for payslips already approved for payment.
 * Returns { ok: true, payslip } or { ok: false, message } — a failure is recorded on the payslip
 * (paymentStatus FAILED + paymentMessage) so it shows in the payroll table and can be retried.
 */
export async function disburseSalary({ payslipId, actor }) {
  if (!actor || actor.role !== 'SUPER_ADMIN') {
    throw httpError(403, 'Only a Super Admin can disburse salaries.');
  }

  // Claim it first so two clicks (or two admins) can never pay the same payslip twice.
  const claimed = await prisma.payslip.updateMany({
    where: { id: payslipId, paymentApproval: 'APPROVED', paymentStatus: { in: ['NOT_PAID', 'FAILED'] } },
    data: { paymentStatus: 'PROCESSING', paymentMessage: null },
  });
  if (claimed.count === 0) return { ok: false, skipped: true, message: 'Not approved for payment, or already paid / being processed.' };

  const fail = async (message) => {
    await prisma.payslip.update({ where: { id: payslipId }, data: { paymentStatus: 'FAILED', paymentMessage: message } });
    return { ok: false, message };
  };

  try {
    const payslip = await prisma.payslip.findUnique({
      where: { id: payslipId },
      include: { payrollRun: true, employee: { include: { user: true } } },
    });
    const clientId = payslip.payrollRun.clientId;
    if (!clientId) return await fail('This payroll run is not tied to a client, so there is no client wallet to pay from.');
    const amount = round2(payslip.totalPayable);
    if (!(amount > 0)) return await fail('Nothing payable for this employee.');

    const clientWallet = await ensureClientWallet(clientId);
    const empWallet = await ensurePersonalWallet({ ...payslip.employee.user, employee: payslip.employee });
    if (empWallet.status !== 'ACTIVE') return await fail('The employee wallet is not active.');

    const period = `${String(payslip.payrollRun.month).padStart(2, '0')}/${payslip.payrollRun.year}`;
    const reference = newReference('SAL');

    await prisma.$transaction(async (tx) => {
      const debited = await tx.wallet.updateMany({
        where: { id: clientWallet.id, status: 'ACTIVE', balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (debited.count === 0) throw httpError(400, 'Insufficient balance in the client wallet. Ask the client admin to fund it, then retry.');
      const clientAfter = await tx.wallet.findUnique({ where: { id: clientWallet.id } });
      const empAfter = await tx.wallet.update({ where: { id: empWallet.id }, data: { balance: { increment: amount } } });

      await tx.walletTransaction.create({
        data: {
          walletId: clientWallet.id, clientId, type: 'DISBURSEMENT', direction: 'DEBIT', amount,
          balanceAfter: clientAfter.balance, status: 'SUCCESS', reference: `${reference}-D`,
          description: `Salary ${period} — ${payslip.employee.firstName} ${payslip.employee.lastName} (${payslip.employee.employeeCode})`,
          initiatedById: actor.id, confirmedById: actor.id, confirmedAt: new Date(), provider: 'MANUAL',
          metadata: { payslipId, payrollRunId: payslip.payrollRunId, employeeId: payslip.employeeId },
        },
      });
      await tx.walletTransaction.create({
        data: {
          walletId: empWallet.id, clientId, type: 'SALARY_CREDIT', direction: 'CREDIT', amount,
          balanceAfter: empAfter.balance, status: 'SUCCESS', reference,
          description: `Salary for ${period}`,
          initiatedById: actor.id, confirmedById: actor.id, confirmedAt: new Date(), provider: 'MANUAL',
          metadata: { payslipId, payrollRunId: payslip.payrollRunId },
        },
      });
      await tx.payslip.update({
        where: { id: payslipId },
        data: { paymentStatus: 'SUCCESS', paymentReference: reference, paidAt: new Date(), paymentMessage: 'Credited to employee wallet' },
      });
    });

    return { ok: true, reference, amount, userId: payslip.employee.userId };
  } catch (err) {
    return await fail(err.status ? err.message : 'Unexpected error while paying this employee. Please retry.');
  }
}

/** Decimal -> number for JSON responses. */
export function serializeTxn(t) {
  return { ...t, amount: toNum(t.amount), balanceAfter: t.balanceAfter == null ? null : toNum(t.balanceAfter) };
}

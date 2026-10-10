import { prisma } from '../lib/prisma.js';

/**
 * Records an entry in the employee timeline / audit trail.
 * Called by every module whenever a meaningful action happens on an employee.
 * `module` ('PAYROLL' | 'WALLET' | 'ACCESS' | ...) and `clientId` are optional and let the
 * Super Admin filter the trail.
 */
export async function logActivity({ employeeId, actorUserId, action, description, metadata, module, clientId }) {
  return prisma.activityLog.create({
    data: { employeeId, actorUserId, action, description, metadata, module, clientId },
  });
}

/**
 * Audit logging for money-related modules. Never throws — a logging hiccup must not
 * roll back or block a payroll/wallet action that has already succeeded.
 */
export async function logModule(module, req, { action, description, metadata, clientId, employeeId }) {
  try {
    await logActivity({
      employeeId,
      actorUserId: req.user?.id,
      action,
      description,
      metadata,
      module,
      clientId,
    });
  } catch (err) {
    console.error(`[audit:${module}] failed to write log "${action}":`, err.message);
  }
}

export const logPayroll = (req, entry) => logModule('PAYROLL', req, entry);
export const logWallet = (req, entry) => logModule('WALLET', req, entry);
export const logAccess = (req, entry) => logModule('ACCESS', req, entry);

import { prisma } from '../lib/prisma.js';
import { httpError } from './httpError.js';

/**
 * CLIENT SCOPING
 * --------------
 * Super Admin sees every client. HR Admin / HR Manager / Payroll Officer only see the clients
 * the Super Admin has assigned to them (ClientAssignment). Team Leads and Employees are limited
 * to the client on their own employee record.
 *
 * Employees who have not been placed under any client yet (clientId = null) form an
 * "unassigned pool" that HR roles can still see, so new invitees are never invisible to the
 * person who has to finish setting them up.
 */
export const SCOPED_ADMIN_ROLES = ['HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'];

export async function getScope(user) {
  if (user.role === 'SUPER_ADMIN') {
    return { all: true, clientIds: [], assignments: [] };
  }
  if (SCOPED_ADMIN_ROLES.includes(user.role)) {
    const assignments = await prisma.clientAssignment.findMany({
      where: { userId: user.id },
      select: { clientId: true, canFund: true },
    });
    return { all: false, clientIds: assignments.map((a) => a.clientId), assignments };
  }
  const own = user.employee?.clientId;
  return { all: false, clientIds: own ? [own] : [], assignments: [] };
}

export function inScope(scope, clientId) {
  if (scope.all) return true;
  return !!clientId && scope.clientIds.includes(clientId);
}

/** Prisma `where` fragment limiting a model to the caller's clients. */
export function clientWhere(scope, field = 'clientId', { includeUnassigned = false } = {}) {
  if (scope.all) return {};
  const inList = { [field]: { in: scope.clientIds } };
  return includeUnassigned ? { OR: [inList, { [field]: null }] } : inList;
}

export async function assertClientAccess(user, clientId) {
  const scope = await getScope(user);
  if (!inScope(scope, clientId)) {
    throw httpError(403, 'You do not have access to this client.');
  }
  return scope;
}

/**
 * Can this user see/act on this employee record?
 *  - Super Admin: always
 *  - the employee themselves: always
 *  - Team Lead: only their direct reports
 *  - HR roles: employees under an assigned client, or not yet placed under any client
 */
export async function canAccessEmployee(user, target, scope) {
  if (user.role === 'SUPER_ADMIN') return true;
  if (target.userId === user.id) return true;
  if (user.role === 'TEAM_LEAD') return !!user.employee?.id && target.teamLeadId === user.employee.id;
  if (SCOPED_ADMIN_ROLES.includes(user.role)) {
    const s = scope || (await getScope(user));
    return target.clientId == null || inScope(s, target.clientId);
  }
  return false;
}

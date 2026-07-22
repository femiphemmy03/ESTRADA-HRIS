import { prisma } from '../lib/prisma.js';

/**
 * Records an entry in the employee timeline / audit trail.
 * Called by every module whenever a meaningful action happens on an employee.
 */
export async function logActivity({ employeeId, actorUserId, action, description, metadata }) {
  return prisma.activityLog.create({
    data: { employeeId, actorUserId, action, description, metadata },
  });
}

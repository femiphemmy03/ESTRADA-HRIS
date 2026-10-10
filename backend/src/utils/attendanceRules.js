import { prisma } from '../lib/prisma.js';

/**
 * Which attendance rule applies to an employee?
 *   1. the rule set on their site
 *   2. else the rule set on their client (every client can have its own rules)
 *   3. else the company-wide default
 */
export async function getRuleForEmployee(employee) {
  if (employee.siteId) {
    const siteRule = await prisma.attendanceRule.findUnique({ where: { siteId: employee.siteId } });
    if (siteRule) return siteRule;
  }
  if (employee.clientId) {
    const clientRule = await prisma.attendanceRule.findUnique({ where: { clientId: employee.clientId } });
    if (clientRule) return clientRule;
  }
  return prisma.attendanceRule.findFirst({ where: { isDefault: true } });
}

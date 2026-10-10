import { prisma } from '../lib/prisma.js';

/** In-app notifications. Failures here must never break the action that triggered them. */
export async function notifyUsers(userIds, { title, message, link }) {
  try {
    const ids = [...new Set((userIds || []).filter(Boolean))];
    if (!ids.length) return;
    await prisma.notification.createMany({
      data: ids.map((userId) => ({ userId, title, message, link: link || null })),
    });
  } catch (err) {
    console.error('[notify] failed:', err.message);
  }
}

export async function notifyClientAdmins(clientId, payload, { onlyFunders = false, excludeUserId } = {}) {
  try {
    const rows = await prisma.clientAssignment.findMany({
      where: { clientId, ...(onlyFunders ? { canFund: true } : {}), user: { isActive: true } },
      select: { userId: true },
    });
    await notifyUsers(rows.map((r) => r.userId).filter((id) => id !== excludeUserId), payload);
  } catch (err) {
    console.error('[notify] client admins failed:', err.message);
  }
}

export async function notifySuperAdmins(payload) {
  try {
    const rows = await prisma.user.findMany({ where: { role: 'SUPER_ADMIN', isActive: true }, select: { id: true } });
    await notifyUsers(rows.map((r) => r.id), payload);
  } catch (err) {
    console.error('[notify] super admins failed:', err.message);
  }
}

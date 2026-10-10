// One-off: gives every existing user and every active client a wallet.
// Run once after deploying the wallets migration:  npm run backfill:wallets
// Safe to re-run — it only creates what is missing.
import { PrismaClient } from '@prisma/client';
import crypto from 'crypto';

const prisma = new PrismaClient();
const code = () => `WLT${String(crypto.randomInt(0, 10_000_000_000)).padStart(10, '0')}`;

async function create(data) {
  for (let i = 0; i < 5; i += 1) {
    try {
      return await prisma.wallet.create({ data: { ...data, walletCode: code() } });
    } catch (err) {
      if (err.code === 'P2002' && String(err.meta?.target ?? '').includes('walletCode')) continue;
      throw err;
    }
  }
  throw new Error('Could not allocate a unique wallet code');
}

async function main() {
  const users = await prisma.user.findMany({ include: { employee: { select: { id: true } } } });
  let personal = 0;
  for (const u of users) {
    const exists = await prisma.wallet.findFirst({
      where: { OR: [{ userId: u.id }, ...(u.employee ? [{ employeeId: u.employee.id }] : [])] },
    });
    if (!exists) {
      await create({ kind: 'PERSONAL', userId: u.id, employeeId: u.employee?.id ?? null });
      personal += 1;
    }
  }

  const clients = await prisma.client.findMany({ select: { id: true } });
  let clientWallets = 0;
  for (const c of clients) {
    const exists = await prisma.wallet.findUnique({ where: { clientId: c.id } });
    if (!exists) {
      await create({ kind: 'CLIENT', clientId: c.id });
      clientWallets += 1;
    }
  }
  console.log(`Wallets created — personal: ${personal}, client: ${clientWallets}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

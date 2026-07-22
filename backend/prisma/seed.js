import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding ESTRADA HRIS...');

  // --- Super Admin ---
  const seedPassword = 'password123'; // change this, then re-run `npm run seed` to sync it
  const passwordHash = await bcrypt.hash(seedPassword, 10);
  await prisma.user.upsert({
    where: { email: 'admin@estradaintl.com' },
    update: { passwordHash },
    create: {
      email: 'admin@estradaintl.com',
      passwordHash,
      role: 'SUPER_ADMIN',
      mustSetPassword: false,
    },
  });
  console.log(`Super Admin ready -> admin@estradaintl.com / ${seedPassword}  (CHANGE THIS IMMEDIATELY once logged in)`);

  // --- Default attendance rule ---
  const existingDefaultRule = await prisma.attendanceRule.findFirst({ where: { isDefault: true } });
  if (!existingDefaultRule) {
    await prisma.attendanceRule.create({
      data: {
        isDefault: true,
        name: 'Default Attendance Policy',
        workingDays: 'MON,TUE,WED,THU,FRI',
        shiftStart: '08:00',
        shiftEnd: '17:00',
        gracePeriodMinutes: 15,
        minimumHours: 8,
        halfDayHours: 4,
        overtimeThresholdHours: 9,
        gpsRadiusMeters: 150,
        weekendPolicy: 'NOT_WORKING',
        holidayPolicy: 'NOT_WORKING',
      },
    });
    console.log('Created default attendance rule');
  }

  // --- Leave types ---
  const leaveTypes = [
    { name: 'Annual Leave', defaultDaysPerYear: 20, isPaid: true },
    { name: 'Sick Leave', defaultDaysPerYear: 10, isPaid: true },
    { name: 'Compassionate Leave', defaultDaysPerYear: 5, isPaid: true },
    { name: 'Maternity Leave', defaultDaysPerYear: 90, isPaid: true },
    { name: 'Unpaid Leave', defaultDaysPerYear: 0, isPaid: false },
  ];
  for (const lt of leaveTypes) {
    await prisma.leaveType.upsert({ where: { name: lt.name }, update: {}, create: lt });
  }
  console.log('Seeded leave types');

  // --- Payroll settings (example configurable statutory rules — adjust in Payroll Settings UI) ---
  const payeExists = await prisma.payrollSettings.findFirst({ where: { type: 'PAYE', isActive: true } });
  if (!payeExists) {
    await prisma.payrollSettings.create({
      data: {
        name: 'PAYE (example bands)',
        type: 'PAYE',
        effectiveFrom: new Date('2026-01-01'),
        config: {
          consolidatedReliefFlat: 200000,
          consolidatedReliefPercent: 0.01,
          brackets: [
            { upTo: 300000, rate: 0.07 },
            { upTo: 600000, rate: 0.11 },
            { upTo: 1100000, rate: 0.15 },
            { upTo: 1600000, rate: 0.19 },
            { upTo: 3200000, rate: 0.21 },
          ],
          topRate: 0.24,
        },
      },
    });
  }
  const pensionExists = await prisma.payrollSettings.findFirst({ where: { type: 'PENSION_EMPLOYEE', isActive: true } });
  if (!pensionExists) {
    await prisma.payrollSettings.create({
      data: {
        name: 'Pension — Employee 8%',
        type: 'PENSION_EMPLOYEE',
        effectiveFrom: new Date('2026-01-01'),
        config: { percent: 0.08 },
      },
    });
  }
  console.log('Seeded example payroll settings (edit these in Admin > Payroll Settings)');

  // --- Document types ---
  const docTypes = [
    { name: 'Employee Handbook', owner: 'COMPANY', requiresAck: true },
    { name: 'Company Policy', owner: 'COMPANY', requiresAck: true },
    { name: 'HSE Policy', owner: 'COMPANY', requiresAck: true },
    { name: 'Code of Conduct', owner: 'COMPANY', requiresAck: true },
    { name: 'Passport Photograph', owner: 'EMPLOYEE' },
    { name: 'CV', owner: 'EMPLOYEE' },
    { name: 'Certificates', owner: 'EMPLOYEE' },
    { name: 'Means of ID', owner: 'EMPLOYEE' },
    { name: 'Pension Document', owner: 'EMPLOYEE', expiryTrackingEnabled: true },
    { name: 'HMO Document', owner: 'EMPLOYEE', expiryTrackingEnabled: true },
    { name: 'Guarantor Form', owner: 'EMPLOYEE' },
  ];
  for (const dt of docTypes) {
    await prisma.documentType.upsert({ where: { name: dt.name }, update: {}, create: dt });
  }
  console.log('Seeded document types');

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

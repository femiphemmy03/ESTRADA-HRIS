-- CreateEnum
CREATE TYPE "PaymentApproval" AS ENUM ('PENDING', 'APPROVED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('NOT_PAID', 'PROCESSING', 'SUCCESS', 'FAILED');

-- DropIndex
DROP INDEX "PayrollRun_month_year_key";

-- AlterTable
ALTER TABLE "AttendanceRule" ADD COLUMN     "clientId" TEXT,
ADD COLUMN     "prorateSalary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "requiredDaysPerMonth" INTEGER;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "clientId" TEXT;

-- AlterTable
ALTER TABLE "Payslip" ADD COLUMN     "daysPresent" DOUBLE PRECISION,
ADD COLUMN     "paidAt" TIMESTAMP(3),
ADD COLUMN     "paymentApproval" "PaymentApproval" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "paymentApprovedAt" TIMESTAMP(3),
ADD COLUMN     "paymentApprovedById" TEXT,
ADD COLUMN     "paymentMessage" TEXT,
ADD COLUMN     "paymentReference" TEXT,
ADD COLUMN     "paymentStatus" "PaymentStatus" NOT NULL DEFAULT 'NOT_PAID',
ADD COLUMN     "prorationFactor" DOUBLE PRECISION,
ADD COLUMN     "requiredDays" INTEGER,
ADD COLUMN     "totalPayable" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Existing payslips: what is payable today is simply their net pay.
UPDATE "Payslip" SET "totalPayable" = "netPay";

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRule_clientId_key" ON "AttendanceRule"("clientId");

-- CreateIndex
CREATE INDEX "PayrollRun_clientId_idx" ON "PayrollRun"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_month_year_clientId_key" ON "PayrollRun"("month", "year", "clientId");

-- CreateIndex
CREATE INDEX "Payslip_paymentStatus_idx" ON "Payslip"("paymentStatus");

-- AddForeignKey
ALTER TABLE "AttendanceRule" ADD CONSTRAINT "AttendanceRule_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRun" ADD CONSTRAINT "PayrollRun_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

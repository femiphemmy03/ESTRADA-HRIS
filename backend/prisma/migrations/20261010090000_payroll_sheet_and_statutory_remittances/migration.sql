-- CreateEnum
CREATE TYPE "RemittanceType" AS ENUM ('PAYE', 'PENSION');

-- CreateEnum
CREATE TYPE "RemittanceLineStatus" AS ENUM ('MATCHED_OK', 'MATCHED_NO_ID', 'ID_MISMATCH', 'ID_INVALID', 'UNMATCHED');

-- AlterTable
ALTER TABLE "Employee" ADD COLUMN     "payeNumber" TEXT;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "sourceFileName" TEXT,
ADD COLUMN     "uploadedAt" TIMESTAMP(3),
ADD COLUMN     "uploadedById" TEXT;

-- CreateTable
CREATE TABLE "PayrollSheetRates" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "rates" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollSheetRates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryRemittance" (
    "id" TEXT NOT NULL,
    "type" "RemittanceType" NOT NULL,
    "clientId" TEXT NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "fileName" TEXT,
    "uploadedById" TEXT,
    "totalAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatutoryRemittance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatutoryRemittanceLine" (
    "id" TEXT NOT NULL,
    "remittanceId" TEXT NOT NULL,
    "employeeId" TEXT,
    "employeeCode" TEXT,
    "name" TEXT NOT NULL,
    "idInFile" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" "RemittanceLineStatus" NOT NULL,
    "hasValidId" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatutoryRemittanceLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PayrollSheetRates_clientId_key" ON "PayrollSheetRates"("clientId");

-- CreateIndex
CREATE INDEX "StatutoryRemittance_clientId_year_month_idx" ON "StatutoryRemittance"("clientId", "year", "month");

-- CreateIndex
CREATE INDEX "StatutoryRemittanceLine_remittanceId_idx" ON "StatutoryRemittanceLine"("remittanceId");

-- AddForeignKey
ALTER TABLE "PayrollSheetRates" ADD CONSTRAINT "PayrollSheetRates_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatutoryRemittance" ADD CONSTRAINT "StatutoryRemittance_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatutoryRemittanceLine" ADD CONSTRAINT "StatutoryRemittanceLine_remittanceId_fkey" FOREIGN KEY ("remittanceId") REFERENCES "StatutoryRemittance"("id") ON DELETE CASCADE ON UPDATE CASCADE;

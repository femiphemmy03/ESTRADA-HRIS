/*
  Warnings:

  - You are about to drop the column `reviewedById` on the `PayrollRun` table. All the data in the column will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayrollRunStatus" ADD VALUE 'PENDING_HR_MANAGER';
ALTER TYPE "PayrollRunStatus" ADD VALUE 'PENDING_SUPER_ADMIN';
ALTER TYPE "PayrollRunStatus" ADD VALUE 'REJECTED';

-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'HR_MANAGER';

-- AlterTable
ALTER TABLE "PayrollRun" DROP COLUMN "reviewedById",
ADD COLUMN     "hrManagerApprovedAt" TIMESTAMP(3),
ADD COLUMN     "hrManagerApprovedById" TEXT,
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "submittedAt" TIMESTAMP(3),
ADD COLUMN     "submittedById" TEXT;

-- AlterTable
ALTER TABLE "SalaryStructure" ADD COLUMN     "nhfEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "payeEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "pensionEnabled" BOOLEAN NOT NULL DEFAULT false;

-- DropForeignKey
ALTER TABLE "Document" DROP CONSTRAINT "Document_documentTypeId_fkey";

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN     "workMode" TEXT NOT NULL DEFAULT 'ONSITE';

-- AlterTable
ALTER TABLE "AttendanceRule" ADD COLUMN     "remoteDays" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "departmentId" TEXT,
ADD COLUMN     "title" TEXT,
ALTER COLUMN "documentTypeId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_documentTypeId_fkey" FOREIGN KEY ("documentTypeId") REFERENCES "DocumentType"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "Department"("id") ON DELETE SET NULL ON UPDATE CASCADE;

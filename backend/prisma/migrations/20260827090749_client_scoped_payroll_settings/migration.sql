-- AlterTable
ALTER TABLE "PayrollSettings" ADD COLUMN     "clientId" TEXT;

-- AddForeignKey
ALTER TABLE "PayrollSettings" ADD CONSTRAINT "PayrollSettings_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

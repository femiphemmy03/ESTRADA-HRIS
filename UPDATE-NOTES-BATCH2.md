# ESTRADA HRIS — Update Batch 2: Client-wise payroll, payment approval & disbursement, per-client attendance rules + proration

## 0. Order matters
Batch 2 builds on Batch 1. Extract/xcopy Batch 1 FIRST, then this one (this batch overwrites 3 Batch 1 files
with newer versions: schema.prisma, wallet.js, payroll.routes.js — that is intended).

## 1. Apply (Windows)
    xcopy ESTRADA-HRIS-UPDATES-B2\backend  estrada-hris\backend  /E /Y /I
    xcopy ESTRADA-HRIS-UPDATES-B2\frontend estrada-hris\frontend /E /Y /I

## 2. Database (once, after BOTH batches are copied)
    cd backend
    npx prisma migrate deploy     # applies the Batch 1 and Batch 2 migrations in order
    npx prisma generate
    npm run backfill:wallets      # only needed if you haven't run it yet

## 3. How it now works
* Payroll runs are per CLIENT per month (pick the client when you create/open a run). Old runs show as "Legacy" and are Super Admin only.
* Run flow is unchanged: Process -> Submit -> HR Manager approve -> Super Admin final approve.
* After final approval the Super Admin sees checkboxes + two new columns on the summary table:
  Payment Approval and Payment Status, plus Total Payable and Days (present/required).
  Approve selected / Approve all unpaid -> Disburse approved.
* Disburse moves each approved employee's Total Payable from the CLIENT wallet into the EMPLOYEE wallet
  (atomic; a failed one shows FAILED with the reason and can be retried). Only the Super Admin can approve or disburse.
  HR Admin / HR Manager / Payroll Officer can see the columns but have no buttons.
* Attendance rules can now belong to a client (Administration -> Attendance Rules -> Applies to).
  Lookup: site rule -> client rule -> company default. HR roles can only manage rules of their assigned clients.
* Fixed present days: set "Required present days per month" (e.g. 20) and tick "Prorate salary".
  Pay = earnings x (days present / required days), capped at 100%, applied BEFORE PAYE/pension/NHF.
  Present/Late/Overtime/Early departure/Missing checkout = 1 day, Half day = 0.5, paid leave and public holidays = 1,
  absent/weekend = 0. Fixed "other deductions" (e.g. loans) are not prorated.

## 4. Not in this batch yet
Real bank transfers / withdrawals via Flutterwave (the "Withdraw" button is still disabled). Disbursement here credits
wallets inside the HRIS; the Flutterwave payout + webhook comes once your keys and fixed IP are ready.

# ESTRADA HRIS — Update Batch 3: Payroll sheet upload, run reports, PAYE & Pension tabs, History

## 0. Order
Apply Batch 1, then Batch 2, then this one. Overwrites (newer versions): schema.prisma, app.js, payrollEngine.js,
employees.routes.js, Payroll.jsx. No new npm packages are needed (uses the exceljs already installed).

## 1. Apply (Windows)
    xcopy ESTRADA-HRIS-UPDATES-B3\backend  estrada-hris\backend  /E /Y /I
    xcopy ESTRADA-HRIS-UPDATES-B3\frontend estrada-hris\frontend /E /Y /I

## 2. Database
    cd backend
    npx prisma migrate deploy
    npx prisma generate

## 3. What you get (Payroll page)
Runs tab, per run:
* "Template / Upload sheet": pick which columns you want, download an Excel (with Rates sheet) or CSV template pre-filled
  with the client's active employees, salary structure, required days and attendance days. Fill it, upload it, review the
  check (errors / warnings / missing employees), then Import. Rows are matched by Employee Code.
* The system recalculates everything: payable gross, EE pension, PAYE (from your statutory settings, or the value you type),
  net, employer pension, ITF, NSITF, group life, total emolument, management fees, VAT and amount payable to service provider.
* Rates (component split %, pensions, ITF, NSITF, management fee, VAT) are saved per client from the Rates sheet.
* "Report": key highlights for the run (totals, month-on-month, employer costs / invoice, attendance, payment progress)
  with Excel/CSV export in the full payroll-sheet column layout.
New tabs: PAYE, Pension (upload the schedule you paid; see paid with valid number / without / not matched / not paid;
fix missing PAYE numbers and RSA PINs inline; outstanding by month; exports) and History & Reports
(month-on-month and since-inception totals, chart, projection, Payroll/PAYE/Pension exports).

## 4. Rules and assumptions to check
* Blank EE pension or PAYE cells = system calculates them for that employee. Type 0 to exclude someone.
* Default rates: Basic 30, Housing 20, Transport 10, Feeding 20, 13th Month 3, Utility 13, Leave 4 (%); EE pension 8% and
  employer pension 10% of Basic+Housing+Transport; ITF 1%; NSITF 1%; management fee 12% of total emolument; VAT 7.5% of the fee.
* PAYE numbers / RSA PINs: "valid" is a format check only (RSA = PEN + 12 digits; PAYE = 5-25 letters/digits).
* Expected pension = employee + employer (employer part is known only for runs created from an uploaded sheet).
* Only runs from Review onward count as "expected" in History.

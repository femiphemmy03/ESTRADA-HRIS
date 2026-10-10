# ESTRADA HRIS — Update Batch 1: Client scoping, Wallets, Funding, Payroll audit trail, Role-based dashboard

## 1. Apply the update (Windows)
From the folder that contains BOTH `estrada-hris` and this `ESTRADA-HRIS-UPDATES` folder:

    xcopy ESTRADA-HRIS-UPDATES\backend  estrada-hris\backend  /E /Y /I
    xcopy ESTRADA-HRIS-UPDATES\frontend estrada-hris\frontend /E /Y /I

(`backend\.env.example` is overwritten — your real `backend\.env` is NOT touched.)

## 2. Add these lines to backend\.env (use your real Estrada account details)
    FUNDING_BANK_NAME="Your Bank"
    FUNDING_ACCOUNT_NAME="Estrada International Limited"
    FUNDING_ACCOUNT_NUMBER="0000000000"
    FUNDING_NOTE="Use the reference shown after you submit as your transfer narration."

Flutterwave / QuotaGuard variables are listed (commented) in `.env.example` for the next batch.

## 3. Database
    cd backend
    npx prisma migrate deploy      # applies 20261008090000_wallets_and_client_scoping
    npx prisma generate
    npm run backfill:wallets       # gives every existing user + client a wallet (safe to re-run)

## 4. After deploying — IMPORTANT
HR Admin / HR Manager / Payroll Officer accounts now only see clients assigned to them.
Log in as Super Admin -> **Client Access** -> assign each admin to their clients,
otherwise they will see no client data.

## 5. Security
The old `.env.example` contained real keys (database password, Supabase service key, Resend key,
JWT secrets). Treat them as exposed: rotate them, and never commit `.env`.

## What changed
Backend: schema (Wallet, WalletTransaction, ClientAssignment, Notification, ActivityLog.module/clientId),
new routes /api/wallet and /api/access, client scoping on employees, clients, payroll, dashboard and
audit logs, payroll activity trail (GET /api/payroll/activity), wallet is created at invite time.
Frontend: Wallet page, Client Access page, Payroll Activity page, role-based Dashboard,
Sidebar/App routes, "New Client" button limited to Super Admin.

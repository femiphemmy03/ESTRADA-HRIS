# ESTRADA HRIS

Employee Lifecycle Platform for outsourcing companies — built for **Estrada International**.

> One Employee. One Profile. One Source of Truth.

This is a full-stack MVP covering: Employee Management, Onboarding, Document Management, GPS-based Attendance (with a configurable rule engine), Client & Site Management, Payroll (with configurable statutory rules), Leave Management, Exit Management, and Administration/Audit Logs.

---

## 1. Stack

- **Frontend:** Vite + React, React Router, Tailwind CSS, Leaflet (OpenStreetMap) for GPS site pinning
- **Backend:** Node.js + Express, Prisma ORM, JWT auth, Zod validation
- **Database:** PostgreSQL (you provide the connection string)
- **File storage:** Supabase Storage
- **Transactional email:** Resend
- **PDF generation (payslips):** pdf-lib
- **Excel export (payroll):** exceljs

Nothing is hardcoded — every URL, secret, and key is read from `.env` files (see `.env.example` in each folder).

---

## 2. Folder structure

```
estrada-hris/
├── backend/     Express API (Prisma schema, routes, business logic)
└── frontend/    Vite + React app
```

---

## 3. Prerequisites

- Node.js 18+
- A PostgreSQL database (e.g. Supabase Postgres, Neon, Railway, or local Postgres)
- A Supabase project (for Storage — used for documents, photos, payslip PDFs)
- A Resend account + API key (for onboarding invite emails, leave/payslip notifications)

---

## 4. Backend setup

```bash
cd backend
npm install
cp .env.example .env
```

Edit `backend/.env` and fill in:

| Variable | What it's for |
|---|---|
| `DATABASE_URL` | Your PostgreSQL connection string |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Any long random strings |
| `FRONTEND_URL` | Where the frontend runs (used for CORS + email links) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | From your Resend dashboard |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | From your Supabase project settings → API |
| `SUPABASE_STORAGE_BUCKET` | Create a bucket with this name in Supabase Storage (Public bucket recommended for the MVP, or keep it private and switch document reads to signed URLs — the helper for that, `getSignedUrl`, is already in `src/lib/supabase.js`) |

Then run:

```bash
npx prisma generate
npx prisma migrate dev --name init
npm run seed        # creates a Super Admin, default attendance rule, leave types, example payroll settings, document types
npm run dev          # starts the API on http://localhost:4000
```

**Default Super Admin login (created by the seed script):**
`admin@estradaintl.com` / `ChangeMe123!` — **change this password immediately after first login.**

### Supabase Storage bucket

In your Supabase project: Storage → New bucket → name it to match `SUPABASE_STORAGE_BUCKET` in your `.env` (default `estrada-hris-documents`). Public bucket is the simplest path for the MVP since the backend already returns public URLs; if you'd rather keep it private, use the `getSignedUrl` helper already included in `src/lib/supabase.js` when serving document links.

---

## 5. Frontend setup

```bash
cd frontend
npm install
cp .env.example .env
```

Edit `frontend/.env`:

| Variable | What it's for |
|---|---|
| `VITE_API_URL` | Base URL of the backend API, e.g. `http://localhost:4000/api` |

Then:

```bash
npm run dev   # starts the frontend on http://localhost:5173
```

---

## 6. Payroll statutory rules (PAYE / Pension / NHF)

Nothing is hardcoded to Nigerian tax law directly in the code. The seed script inserts **example** PAYE bands and an 8% employee pension rule into `PayrollSettings`, purely as a starting point — review and correct these for your actual, current statutory requirements before running real payroll. Admins can add/edit rules from **Payroll → Statutory Settings** in the app, and every rule is effective-dated so historical payroll runs stay accurate even after rates change.

---

## 7. Roles

`SUPER_ADMIN`, `HR_ADMIN`, `PAYROLL_OFFICER`, `TEAM_LEAD`, `EMPLOYEE` — the permission model (in `backend/src/middleware/auth.js`) is written so new roles (Finance, Client HR, Auditor, IT Admin) can be added without restructuring.

---

## 8. What's included vs. what needs your attention before production

**Included and working end-to-end:**
- Auth (JWT + refresh), invite-based onboarding, password setup
- Employee master record + timeline/activity log
- Onboarding checklist + biodata + document upload/acknowledgement
- Client/Site management with Leaflet map GPS pinning + Team Lead proposal/HR approval
- Configurable attendance rule engine (per-site or default) + GPS check-in/out with radius validation, late/half-day/overtime status logic
- Leave request → manager approval → HR approval → auto-reflected in attendance + balances
- Configurable payroll engine (PAYE brackets, flat-percent Pension/NHF, effective-dated), salary structures, payroll runs, PDF payslip generation, Excel export
- Exit management: clearance checklist, interview notes, final settlement, archive
- Admin: departments/positions, attendance rules, users/roles, audit logs, dashboard stats

**Recommended before going live:**
- Replace the seed script's example PAYE/pension figures with your verified current statutory rules
- Add automated tests
- Add rate limiting/tuning, request logging aggregation, and error monitoring (e.g. Sentry)
- Review Supabase bucket privacy settings (public vs signed URLs) based on how sensitive your documents are
- Add a proper "forgot password" flow (only first-time invite-based password setup is included)
- Add pagination to list endpoints (employees, attendance, audit logs) once data volume grows

---

## 9. Troubleshooting

**`prepared statement "s0" already exists` / random 500s / getting logged out**
This happens when `DATABASE_URL` points at Supabase's pooled connection (port 6543, PgBouncer in "transaction mode"). PgBouncer's transaction pooling doesn't play well with Prisma's prepared statements under concurrent requests. For an MVP with light traffic, the simplest fix is to point `DATABASE_URL` at the **direct** connection (port 5432) instead — that's what this codebase ships with by default. When you're ready to scale to more concurrent users, switch back to the pooled URL with `?pgbouncer=true` appended, and set `directUrl` (already wired in `prisma/schema.prisma`) to the direct connection for migrations only.

**Attendance rules — which field does what**
- *Working days*: which days of the week attendance is expected at all
- *Shift start / end*: the official shift window
- *Grace period*: minutes after shift start before a check-in counts as "Late"
- *Minimum hours*: hours worked needed for a full "Present" day
- *Half-day threshold*: below this many hours worked, status becomes "Half Day"
- *Overtime threshold*: at/above this many hours, status becomes "Overtime"
- *GPS radius*: how far (in meters) from the site's pinned location an employee can be and still check in
- *Weekend / Holiday policy*: whether those days count as working, non-working, or overtime
- A rule can be tied to one specific site, or ticked as the **company-wide default** used for any employee whose site has no rule of its own.

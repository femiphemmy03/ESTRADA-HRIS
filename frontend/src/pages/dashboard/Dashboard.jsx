import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatCard from '../../components/shared/StatCard.jsx';

const STATS_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER', 'TEAM_LEAD'];
const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 })}`;

export default function Dashboard() {
  const { user, employee } = useAuth();
  const [stats, setStats] = useState(null);
  const [onboardingTasks, setOnboardingTasks] = useState(null);

  useEffect(() => {
    if (STATS_ROLES.includes(user?.role)) {
      api.get('/admin/dashboard-stats').then((r) => setStats(r.data)).catch(() => {});
    }
  }, [user]);

  useEffect(() => {
    if (employee && employee.onboardingStatus !== 'APPROVED') {
      api.get(`/onboarding/${employee.id}`).then((r) => setOnboardingTasks(r.data.tasks)).catch(() => {});
    }
  }, [employee]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white">
          Welcome{employee ? `, ${employee.firstName}` : ''} 👋
        </h1>
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">
          {stats?.scope === 'ALL' && "Here's what's happening across ESTRADA today."}
          {stats?.scope === 'CLIENTS' && "Here's how the clients assigned to you are doing today."}
          {stats?.scope === 'TEAM' && "Here's how your team is doing today."}
          {!stats && "Here's what's happening today."}
        </p>
      </div>

      {employee && employee.onboardingStatus !== 'APPROVED' && (
        <div className="card p-6 border-l-4 border-estrada-orange">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-slate-800 dark:text-white">Your onboarding isn't finished yet</h2>
            <Link to="/onboarding" className="btn-primary text-xs">Continue Onboarding</Link>
          </div>
          {onboardingTasks === null ? (
            <p className="text-sm text-slate-400">Loading checklist…</p>
          ) : onboardingTasks.length === 0 ? (
            <p className="text-sm text-slate-400">HR hasn't set up your checklist yet — check back soon or reach out to HR.</p>
          ) : (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {onboardingTasks.filter((t) => t.isComplete).length} of {onboardingTasks.length} checklist items complete.
            </p>
          )}
        </div>
      )}

      {stats?.scope === 'ALL' && <SuperAdminView stats={stats} />}
      {stats?.scope === 'CLIENTS' && <ClientScopedView stats={stats} />}
      {stats?.scope === 'TEAM' && <TeamView stats={stats} />}

      {employee && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-800 dark:text-white mb-2">Your Profile</h2>
          <div className="grid sm:grid-cols-2 gap-y-2 text-sm text-slate-600 dark:text-slate-300">
            <p><span className="text-slate-400">Employee Code:</span> {employee.employeeCode}</p>
            <p><span className="text-slate-400">Status:</span> {employee.employmentStatus}</p>
            <p><span className="text-slate-400">Department:</span> {employee.department?.name || '—'}</p>
            <p><span className="text-slate-400">Position:</span> {employee.position?.title || '—'}</p>
            <p><span className="text-slate-400">Client:</span> {employee.client?.name || '—'}</p>
            <p><span className="text-slate-400">Site:</span> {employee.site?.name || '—'}</p>
          </div>
        </div>
      )}
    </div>
  );
}

// Super Admin: everything, every card clickable.
function SuperAdminView({ stats }) {
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        <StatCard label="Total Employees" value={stats.totalEmployees} icon="👥" to="/employees" />
        <StatCard label="Active" value={stats.activeEmployees} icon="✅" to="/employees?status=ACTIVE" />
        <StatCard label="Onboarding" value={stats.onboardingCount} icon="📋" to="/onboarding" />
        <StatCard label="Present Today" value={stats.todayPresent} icon="📍" to="/attendance?status=PRESENT" />
        <StatCard label="Pending Leave" value={stats.pendingLeaves} icon="🌴" accent to="/leave" />
        <StatCard label="Active Clients" value={stats.clientsCount} icon="🏢" to="/clients" />
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <StatCard label="Client wallets total" value={naira(stats.money.clientWalletTotal)} icon="👛" to="/wallet" />
        <StatCard
          label="Funding awaiting confirmation"
          value={stats.money.pendingFundingCount}
          icon="💳"
          accent={stats.money.pendingFundingCount > 0}
          to="/wallet"
        />
        <StatCard
          label="Payroll awaiting your approval"
          value={stats.money.payrollAwaitingFinalApproval}
          icon="💰"
          accent={stats.money.payrollAwaitingFinalApproval > 0}
          to="/payroll"
        />
      </div>

      <PerClientTable rows={stats.perClient} title="By client" />
    </>
  );
}

// HR Admin / HR Manager / Payroll Officer: no company-wide totals and no client count — only their
// assigned clients, each with its own numbers.
function ClientScopedView({ stats }) {
  if (stats.perClient.length === 0) {
    return (
      <div className="card p-6 border-l-4 border-estrada-orange">
        <h2 className="font-semibold text-slate-800 dark:text-white">No clients assigned yet</h2>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          The Super Admin hasn't given you access to a client yet. Once they do, your client's numbers will appear here.
        </p>
      </div>
    );
  }
  return (
    <>
      <div className="grid sm:grid-cols-2 gap-4">
        <StatCard label="Funding payments awaiting confirmation" value={stats.pendingFundingCount} icon="💳" accent={stats.pendingFundingCount > 0} to="/wallet" />
        <StatCard label="Unread notifications" value={stats.unreadNotifications} icon="🔔" accent={stats.unreadNotifications > 0} to="/wallet" />
      </div>
      <div className="grid lg:grid-cols-2 gap-5">
        {stats.perClient.map((c) => (
          <div key={c.clientId} className="card p-5 space-y-4">
            <h2 className="font-semibold text-slate-800 dark:text-white">{c.name}</h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              <Mini label="Employees" value={c.totalEmployees} to="/employees" />
              <Mini label="Active" value={c.activeEmployees} to="/employees?status=ACTIVE" />
              <Mini label="Onboarding" value={c.onboardingCount} to="/onboarding" />
              <Mini label="Present today" value={c.todayPresent} to="/attendance" />
              <Mini label="Pending leave" value={c.pendingLeaves} to="/leave" accent={c.pendingLeaves > 0} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function TeamView({ stats }) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard label="My Team" value={stats.totalEmployees} icon="👥" to="/employees" />
      <StatCard label="Active" value={stats.activeEmployees} icon="✅" to="/employees?status=ACTIVE" />
      <StatCard label="Onboarding" value={stats.onboardingCount} icon="📋" to="/onboarding" />
      <StatCard label="Present Today" value={stats.todayPresent} icon="📍" to="/attendance?status=PRESENT" />
      <StatCard label="Pending Leave" value={stats.pendingLeaves} icon="🌴" accent to="/leave" />
    </div>
  );
}

function Mini({ label, value, to, accent }) {
  return (
    <Link to={to} className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2 hover:border-estrada-orange/50 transition">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${accent ? 'text-estrada-red' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </Link>
  );
}

function PerClientTable({ rows, title }) {
  if (!rows?.length) return null;
  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
        <h2 className="font-semibold text-slate-800 dark:text-white">{title}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2 text-right">Employees</th>
              <th className="px-4 py-2 text-right">Active</th>
              <th className="px-4 py-2 text-right">Onboarding</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.clientId}>
                <td className="px-4 py-2 font-medium text-slate-800 dark:text-white">{r.name}</td>
                <td className="px-4 py-2 text-right">{r.totalEmployees}</td>
                <td className="px-4 py-2 text-right">{r.activeEmployees}</td>
                <td className="px-4 py-2 text-right">{r.onboardingCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

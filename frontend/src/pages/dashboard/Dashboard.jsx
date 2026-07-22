import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatCard from '../../components/shared/StatCard.jsx';

export default function Dashboard() {
  const { user, employee } = useAuth();
  const [stats, setStats] = useState(null);
  const [onboardingTasks, setOnboardingTasks] = useState(null);

  useEffect(() => {
    if (['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD'].includes(user?.role)) {
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
        <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Here's what's happening across ESTRADA today.</p>
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

      {stats && (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard label="Total Employees" value={stats.totalEmployees} icon="👥" />
          <StatCard label="Active" value={stats.activeEmployees} icon="✅" />
          <StatCard label="Onboarding" value={stats.onboardingCount} icon="📋" />
          <StatCard label="Present Today" value={stats.todayPresent} icon="📍" />
          <StatCard label="Pending Leave" value={stats.pendingLeaves} icon="🌴" accent />
          <StatCard label="Active Clients" value={stats.clientsCount} icon="🏢" />
        </div>
      )}

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

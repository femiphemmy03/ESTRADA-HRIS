import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

export default function Attendance() {
  const { user } = useAuth();
  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD'].includes(user?.role);
  const [tab, setTab] = useState('Daily Log');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Attendance</h1>
      <CheckInOutCard />

      {isPrivileged ? (
        <>
          <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
            {['Daily Log', 'Monthly Report'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-estrada-red text-estrada-red' : 'border-transparent text-slate-500'}`}
              >
                {t}
              </button>
            ))}
          </div>
          {tab === 'Daily Log' && <AttendanceTable />}
          {tab === 'Monthly Report' && <MonthlyReport />}
        </>
      ) : (
        <MyAttendanceHistory />
      )}
    </div>
  );
}

function CheckInOutCard() {
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [today, setToday] = useState(null);

  useEffect(() => {
    api.get('/attendance/me').then((r) => {
      const t = r.data.attendances.find((a) => new Date(a.date).toDateString() === new Date().toDateString());
      setToday(t || null);
    }).catch(() => {});
  }, []);

  function getPosition() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation not supported by this browser'));
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 });
    });
  }

  async function handleCheckIn() {
    setLoading(true);
    setStatus('');
    try {
      const pos = await getPosition();
      const { data } = await api.post('/attendance/check-in', { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setToday(data.attendance);
      setStatus('Checked in successfully.');
    } catch (err) {
      setStatus(err.response?.data?.message || err.message || 'Check-in failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleCheckOut() {
    setLoading(true);
    setStatus('');
    try {
      const pos = await getPosition();
      const { data } = await api.post('/attendance/check-out', { latitude: pos.coords.latitude, longitude: pos.coords.longitude });
      setToday(data.attendance);
      setStatus('Checked out successfully.');
    } catch (err) {
      setStatus(err.response?.data?.message || err.message || 'Check-out failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-6">
      <h2 className="font-semibold text-slate-800 dark:text-white mb-1">Today</h2>
      <p className="text-sm text-slate-400 mb-4">Your GPS location is used only to confirm you are on-site.</p>
      <div className="flex flex-wrap items-center gap-4">
        <button onClick={handleCheckIn} disabled={loading || today?.checkInAt} className="btn-primary">
          {today?.checkInAt ? `Checked in at ${new Date(today.checkInAt).toLocaleTimeString()}` : loading ? 'Locating…' : 'Check In'}
        </button>
        <button onClick={handleCheckOut} disabled={loading || !today?.checkInAt || today?.checkOutAt} className="btn-secondary">
          {today?.checkOutAt ? `Checked out at ${new Date(today.checkOutAt).toLocaleTimeString()}` : loading ? 'Locating…' : 'Check Out'}
        </button>
        {today?.status && <StatusBadge status={today.status} />}
      </div>
      {status && <p className="text-sm text-slate-500 mt-3">{status}</p>}
    </div>
  );
}

function MyAttendanceHistory() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/attendance/me').then((r) => setRows(r.data.attendances)); }, []);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
          <tr>
            <th className="text-left px-4 py-3">Date</th>
            <th className="text-left px-4 py-3">Check In</th>
            <th className="text-left px-4 py-3">Check Out</th>
            <th className="text-left px-4 py-3">Hours</th>
            <th className="text-left px-4 py-3">Mode</th>
            <th className="text-left px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3">{new Date(r.date).toDateString()}</td>
              <td className="px-4 py-3">{r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString() : '—'}</td>
              <td className="px-4 py-3">{r.checkOutAt ? new Date(r.checkOutAt).toLocaleTimeString() : '—'}</td>
              <td className="px-4 py-3">{r.hoursWorked ?? '—'}</td>
              <td className="px-4 py-3 text-xs">{r.workMode === 'REMOTE' ? '🏠 Remote' : '🏢 Onsite'}</td>
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={6}>No attendance records yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceTable() {
  const [rows, setRows] = useState([]);
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(true);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [filters, setFilters] = useState({ from: todayStr, to: todayStr, siteId: '', status: '' });

  async function load() {
    setLoading(true);
    const { data } = await api.get('/attendance', {
      params: {
        from: filters.from || undefined,
        to: filters.to || undefined,
        siteId: filters.siteId || undefined,
      },
    });
    setRows(filters.status ? data.attendances.filter((r) => r.status === filters.status) : data.attendances);
    setLoading(false);
  }

  useEffect(() => {
    api.get('/clients/sites/all').then((r) => setSites(r.data.sites)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [filters.from, filters.to, filters.siteId, filters.status]); // eslint-disable-line

  const lateCount = rows.filter((r) => r.status === 'LATE').length;
  const absentCount = rows.filter((r) => r.status === 'ABSENT').length;
  const missingCheckoutCount = rows.filter((r) => r.status === 'MISSING_CHECKOUT').length;

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })} />
        </div>
        <div>
          <label className="label">Site</label>
          <select className="input" value={filters.siteId} onChange={(e) => setFilters({ ...filters, siteId: e.target.value })}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.client?.name} — {s.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}>
            <option value="">All statuses</option>
            {['PRESENT', 'LATE', 'ABSENT', 'HALF_DAY', 'EARLY_DEPARTURE', 'OVERTIME', 'MISSING_CHECKOUT', 'ON_LEAVE', 'WEEKEND', 'PUBLIC_HOLIDAY'].map((s) => (
              <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
            ))}
          </select>
        </div>
        <button onClick={() => setFilters({ from: todayStr, to: todayStr, siteId: '', status: '' })} className="btn-secondary text-sm">Reset to today</button>
      </div>

      {!loading && (filters.from === todayStr && filters.to === todayStr) && (
        <div className="flex flex-wrap gap-3 text-sm">
          <span className="badge bg-amber-100 text-amber-700">{lateCount} late today</span>
          <span className="badge bg-red-100 text-red-700">{absentCount} absent today</span>
          {missingCheckoutCount > 0 && <span className="badge bg-red-100 text-red-700">{missingCheckoutCount} missing checkout</span>}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Site</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Check In</th>
              <th className="text-left px-4 py-3">Check Out</th>
              <th className="text-left px-4 py-3">Hours</th>
              <th className="text-left px-4 py-3">Mode</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={8}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={8}>No attendance records for this filter.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-3">{r.employee?.firstName} {r.employee?.lastName} <span className="text-slate-400">({r.employee?.employeeCode})</span></td>
                  <td className="px-4 py-3">{r.site?.name || '—'}</td>
                  <td className="px-4 py-3">{new Date(r.date).toDateString()}</td>
                  <td className="px-4 py-3">{r.checkInAt ? new Date(r.checkInAt).toLocaleTimeString() : '—'}</td>
                  <td className="px-4 py-3">{r.checkOutAt ? new Date(r.checkOutAt).toLocaleTimeString() : '—'}</td>
                  <td className="px-4 py-3">{r.hoursWorked ?? '—'}</td>
                  <td className="px-4 py-3 text-xs">{r.workMode === 'REMOTE' ? '🏠 Remote' : '🏢 Onsite'}</td>
                  <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MonthlyReport() {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [sites, setSites] = useState([]);
  const [siteId, setSiteId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/attendance/monthly-report', { params: { month, year, siteId: siteId || undefined } });
    setRows(data.report);
    setLoading(false);
  }

  useEffect(() => {
    api.get('/clients/sites/all').then((r) => setSites(r.data.sites)).catch(() => {});
  }, []);

  useEffect(() => { load(); }, [month, year, siteId]); // eslint-disable-line

  function exportExcel() {
    const params = new URLSearchParams({ month, year, ...(siteId ? { siteId } : {}) });
    window.open(`${import.meta.env.VITE_API_URL}/attendance/monthly-report/export?${params.toString()}`, '_blank');
  }

  return (
    <div className="space-y-4">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Month</label>
          <input type="number" min={1} max={12} className="input w-24" value={month} onChange={(e) => setMonth(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Year</label>
          <input type="number" className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <div>
          <label className="label">Site</label>
          <select className="input" value={siteId} onChange={(e) => setSiteId(e.target.value)}>
            <option value="">All sites</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.client?.name} — {s.name}</option>)}
          </select>
        </div>
        <button onClick={exportExcel} className="btn-primary text-sm">Export Excel</button>
      </div>
      <p className="text-xs text-slate-400">
        This report is for review and record-keeping today — payroll doesn't pull from it automatically yet, that integration is coming next.
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Site</th>
              <th className="text-right px-4 py-3">Present</th>
              <th className="text-right px-4 py-3">Late</th>
              <th className="text-right px-4 py-3">Absent</th>
              <th className="text-right px-4 py-3">Half Day</th>
              <th className="text-right px-4 py-3">Overtime</th>
              <th className="text-right px-4 py-3">On Leave</th>
              <th className="text-right px-4 py-3">Remote Days</th>
              <th className="text-right px-4 py-3">Total Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={10}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={10}>No attendance records for this period.</td></tr>
            ) : (
              rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="px-4 py-3">{r.firstName} {r.lastName} <span className="text-slate-400">({r.employeeCode})</span></td>
                  <td className="px-4 py-3">{r.siteName || '—'}</td>
                  <td className="px-4 py-3 text-right">{r.presentCount}</td>
                  <td className="px-4 py-3 text-right">{r.lateCount}</td>
                  <td className="px-4 py-3 text-right">{r.absentCount}</td>
                  <td className="px-4 py-3 text-right">{r.halfDayCount}</td>
                  <td className="px-4 py-3 text-right">{r.overtimeCount}</td>
                  <td className="px-4 py-3 text-right">{r.onLeaveCount}</td>
                  <td className="px-4 py-3 text-right">{r.remoteCount}</td>
                  <td className="px-4 py-3 text-right">{r.totalHours.toFixed(1)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

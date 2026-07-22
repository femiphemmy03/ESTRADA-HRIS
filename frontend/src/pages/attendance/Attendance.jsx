import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

export default function Attendance() {
  const { user } = useAuth();
  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD'].includes(user?.role);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Attendance</h1>
      <CheckInOutCard />
      {isPrivileged && <AttendanceTable />}
      {!isPrivileged && <MyAttendanceHistory />}
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
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>No attendance records yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

function AttendanceTable() {
  const [rows, setRows] = useState([]);
  useEffect(() => { api.get('/attendance').then((r) => setRows(r.data.attendances)); }, []);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
          <tr>
            <th className="text-left px-4 py-3">Employee</th>
            <th className="text-left px-4 py-3">Site</th>
            <th className="text-left px-4 py-3">Date</th>
            <th className="text-left px-4 py-3">Hours</th>
            <th className="text-left px-4 py-3">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-4 py-3">{r.employee?.firstName} {r.employee?.lastName} <span className="text-slate-400">({r.employee?.employeeCode})</span></td>
              <td className="px-4 py-3">{r.site?.name || '—'}</td>
              <td className="px-4 py-3">{new Date(r.date).toDateString()}</td>
              <td className="px-4 py-3">{r.hoursWorked ?? '—'}</td>
              <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
            </tr>
          ))}
          {rows.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>No attendance records yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

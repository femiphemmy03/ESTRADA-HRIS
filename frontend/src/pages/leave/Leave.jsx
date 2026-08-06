import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

export default function Leave() {
  const { user, employee } = useAuth();
  const [types, setTypes] = useState([]);
  const [balances, setBalances] = useState([]);
  const [myRequests, setMyRequests] = useState([]);
  const [queue, setQueue] = useState([]);
  const [form, setForm] = useState({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
  const canApprove = ['TEAM_LEAD', 'SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);

  async function load() {
    const { data: typesData } = await api.get('/leave/types');
    setTypes(typesData.types);
    if (employee) {
      const [{ data: balData }, { data: reqData }] = await Promise.all([
        api.get(`/leave/balances/${employee.id}`),
        api.get('/leave/requests', { params: { employeeId: employee.id } }),
      ]);
      setBalances(balData.balances);
      setMyRequests(reqData.requests);
    }
    if (canApprove) {
      const { data } = await api.get('/leave/requests');
      setQueue(data.requests.filter((r) => ['PENDING_MANAGER', 'PENDING_HR'].includes(r.status)));
    }
  }

  useEffect(() => { load(); }, [employee]); // eslint-disable-line

  async function submitRequest(e) {
    e.preventDefault();
    await api.post('/leave/requests', form);
    setForm({ leaveTypeId: '', startDate: '', endDate: '', reason: '' });
    load();
  }

  async function managerApprove(id) {
    try {
      await api.post(`/leave/requests/${id}/manager-approve`);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Could not approve this request');
    }
  }

  async function hrDecision(id, approve) {
    try {
      await api.post(`/leave/requests/${id}/hr-decision`, { approve });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Could not process this request');
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Leave Management</h1>

      {employee && (
        <>
          <div className="grid sm:grid-cols-3 gap-4">
            {balances.map((b) => (
              <div key={b.id} className="card p-4">
                <p className="text-sm text-slate-400">{b.leaveType.name}</p>
                <p className="text-lg font-bold text-slate-800 dark:text-white">{b.entitledDays - b.usedDays} <span className="text-xs font-normal text-slate-400">days left</span></p>
              </div>
            ))}
          </div>

          <form onSubmit={submitRequest} className="card p-6 space-y-4">
            <h2 className="font-semibold text-slate-800 dark:text-white">Request Leave</h2>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Leave Type</label>
                <select required className="input" value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
                  <option value="">Select…</option>
                  {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </div>
              <div />
              <div>
                <label className="label">Start Date</label>
                <input type="date" required className="input" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <label className="label">End Date</label>
                <input type="date" required className="input" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div>
              <label className="label">Reason</label>
              <textarea className="input" rows={2} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </div>
            <button type="submit" className="btn-primary">Submit Request</button>
          </form>

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
                <tr><th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">Dates</th><th className="text-left px-4 py-3">Days</th><th className="text-left px-4 py-3">Status</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {myRequests.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3">{r.leaveType.name}</td>
                    <td className="px-4 py-3">{new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()}</td>
                    <td className="px-4 py-3">{r.daysRequested}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
                {myRequests.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={4}>No leave requests yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {canApprove && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-800 dark:text-white mb-3">Approval Queue</h2>
          <div className="space-y-3">
            {queue.map((r) => (
              <div key={r.id} className="flex items-center justify-between border border-slate-100 dark:border-slate-800 rounded-lg px-4 py-3">
                <div>
                  <p className="font-medium text-sm text-slate-800 dark:text-slate-100">{r.employee.firstName} {r.employee.lastName} · {r.leaveType.name}</p>
                  <p className="text-xs text-slate-400">
                    {new Date(r.startDate).toLocaleDateString()} – {new Date(r.endDate).toLocaleDateString()} ({r.daysRequested} days)
                    {r.status === 'PENDING_HR' && !r.employee.teamLeadId && ' · No team lead assigned, routed directly to HR'}
                  </p>
                </div>
                <div className="flex gap-2">
                  {r.status === 'PENDING_MANAGER' && ['TEAM_LEAD', 'SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) && (
                    <button onClick={() => managerApprove(r.id)} className="btn-secondary text-xs">Manager Approve</button>
                  )}
                  {r.status === 'PENDING_HR' && ['SUPER_ADMIN', 'HR_ADMIN'].includes(user.role) && (
                    <>
                      <button onClick={() => hrDecision(r.id, true)} className="btn-primary text-xs">Approve</button>
                      <button onClick={() => hrDecision(r.id, false)} className="btn-secondary text-xs text-red-600">Reject</button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {queue.length === 0 && <p className="text-slate-400 text-sm">No pending requests.</p>}
          </div>
        </div>
      )}
    </div>
  );
}

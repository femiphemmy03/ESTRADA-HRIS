import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

export default function EmployeesList() {
  const { user } = useAuth();
  const [employees, setEmployees] = useState([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/employees', { params: { q } });
    setEmployees(data.employees);
    setLoading(false);
  }

  useEffect(() => { load(); }, []); // eslint-disable-line

  function handleSearch(e) {
    e.preventDefault();
    load();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Employees</h1>
        {['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role) && (
          <button onClick={() => setShowInvite(true)} className="btn-primary">+ Invite Employee</button>
        )}
      </div>

      <form onSubmit={handleSearch} className="flex gap-2">
        <input className="input max-w-xs" placeholder="Search name or employee code…" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn-secondary" type="submit">Search</button>
      </form>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Department</th>
              <th className="text-left px-4 py-3">Client / Site</th>
              <th className="text-left px-4 py-3">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={4}>Loading…</td></tr>
            ) : employees.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={4}>No employees found.</td></tr>
            ) : (
              employees.map((emp) => (
                <tr key={emp.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                  <td className="px-4 py-3">
                    <Link to={`/employees/${emp.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-estrada-red">
                      {emp.firstName} {emp.lastName}
                    </Link>
                    <p className="text-xs text-slate-400">{emp.employeeCode}</p>
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{emp.department?.name || '—'}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{emp.client?.name || '—'} {emp.site?.name ? `/ ${emp.site.name}` : ''}</td>
                  <td className="px-4 py-3"><StatusBadge status={emp.employmentStatus} /></td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {showInvite && <InviteModal onClose={() => setShowInvite(false)} onCreated={load} />}
    </div>
  );
}

function InviteModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ email: '', firstName: '', lastName: '', role: 'EMPLOYEE', clientId: '', siteId: '' });
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data.clients)).catch(() => {});
  }, []);

  const selectedClient = clients.find((c) => c.id === form.clientId);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const payload = { ...form };
      if (!payload.clientId) delete payload.clientId;
      if (!payload.siteId) delete payload.siteId;
      await api.post('/auth/invite', payload);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to invite employee');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="font-bold text-lg text-slate-900 dark:text-white mb-4">Invite New Employee</h2>
        <form onSubmit={submit} className="space-y-3">
          {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">First Name</label><input required className="input" value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} /></div>
            <div><label className="label">Last Name</label><input required className="input" value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} /></div>
          </div>
          <div><label className="label">Email</label><input type="email" required className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div>
            <label className="label">Role</label>
            <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
              <option value="EMPLOYEE">Employee</option>
              <option value="TEAM_LEAD">Team Lead</option>
              <option value="PAYROLL_OFFICER">Payroll Officer</option>
              <option value="HR_ADMIN">HR Admin</option>
            </select>
          </div>

          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <p className="text-xs text-slate-400 mb-2">Client & Site assignment (recommended for attendance tracking — can also be set later on the employee's profile)</p>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Client</label>
                <select className="input" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value, siteId: '' })}>
                  <option value="">Not assigned yet</option>
                  {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Site</label>
                <select className="input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} disabled={!selectedClient}>
                  <option value="">{selectedClient ? 'Select site…' : 'Select a client first'}</option>
                  {selectedClient?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Sending…' : 'Send Invite'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

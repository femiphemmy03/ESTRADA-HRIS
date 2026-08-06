import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

const TABS = ['Departments & Positions', 'Attendance Rules', 'Users', 'Audit Logs'];

export default function Admin() {
  const [tab, setTab] = useState(TABS[0]);
  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Administration</h1>
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 flex-wrap">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-estrada-red text-estrada-red' : 'border-transparent text-slate-500'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Departments & Positions' && <OrgSettings />}
      {tab === 'Attendance Rules' && <AttendanceRules />}
      {tab === 'Users' && <Users />}
      {tab === 'Audit Logs' && <AuditLogs />}
    </div>
  );
}

function OrgSettings() {
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [deptName, setDeptName] = useState('');
  const [posTitle, setPosTitle] = useState('');
  const [posDept, setPosDept] = useState('');

  async function load() {
    const [{ data: d }, { data: p }] = await Promise.all([api.get('/org/departments'), api.get('/org/positions')]);
    setDepartments(d.departments);
    setPositions(p.positions);
  }
  useEffect(() => { load(); }, []);

  async function addDept() {
    if (!deptName) return;
    await api.post('/org/departments', { name: deptName });
    setDeptName('');
    load();
  }
  async function addPos() {
    if (!posTitle) return;
    await api.post('/org/positions', { title: posTitle, departmentId: posDept || undefined });
    setPosTitle('');
    load();
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="card p-6 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-white">Departments</h2>
        <div className="flex gap-2">
          <input className="input" placeholder="New department" value={deptName} onChange={(e) => setDeptName(e.target.value)} />
          <button onClick={addDept} className="btn-secondary">Add</button>
        </div>
        <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-800">
          {departments.map((d) => <li key={d.id} className="py-2 text-slate-700 dark:text-slate-200">{d.name}</li>)}
        </ul>
      </div>
      <div className="card p-6 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-white">Positions</h2>
        <div className="flex flex-wrap gap-2">
          <input className="input flex-1" placeholder="New position" value={posTitle} onChange={(e) => setPosTitle(e.target.value)} />
          <select className="input w-40" value={posDept} onChange={(e) => setPosDept(e.target.value)}>
            <option value="">No dept</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <button onClick={addPos} className="btn-secondary">Add</button>
        </div>
        <ul className="text-sm divide-y divide-slate-100 dark:divide-slate-800">
          {positions.map((p) => <li key={p.id} className="py-2 text-slate-700 dark:text-slate-200">{p.title} {p.department ? <span className="text-slate-400">— {p.department.name}</span> : null}</li>)}
        </ul>
      </div>
    </div>
  );
}

const WEEKDAYS = [
  { code: 'MON', label: 'Mon' }, { code: 'TUE', label: 'Tue' }, { code: 'WED', label: 'Wed' },
  { code: 'THU', label: 'Thu' }, { code: 'FRI', label: 'Fri' }, { code: 'SAT', label: 'Sat' }, { code: 'SUN', label: 'Sun' },
];

function AttendanceRules() {
  const [rules, setRules] = useState([]);
  const [sites, setSites] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const emptyForm = {
    name: '',
    siteId: '',
    isDefault: false,
    workingDays: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    remoteDays: [],
    shiftStart: '08:00',
    shiftEnd: '17:00',
    gracePeriodMinutes: 15,
    minimumHours: 8,
    halfDayHours: 4,
    overtimeThresholdHours: 9,
    gpsRadiusMeters: 150,
    weekendPolicy: 'NOT_WORKING',
    holidayPolicy: 'NOT_WORKING',
    latePolicy: '',
    earlyCheckoutPolicy: '',
    requiresApproval: false,
  };
  const [form, setForm] = useState(emptyForm);

  async function load() {
    const [{ data: r }, { data: s }] = await Promise.all([api.get('/attendance-rules'), api.get('/clients/sites/all')]);
    setRules(r.rules);
    setSites(s.sites);
  }
  useEffect(() => { load(); }, []);

  function toggleDay(code) {
    setForm((f) => ({
      ...f,
      workingDays: f.workingDays.includes(code) ? f.workingDays.filter((d) => d !== code) : [...f.workingDays, code],
      // If a day is removed from working days, it can't stay marked remote either.
      remoteDays: f.workingDays.includes(code) ? f.remoteDays.filter((d) => d !== code) : f.remoteDays,
    }));
  }

  function toggleRemoteDay(code) {
    setForm((f) => ({
      ...f,
      remoteDays: f.remoteDays.includes(code) ? f.remoteDays.filter((d) => d !== code) : [...f.remoteDays, code],
    }));
  }

  function startEdit(rule) {
    setEditingId(rule.id);
    setForm({
      name: rule.name,
      siteId: rule.siteId || '',
      isDefault: rule.isDefault,
      workingDays: rule.workingDays ? rule.workingDays.split(',').filter(Boolean) : [],
      remoteDays: rule.remoteDays ? rule.remoteDays.split(',').filter(Boolean) : [],
      shiftStart: rule.shiftStart,
      shiftEnd: rule.shiftEnd,
      gracePeriodMinutes: rule.gracePeriodMinutes,
      minimumHours: rule.minimumHours,
      halfDayHours: rule.halfDayHours,
      overtimeThresholdHours: rule.overtimeThresholdHours,
      gpsRadiusMeters: rule.gpsRadiusMeters,
      weekendPolicy: rule.weekendPolicy || 'NOT_WORKING',
      holidayPolicy: rule.holidayPolicy || 'NOT_WORKING',
      latePolicy: rule.latePolicy || '',
      earlyCheckoutPolicy: rule.earlyCheckoutPolicy || '',
      requiresApproval: rule.requiresApproval,
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
  }

  async function save() {
    if (!form.name.trim()) return alert('Please give this rule a name (e.g. "Lagos Site — Day Shift").');
    if (form.workingDays.length === 0) return alert('Select at least one working day.');
    const payload = {
      ...form,
      siteId: form.siteId || null,
      workingDays: form.workingDays.join(','),
      remoteDays: form.remoteDays.join(','),
      gracePeriodMinutes: Number(form.gracePeriodMinutes),
      minimumHours: Number(form.minimumHours),
      halfDayHours: Number(form.halfDayHours),
      overtimeThresholdHours: Number(form.overtimeThresholdHours),
      gpsRadiusMeters: Number(form.gpsRadiusMeters),
    };
    if (editingId) {
      await api.patch(`/attendance-rules/${editingId}`, payload);
    } else {
      await api.post('/attendance-rules', payload);
    }
    cancelEdit();
    load();
  }

  async function remove(id) {
    if (!confirm('Delete this attendance rule?')) return;
    await api.delete(`/attendance-rules/${id}`);
    if (editingId === id) cancelEdit();
    load();
  }

  return (
    <div className="space-y-5">
      <div className="card p-6 space-y-5">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800 dark:text-white">{editingId ? 'Edit Attendance Rule' : 'New Attendance Rule'}</h2>
            <p className="text-xs text-slate-400 mt-1">
              This defines how check-in/check-out is judged: what counts as on time, how many hours make a full day, and the GPS radius allowed for check-in.
            </p>
          </div>
          {editingId && <button type="button" onClick={cancelEdit} className="text-xs text-slate-400 hover:underline">Cancel edit</button>}
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Rule name</label>
            <input className="input" placeholder='e.g. "Head Office — Day Shift"' value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Applies to site</label>
            <select className="input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}>
              <option value="">Company-wide default (no specific site)</option>
              {sites.map((s) => <option key={s.id} value={s.id}>{s.client?.name} — {s.name}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">Each site can have at most one rule. Leave blank + tick "default" below for the fallback rule.</p>
          </div>
        </div>

        <div>
          <label className="label">Working days</label>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.map((d) => (
              <button
                type="button"
                key={d.code}
                onClick={() => toggleDay(d.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  form.workingDays.includes(d.code)
                    ? 'bg-estrada-gradient text-white border-transparent'
                    : 'border-slate-300 dark:border-slate-700 text-slate-500'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="label">Remote / work-from-home days</label>
          <p className="text-xs text-slate-400 mb-2">For hybrid teams — pick which of the working days above are WFH. On those days, GPS check-in radius is not enforced.</p>
          <div className="flex flex-wrap gap-2">
            {WEEKDAYS.filter((d) => form.workingDays.includes(d.code)).map((d) => (
              <button
                type="button"
                key={d.code}
                onClick={() => toggleRemoteDay(d.code)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                  form.remoteDays.includes(d.code)
                    ? 'bg-estrada-navy text-white border-transparent'
                    : 'border-slate-300 dark:border-slate-700 text-slate-500'
                }`}
              >
                🏠 {d.label}
              </button>
            ))}
            {form.workingDays.length === 0 && <p className="text-xs text-slate-400">Select working days first.</p>}
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Shift start time</label>
            <input type="time" className="input" value={form.shiftStart} onChange={(e) => setForm({ ...form, shiftStart: e.target.value })} />
          </div>
          <div>
            <label className="label">Shift end time</label>
            <input type="time" className="input" value={form.shiftEnd} onChange={(e) => setForm({ ...form, shiftEnd: e.target.value })} />
          </div>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="label">Grace period (minutes)</label>
            <input type="number" className="input" placeholder="e.g. 15" value={form.gracePeriodMinutes} onChange={(e) => setForm({ ...form, gracePeriodMinutes: e.target.value })} />
            <p className="text-xs text-slate-400 mt-1">Minutes after shift start before status becomes "Late".</p>
          </div>
          <div>
            <label className="label">Minimum hours for full day</label>
            <input type="number" className="input" placeholder="e.g. 8" value={form.minimumHours} onChange={(e) => setForm({ ...form, minimumHours: e.target.value })} />
          </div>
          <div>
            <label className="label">Half-day threshold (hours)</label>
            <input type="number" className="input" placeholder="e.g. 4" value={form.halfDayHours} onChange={(e) => setForm({ ...form, halfDayHours: e.target.value })} />
            <p className="text-xs text-slate-400 mt-1">Below this many hours worked = "Half Day".</p>
          </div>
          <div>
            <label className="label">Overtime threshold (hours)</label>
            <input type="number" className="input" placeholder="e.g. 9" value={form.overtimeThresholdHours} onChange={(e) => setForm({ ...form, overtimeThresholdHours: e.target.value })} />
            <p className="text-xs text-slate-400 mt-1">At or above this many hours = "Overtime".</p>
          </div>
        </div>

        <div>
          <label className="label">GPS check-in radius (meters)</label>
          <input type="number" className="input max-w-xs" placeholder="e.g. 150" value={form.gpsRadiusMeters} onChange={(e) => setForm({ ...form, gpsRadiusMeters: e.target.value })} />
          <p className="text-xs text-slate-400 mt-1">How far from the site's pinned GPS location an employee can be and still check in (ignored on remote/WFH days above).</p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Weekend policy</label>
            <select className="input" value={form.weekendPolicy} onChange={(e) => setForm({ ...form, weekendPolicy: e.target.value })}>
              <option value="NOT_WORKING">Weekends are not working days</option>
              <option value="REGULAR">Weekends count as regular working days</option>
              <option value="OVERTIME">Weekend attendance counts as overtime</option>
            </select>
          </div>
          <div>
            <label className="label">Public holiday policy</label>
            <select className="input" value={form.holidayPolicy} onChange={(e) => setForm({ ...form, holidayPolicy: e.target.value })}>
              <option value="NOT_WORKING">Holidays are not working days</option>
              <option value="REGULAR">Holidays count as regular working days</option>
              <option value="OVERTIME">Holiday attendance counts as overtime</option>
            </select>
          </div>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Late policy notes (optional)</label>
            <textarea className="input" rows={2} placeholder='e.g. "3 lates in a month triggers a warning letter"' value={form.latePolicy} onChange={(e) => setForm({ ...form, latePolicy: e.target.value })} />
          </div>
          <div>
            <label className="label">Early checkout policy notes (optional)</label>
            <textarea className="input" rows={2} placeholder='e.g. "Requires Team Lead sign-off in advance"' value={form.earlyCheckoutPolicy} onChange={(e) => setForm({ ...form, earlyCheckoutPolicy: e.target.value })} />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
          <input type="checkbox" checked={form.isDefault} onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
          Use as the company-wide default rule (applies to any employee whose site has no specific rule)
        </label>

        <div className="flex gap-2">
          <button onClick={save} className="btn-primary">{editingId ? 'Save Changes' : 'Create Rule'}</button>
          {editingId && <button type="button" onClick={cancelEdit} className="btn-secondary">Cancel</button>}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Site</th>
              <th className="text-left px-4 py-3">Working Days</th>
              <th className="text-left px-4 py-3">Remote Days</th>
              <th className="text-left px-4 py-3">Shift</th>
              <th className="text-left px-4 py-3">Grace</th>
              <th className="text-left px-4 py-3">Default</th>
              <th className="text-left px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rules.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">{r.name}</td>
                <td className="px-4 py-3">{r.site?.name || '— (default)'}</td>
                <td className="px-4 py-3 text-xs">{r.workingDays}</td>
                <td className="px-4 py-3 text-xs">{r.remoteDays || '—'}</td>
                <td className="px-4 py-3">{r.shiftStart} – {r.shiftEnd}</td>
                <td className="px-4 py-3">{r.gracePeriodMinutes}m</td>
                <td className="px-4 py-3">{r.isDefault ? 'Yes' : 'No'}</td>
                <td className="px-4 py-3 flex gap-2">
                  <button onClick={() => startEdit(r)} className="text-xs text-estrada-red hover:underline">Edit</button>
                  <button onClick={() => remove(r.id)} className="text-xs text-red-600 hover:underline">Delete</button>
                </td>
              </tr>
            ))}
            {rules.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={8}>No attendance rules created yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Users() {
  const [users, setUsers] = useState([]);
  async function load() {
    const { data } = await api.get('/admin/users');
    setUsers(data.users);
  }
  useEffect(() => { load(); }, []);

  async function changeRole(id, role) {
    await api.patch(`/admin/users/${id}/role`, { role });
    load();
  }
  async function deactivate(id) {
    if (!confirm('Deactivate this user?')) return;
    await api.patch(`/admin/users/${id}/deactivate`);
    load();
  }

  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
          <tr><th className="text-left px-4 py-3">Email</th><th className="text-left px-4 py-3">Employee</th><th className="text-left px-4 py-3">Role</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Actions</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {users.map((u) => (
            <tr key={u.id}>
              <td className="px-4 py-3">{u.email}</td>
              <td className="px-4 py-3">{u.employee ? `${u.employee.firstName} ${u.employee.lastName}` : '—'}</td>
              <td className="px-4 py-3">
                <select className="input !py-1 !w-40" value={u.role} onChange={(e) => changeRole(u.id, e.target.value)}>
                  {['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD', 'EMPLOYEE'].map((r) => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                </select>
              </td>
              <td className="px-4 py-3">{u.isActive ? <span className="badge bg-green-100 text-green-700">Active</span> : <span className="badge bg-red-100 text-red-700">Inactive</span>}</td>
              <td className="px-4 py-3">{u.isActive && <button onClick={() => deactivate(u.id)} className="btn-secondary text-xs text-red-600">Deactivate</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AuditLogs() {
  const [logs, setLogs] = useState([]);
  useEffect(() => { api.get('/admin/audit-logs').then((r) => setLogs(r.data.logs)); }, []);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
          <tr><th className="text-left px-4 py-3">When</th><th className="text-left px-4 py-3">Employee</th><th className="text-left px-4 py-3">Action</th><th className="text-left px-4 py-3">By</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {logs.map((l) => (
            <tr key={l.id}>
              <td className="px-4 py-3">{new Date(l.createdAt).toLocaleString()}</td>
              <td className="px-4 py-3">{l.employee ? `${l.employee.firstName} ${l.employee.lastName}` : '—'}</td>
              <td className="px-4 py-3">{l.description}</td>
              <td className="px-4 py-3">{l.actor?.email || 'System'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

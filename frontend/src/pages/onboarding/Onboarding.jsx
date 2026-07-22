import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

export default function Onboarding() {
  const { user } = useAuth();
  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);
  return isPrivileged ? <OnboardingManagement /> : <OnboardingSelfService />;
}

// ---------------------------------------------------------
// HR / Super Admin — monitor everyone currently onboarding
// ---------------------------------------------------------
function OnboardingManagement() {
  const [employees, setEmployees] = useState([]);
  const [progress, setProgress] = useState({}); // employeeId -> { done, total }
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data } = await api.get('/employees', { params: { employmentStatus: 'ONBOARDING' } });
    setEmployees(data.employees);
    const entries = await Promise.all(
      data.employees.map(async (emp) => {
        const { data: t } = await api.get(`/onboarding/${emp.id}`);
        const done = t.tasks.filter((x) => x.isComplete).length;
        return [emp.id, { done, total: t.tasks.length }];
      })
    );
    setProgress(Object.fromEntries(entries));
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function initialize(employeeId) {
    await api.post(`/onboarding/${employeeId}/initialize`);
    load();
  }

  async function approve(employeeId) {
    await api.post(`/employees/${employeeId}/approve-onboarding`);
    load();
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Onboarding</h1>
        <p className="text-sm text-slate-400">Track and manage every employee currently onboarding.</p>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Employee</th>
              <th className="text-left px-4 py-3">Client / Site</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="text-left px-4 py-3">Checklist Progress</th>
              <th className="text-left px-4 py-3">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {loading ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>Loading…</td></tr>
            ) : employees.length === 0 ? (
              <tr><td className="px-4 py-6 text-slate-400" colSpan={5}>No one is currently onboarding. New invites will show up here automatically.</td></tr>
            ) : (
              employees.map((emp) => {
                const p = progress[emp.id];
                return (
                  <tr key={emp.id}>
                    <td className="px-4 py-3">
                      <Link to={`/employees/${emp.id}`} className="font-medium text-slate-800 dark:text-slate-100 hover:text-estrada-red">{emp.firstName} {emp.lastName}</Link>
                      <p className="text-xs text-slate-400">{emp.employeeCode}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{emp.client?.name || '— not assigned'}{emp.site?.name ? ` / ${emp.site.name}` : ''}</td>
                    <td className="px-4 py-3"><StatusBadge status={emp.onboardingStatus} /></td>
                    <td className="px-4 py-3">
                      {p ? (
                        p.total === 0 ? (
                          <span className="text-slate-400">No checklist yet</span>
                        ) : (
                          <span>{p.done} / {p.total} complete</span>
                        )
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 flex flex-wrap gap-2">
                      {(!p || p.total === 0) && (
                        <button onClick={() => initialize(emp.id)} className="btn-secondary text-xs">Initialize Checklist</button>
                      )}
                      {emp.onboardingStatus === 'SUBMITTED' && (
                        <button onClick={() => approve(emp.id)} className="btn-primary text-xs">Approve</button>
                      )}
                      <Link to={`/employees/${emp.id}`} className="btn-secondary text-xs">View Profile</Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------
// Employee self-service — checklist, biodata, submit
// ---------------------------------------------------------
function OnboardingSelfService() {
  const { employee, refresh } = useAuth();
  const [tasks, setTasks] = useState([]);
  const [form, setForm] = useState({});
  const [saved, setSaved] = useState(false);

  async function loadTasks() {
    const { data } = await api.get(`/onboarding/${employee.id}`);
    setTasks(data.tasks);
  }

  useEffect(() => {
    if (employee) {
      loadTasks();
      setForm({
        phone: employee.phone || '',
        gender: employee.gender || '',
        dateOfBirth: employee.dateOfBirth ? employee.dateOfBirth.slice(0, 10) : '',
        address: employee.address || '',
        emergencyContactName: employee.emergencyContactName || '',
        emergencyContactPhone: employee.emergencyContactPhone || '',
        nextOfKinName: employee.nextOfKinName || '',
        nextOfKinPhone: employee.nextOfKinPhone || '',
        bankName: employee.bankName || '',
        bankAccountNumber: employee.bankAccountNumber || '',
        bankAccountName: employee.bankAccountName || '',
      });
    }
  }, [employee]); // eslint-disable-line

  async function toggleTask(taskId) {
    await api.patch(`/onboarding/task/${taskId}/complete`);
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, isComplete: true } : t)));
  }

  async function saveBiodata(e) {
    e.preventDefault();
    await api.patch(`/employees/${employee.id}`, form);
    setSaved(true);
    refresh();
    setTimeout(() => setSaved(false), 2000);
  }

  async function submitOnboarding() {
    await api.post(`/employees/${employee.id}/submit-onboarding`);
    refresh();
  }

  if (!employee) return <p className="text-slate-400">Loading…</p>;

  const allComplete = tasks.length > 0 && tasks.every((t) => t.isComplete);
  const alreadySubmitted = ['SUBMITTED', 'APPROVED'].includes(employee.onboardingStatus);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Onboarding</h1>
        <p className="text-sm text-slate-400">Complete every step below, then submit for HR review.</p>
      </div>

      {tasks.length === 0 && (
        <div className="card p-4 bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm">
          Your checklist hasn't been set up yet. Please reach out to HR — they can initialize it from their Onboarding screen.
        </div>
      )}

      <div className="card p-6">
        <h2 className="font-semibold text-slate-800 dark:text-white mb-3">Checklist</h2>
        <div className="space-y-2">
          {tasks.map((t) => (
            <label key={t.id} className="flex items-center gap-3 text-sm cursor-pointer">
              <input type="checkbox" checked={t.isComplete} onChange={() => !t.isComplete && toggleTask(t.id)} className="h-4 w-4 accent-estrada-red" />
              <span className={t.isComplete ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}>{t.label}</span>
            </label>
          ))}
        </div>
      </div>

      <form onSubmit={saveBiodata} className="card p-6 space-y-4">
        <h2 className="font-semibold text-slate-800 dark:text-white">Biodata</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Phone" value={form.phone} onChange={(v) => setForm({ ...form, phone: v })} />
          <Field label="Gender" value={form.gender} onChange={(v) => setForm({ ...form, gender: v })} />
          <Field label="Date of Birth" type="date" value={form.dateOfBirth} onChange={(v) => setForm({ ...form, dateOfBirth: v })} />
          <Field label="Address" value={form.address} onChange={(v) => setForm({ ...form, address: v })} />
          <Field label="Emergency Contact Name" value={form.emergencyContactName} onChange={(v) => setForm({ ...form, emergencyContactName: v })} />
          <Field label="Emergency Contact Phone" value={form.emergencyContactPhone} onChange={(v) => setForm({ ...form, emergencyContactPhone: v })} />
          <Field label="Next of Kin Name" value={form.nextOfKinName} onChange={(v) => setForm({ ...form, nextOfKinName: v })} />
          <Field label="Next of Kin Phone" value={form.nextOfKinPhone} onChange={(v) => setForm({ ...form, nextOfKinPhone: v })} />
          <Field label="Bank Name" value={form.bankName} onChange={(v) => setForm({ ...form, bankName: v })} />
          <Field label="Account Number" value={form.bankAccountNumber} onChange={(v) => setForm({ ...form, bankAccountNumber: v })} />
          <Field label="Account Name" value={form.bankAccountName} onChange={(v) => setForm({ ...form, bankAccountName: v })} />
        </div>
        <div className="flex items-center gap-3">
          <button type="submit" className="btn-primary">Save Biodata</button>
          {saved && <span className="text-green-600 text-sm">Saved!</span>}
        </div>
      </form>

      <div className="card p-6 flex items-center justify-between">
        <div>
          <p className="font-medium text-slate-800 dark:text-white">
            {alreadySubmitted ? 'Submitted' : 'Ready to submit?'}
          </p>
          <p className="text-sm text-slate-400">
            {alreadySubmitted
              ? 'HR has your submission and will activate your account once reviewed.'
              : tasks.length === 0
              ? 'Waiting on HR to set up your checklist before you can submit.'
              : !allComplete
              ? 'Tick off every checklist item above to enable submission.'
              : 'Once submitted, HR will review and activate your account.'}
          </p>
        </div>
        {!alreadySubmitted && <button onClick={submitOnboarding} disabled={!allComplete} className="btn-primary">Submit for Review</button>}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = 'text' }) {
  return (
    <div>
      <label className="label">{label}</label>
      <input type={type} className="input" value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

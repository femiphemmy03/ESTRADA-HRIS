import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

export default function Payroll() {
  const { user } = useAuth();
  const isPayroll = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'].includes(user?.role);
  const [tab, setTab] = useState(isPayroll ? 'Runs' : 'My Payslips');
  const tabs = isPayroll ? ['Runs', 'Salary Structures', 'Statutory Settings', 'My Payslips'] : ['My Payslips'];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Payroll</h1>
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-estrada-red text-estrada-red' : 'border-transparent text-slate-500'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Runs' && <PayrollRuns />}
      {tab === 'Salary Structures' && <SalaryStructures />}
      {tab === 'Statutory Settings' && <StatutorySettings />}
      {tab === 'My Payslips' && <MyPayslips />}
    </div>
  );
}

function PayrollRuns() {
  const [runs, setRuns] = useState([]);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedRun, setSelectedRun] = useState(null);
  const [payslips, setPayslips] = useState([]);

  async function loadRuns() {
    const { data } = await api.get('/payroll/runs');
    setRuns(data.runs);
  }
  useEffect(() => { loadRuns(); }, []);

  async function createRun() {
    await api.post('/payroll/runs', { month: Number(month), year: Number(year) });
    loadRuns();
  }

  async function process(runId) {
    await api.post(`/payroll/runs/${runId}/process`);
    loadRuns();
    if (selectedRun === runId) viewPayslips(runId);
  }

  async function approve(runId) {
    await api.post(`/payroll/runs/${runId}/approve`);
    loadRuns();
  }

  async function viewPayslips(runId) {
    setSelectedRun(runId);
    const { data } = await api.get(`/payroll/runs/${runId}/payslips`);
    setPayslips(data.payslips);
  }

  function exportRun(runId) {
    window.open(`${import.meta.env.VITE_API_URL}/payroll/runs/${runId}/export`, '_blank');
  }

  return (
    <div className="space-y-5">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div><label className="label">Month</label><input type="number" min={1} max={12} className="input w-24" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
        <div><label className="label">Year</label><input type="number" className="input w-28" value={year} onChange={(e) => setYear(e.target.value)} /></div>
        <button onClick={createRun} className="btn-primary">Create/Open Run</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr><th className="text-left px-4 py-3">Period</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">{r.month}/{r.year}</td>
                <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                <td className="px-4 py-3 flex flex-wrap gap-2">
                  <button onClick={() => process(r.id)} className="btn-secondary text-xs">Process</button>
                  {r.status === 'REVIEW' && <button onClick={() => approve(r.id)} className="btn-secondary text-xs">Approve</button>}
                  <button onClick={() => viewPayslips(r.id)} className="btn-secondary text-xs">View Payslips</button>
                  <button onClick={() => exportRun(r.id)} className="btn-secondary text-xs">Export Excel</button>
                </td>
              </tr>
            ))}
            {runs.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={3}>No payroll runs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedRun && (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
              <tr><th className="text-left px-4 py-3">Employee</th><th className="text-left px-4 py-3">Net Pay</th><th className="text-left px-4 py-3">Payslip</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {payslips.map((p) => (
                <tr key={p.id}>
                  <td className="px-4 py-3">{p.employee.firstName} {p.employee.lastName}</td>
                  <td className="px-4 py-3">{p.netPay.toFixed(2)}</td>
                  <td className="px-4 py-3">
                    <button onClick={async () => { await api.post(`/payroll/payslips/${p.id}/generate-pdf`); viewPayslips(selectedRun); }} className="btn-secondary text-xs">
                      {p.pdfUrl ? 'Regenerate PDF' : 'Generate PDF'}
                    </button>
                    {p.pdfUrl && <a href={p.pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-estrada-red ml-2 hover:underline">Download</a>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SalaryStructures() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [form, setForm] = useState({ basicSalary: '', allowances: [], deductions: [] });

  useEffect(() => { api.get('/employees').then((r) => setEmployees(r.data.employees)); }, []);

  async function loadStructure(id) {
    setEmployeeId(id);
    const { data } = await api.get(`/payroll/salary-structure/${id}`);
    setForm(data.structure ? { basicSalary: data.structure.basicSalary, allowances: data.structure.allowances, deductions: data.structure.deductions } : { basicSalary: '', allowances: [], deductions: [] });
  }

  function addLine(field) {
    setForm({ ...form, [field]: [...form[field], { name: '', amount: 0 }] });
  }

  function updateLine(field, idx, key, value) {
    const list = [...form[field]];
    list[idx] = { ...list[idx], [key]: key === 'amount' ? Number(value) : value };
    setForm({ ...form, [field]: list });
  }

  async function save() {
    await api.put('/payroll/salary-structure', { employeeId, basicSalary: Number(form.basicSalary), allowances: form.allowances, deductions: form.deductions });
    alert('Salary structure saved');
  }

  return (
    <div className="card p-6 space-y-4">
      <div>
        <label className="label">Employee</label>
        <select className="input" value={employeeId} onChange={(e) => loadStructure(e.target.value)}>
          <option value="">Select employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
        </select>
      </div>
      {employeeId && (
        <>
          <div><label className="label">Basic Salary</label><input type="number" className="input" value={form.basicSalary} onChange={(e) => setForm({ ...form, basicSalary: e.target.value })} /></div>

          <div>
            <div className="flex justify-between items-center mb-2"><label className="label !mb-0">Allowances</label><button onClick={() => addLine('allowances')} className="text-xs text-estrada-red">+ Add</button></div>
            {form.allowances.map((a, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input className="input" placeholder="Name" value={a.name} onChange={(e) => updateLine('allowances', i, 'name', e.target.value)} />
                <input type="number" className="input w-32" placeholder="Amount" value={a.amount} onChange={(e) => updateLine('allowances', i, 'amount', e.target.value)} />
              </div>
            ))}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2"><label className="label !mb-0">Other Deductions</label><button onClick={() => addLine('deductions')} className="text-xs text-estrada-red">+ Add</button></div>
            {form.deductions.map((d, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input className="input" placeholder="Name" value={d.name} onChange={(e) => updateLine('deductions', i, 'name', e.target.value)} />
                <input type="number" className="input w-32" placeholder="Amount" value={d.amount} onChange={(e) => updateLine('deductions', i, 'amount', e.target.value)} />
              </div>
            ))}
          </div>

          <button onClick={save} className="btn-primary">Save Salary Structure</button>
        </>
      )}
    </div>
  );
}

function StatutorySettings() {
  const [settings, setSettings] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'PENSION_EMPLOYEE', percent: '', effectiveFrom: '' });

  async function load() {
    const { data } = await api.get('/payroll/settings');
    setSettings(data.settings);
  }
  useEffect(() => { load(); }, []);

  async function create() {
    await api.post('/payroll/settings', {
      name: form.name,
      type: form.type,
      config: { percent: Number(form.percent) / 100 },
      effectiveFrom: form.effectiveFrom,
    });
    setForm({ name: '', type: 'PENSION_EMPLOYEE', percent: '', effectiveFrom: '' });
    load();
  }

  return (
    <div className="space-y-5">
      <div className="card p-6 space-y-4">
        <h2 className="font-semibold text-slate-800 dark:text-white">Add Statutory Rule (flat %)</h2>
        <p className="text-xs text-slate-400">For PAYE tax bands, edit brackets directly via the API — this quick form covers flat-percent rules like Pension/NHF.</p>
        <div className="grid sm:grid-cols-4 gap-3">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="PENSION_EMPLOYEE">Pension (Employee)</option>
            <option value="PENSION_EMPLOYER">Pension (Employer)</option>
            <option value="NHF">NHF</option>
            <option value="CUSTOM">Custom</option>
          </select>
          <input type="number" className="input" placeholder="Percent e.g. 8" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
          <input type="date" className="input" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
        </div>
        <button onClick={create} className="btn-primary">Add Rule</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr><th className="text-left px-4 py-3">Name</th><th className="text-left px-4 py-3">Type</th><th className="text-left px-4 py-3">Effective From</th><th className="text-left px-4 py-3">Active</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {settings.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">{s.name}</td>
                <td className="px-4 py-3">{s.type}</td>
                <td className="px-4 py-3">{new Date(s.effectiveFrom).toDateString()}</td>
                <td className="px-4 py-3">{s.isActive ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MyPayslips() {
  const [payslips, setPayslips] = useState([]);
  useEffect(() => { api.get('/payroll/payslips/me').then((r) => setPayslips(r.data.payslips)).catch(() => {}); }, []);
  return (
    <div className="card overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
          <tr><th className="text-left px-4 py-3">Period</th><th className="text-left px-4 py-3">Net Pay</th><th className="text-left px-4 py-3">Payslip</th></tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {payslips.map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3">{p.payrollRun.month}/{p.payrollRun.year}</td>
              <td className="px-4 py-3">{p.netPay.toFixed(2)}</td>
              <td className="px-4 py-3">{p.pdfUrl ? <a href={p.pdfUrl} target="_blank" rel="noreferrer" className="text-estrada-red hover:underline">Download</a> : '—'}</td>
            </tr>
          ))}
          {payslips.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={3}>No payslips yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

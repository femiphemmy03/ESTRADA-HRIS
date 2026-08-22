import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

export default function Payroll() {
  const { user } = useAuth();
  const canRunPayroll = ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER'].includes(user?.role);
  const canApprove = ['SUPER_ADMIN', 'HR_MANAGER'].includes(user?.role);
  const hasAnyPrivilege = canRunPayroll || canApprove;
  const [tab, setTab] = useState(canRunPayroll || canApprove ? 'Runs' : 'My Payslips');
  const tabs = [
    ...(canRunPayroll || canApprove ? ['Runs'] : []),
    ...(canRunPayroll ? ['Salary Structures', 'Statutory Settings'] : []),
    'My Payslips',
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Payroll</h1>
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-estrada-red text-estrada-red' : 'border-transparent text-slate-500'}`}>{t}</button>
        ))}
      </div>
      {tab === 'Runs' && <PayrollRuns canRunPayroll={canRunPayroll} canApprove={canApprove} />}
      {tab === 'Salary Structures' && <SalaryStructures />}
      {tab === 'Statutory Settings' && <StatutorySettings />}
      {tab === 'My Payslips' && <MyPayslips />}
    </div>
  );
}

const STATUS_HINTS = {
  DRAFT: 'Not processed yet',
  REVIEW: 'Processed — ready to submit for approval',
  PENDING_HR_MANAGER: 'Awaiting HR Manager approval',
  PENDING_SUPER_ADMIN: 'HR Manager approved — awaiting Super Admin final approval',
  APPROVED: 'Fully approved — payslips generated and visible to employees',
  REJECTED: 'Rejected — back with Payroll for changes',
  PAID: 'Paid',
};

function PayrollRuns({ canRunPayroll, canApprove }) {
  const { user } = useAuth();
  const [runs, setRuns] = useState([]);
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedRun, setSelectedRun] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [error, setError] = useState('');

  async function loadRuns() {
    const { data } = await api.get('/payroll/runs');
    setRuns(data.runs);
  }
  useEffect(() => { loadRuns(); }, []);

  async function act(action, runId, body) {
    setError('');
    try {
      await api.post(`/payroll/runs/${runId}/${action}`, body);
      loadRuns();
      if (selectedRun === runId) viewPayslips(runId);
    } catch (err) {
      setError(err.response?.data?.message || 'Action failed');
    }
  }

  async function createRun() {
    await api.post('/payroll/runs', { month: Number(month), year: Number(year) });
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

  function reject(runId) {
    const reason = prompt('Reason for rejecting this run (sent back to Review):');
    if (reason) act('reject', runId, { reason });
  }

  return (
    <div className="space-y-5">
      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

      {canRunPayroll && (
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div><label className="label">Month</label><input type="number" min={1} max={12} className="input w-24" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div><label className="label">Year</label><input type="number" className="input w-28" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          <button onClick={createRun} className="btn-primary">Create/Open Run</button>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr><th className="text-left px-4 py-3">Period</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {runs.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-3">{r.month}/{r.year}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={r.status} />
                  <p className="text-xs text-slate-400 mt-1">{STATUS_HINTS[r.status]}</p>
                  {r.status === 'REVIEW' && r.rejectionReason && (
                    <p className="text-xs text-red-500 mt-1">Last rejection: {r.rejectionReason}</p>
                  )}
                </td>
                <td className="px-4 py-3 flex flex-wrap gap-2">
                  {canRunPayroll && ['DRAFT', 'REVIEW', 'REJECTED'].includes(r.status) && (
                    <button onClick={() => act('process', r.id)} className="btn-secondary text-xs">Process</button>
                  )}
                  {canRunPayroll && r.status === 'REVIEW' && (
                    <button onClick={() => act('submit-for-approval', r.id)} className="btn-primary text-xs">Submit for Approval</button>
                  )}
                  {canApprove && r.status === 'PENDING_HR_MANAGER' && ['HR_MANAGER', 'SUPER_ADMIN'].includes(user.role) && (
                    <>
                      <button onClick={() => act('hr-manager-approve', r.id)} className="btn-primary text-xs">HR Manager Approve</button>
                      <button onClick={() => reject(r.id)} className="btn-secondary text-xs text-red-600">Reject</button>
                    </>
                  )}
                  {canApprove && r.status === 'PENDING_SUPER_ADMIN' && user.role === 'SUPER_ADMIN' && (
                    <>
                      <button onClick={() => act('final-approve', r.id)} className="btn-primary text-xs">Final Approve</button>
                      <button onClick={() => reject(r.id)} className="btn-secondary text-xs text-red-600">Reject</button>
                    </>
                  )}
                  <button onClick={() => viewPayslips(r.id)} className="btn-secondary text-xs">View Payslips</button>
                  {(canRunPayroll || canApprove) && <button onClick={() => exportRun(r.id)} className="btn-secondary text-xs">Export Excel</button>}
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
                    {p.pdfUrl ? (
                      <a href={p.pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-estrada-red hover:underline">Download</a>
                    ) : (
                      <span className="text-xs text-slate-400">Generated automatically once fully approved</span>
                    )}
                  </td>
                </tr>
              ))}
              {payslips.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={3}>No payslips in this run yet — process it first.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// Housing and Transport are always present as dedicated fields (Basic + Housing + Transport
// = the company's default "BHT" salary format). Under the hood they're still just entries
// in the generic `allowances` array the backend already understands — no API change needed.
// "Other Allowances" below covers anything beyond Housing/Transport (bonuses, top-ups, etc).
function SalaryStructures() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [housing, setHousing] = useState('');
  const [transport, setTransport] = useState('');
  const [otherAllowances, setOtherAllowances] = useState([]);
  const [deductions, setDeductions] = useState([]);

  useEffect(() => { api.get('/employees').then((r) => setEmployees(r.data.employees)); }, []);

  async function loadStructure(id) {
    setEmployeeId(id);
    const { data } = await api.get(`/payroll/salary-structure/${id}`);
    const allowances = data.structure?.allowances || [];
    const housingEntry = allowances.find((a) => a.name.toLowerCase() === 'housing');
    const transportEntry = allowances.find((a) => a.name.toLowerCase() === 'transport');
    const rest = allowances.filter((a) => !['housing', 'transport'].includes(a.name.toLowerCase()));

    setBasicSalary(data.structure?.basicSalary ?? '');
    setHousing(housingEntry?.amount ?? '');
    setTransport(transportEntry?.amount ?? '');
    setOtherAllowances(rest);
    setDeductions(data.structure?.deductions || []);
  }

  function addOtherAllowance() {
    setOtherAllowances([...otherAllowances, { name: '', amount: 0 }]);
  }
  function updateOtherAllowance(idx, key, value) {
    const list = [...otherAllowances];
    list[idx] = { ...list[idx], [key]: key === 'amount' ? Number(value) : value };
    setOtherAllowances(list);
  }
  function removeOtherAllowance(idx) {
    setOtherAllowances(otherAllowances.filter((_, i) => i !== idx));
  }

  function addDeduction() {
    setDeductions([...deductions, { name: '', amount: 0 }]);
  }
  function updateDeduction(idx, key, value) {
    const list = [...deductions];
    list[idx] = { ...list[idx], [key]: key === 'amount' ? Number(value) : value };
    setDeductions(list);
  }

  async function save() {
    const allowances = [
      { name: 'Housing', amount: Number(housing) || 0 },
      { name: 'Transport', amount: Number(transport) || 0 },
      ...otherAllowances,
    ];
    await api.put('/payroll/salary-structure', {
      employeeId,
      basicSalary: Number(basicSalary) || 0,
      allowances,
      deductions,
    });
    alert('Salary structure saved');
  }

  return (
    <div className="card p-6 space-y-5">
      <div>
        <label className="label">Employee</label>
        <select className="input" value={employeeId} onChange={(e) => loadStructure(e.target.value)}>
          <option value="">Select employee…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
        </select>
      </div>

      {employeeId && (
        <>
          <div>
            <p className="label !mb-2">Basic + Housing + Transport (BHT)</p>
            <div className="grid sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Basic Salary</label>
                <input type="number" className="input" value={basicSalary} onChange={(e) => setBasicSalary(e.target.value)} />
              </div>
              <div>
                <label className="label">Housing Allowance</label>
                <input type="number" className="input" value={housing} onChange={(e) => setHousing(e.target.value)} />
              </div>
              <div>
                <label className="label">Transport Allowance</label>
                <input type="number" className="input" value={transport} onChange={(e) => setTransport(e.target.value)} />
              </div>
            </div>
          </div>

          <div>
            <div className="flex justify-between items-center mb-2"><label className="label !mb-0">Other Allowances</label><button onClick={addOtherAllowance} className="text-xs text-estrada-red">+ Add</button></div>
            {otherAllowances.map((a, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input className="input" placeholder="Name (e.g. Bonus)" value={a.name} onChange={(e) => updateOtherAllowance(i, 'name', e.target.value)} />
                <input type="number" className="input w-32" placeholder="Amount" value={a.amount} onChange={(e) => updateOtherAllowance(i, 'amount', e.target.value)} />
                <button onClick={() => removeOtherAllowance(i)} className="text-red-600 text-xs px-2">✕</button>
              </div>
            ))}
            {otherAllowances.length === 0 && <p className="text-xs text-slate-400">None — Basic, Housing, and Transport cover the default structure.</p>}
          </div>

          <div>
            <div className="flex justify-between items-center mb-2"><label className="label !mb-0">Other Deductions</label><button onClick={addDeduction} className="text-xs text-estrada-red">+ Add</button></div>
            {deductions.map((d, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input className="input" placeholder="Name" value={d.name} onChange={(e) => updateDeduction(i, 'name', e.target.value)} />
                <input type="number" className="input w-32" placeholder="Amount" value={d.amount} onChange={(e) => updateDeduction(i, 'amount', e.target.value)} />
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
          {payslips.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={3}>No approved payslips yet.</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

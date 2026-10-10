import { useEffect, useState } from 'react';
import api, { downloadFile } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

export default function Payroll() {
  const { user } = useAuth();
  const canRunPayroll = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER', 'PAYROLL_OFFICER'].includes(user?.role);
  const canApprove = ['SUPER_ADMIN', 'HR_MANAGER'].includes(user?.role);
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

function splitAllowances(breakdown) {
  const allowances = breakdown?.allowances || [];
  const housing = allowances.find((a) => a.name.toLowerCase() === 'housing')?.amount || 0;
  const transport = allowances.find((a) => a.name.toLowerCase() === 'transport')?.amount || 0;
  const other = allowances
    .filter((a) => !['housing', 'transport'].includes(a.name.toLowerCase()))
    .reduce((sum, a) => sum + a.amount, 0);
  return { housing, transport, other };
}

const naira = (n) => `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const PAY_STATUS_STYLE = {
  NOT_PAID: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  PROCESSING: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SUCCESS: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  FAILED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

function PayrollRuns({ canRunPayroll, canApprove }) {
  const { user } = useAuth();
  const isSuper = user?.role === 'SUPER_ADMIN';
  const [runs, setRuns] = useState([]);
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [year, setYear] = useState(new Date().getFullYear());
  const [selectedRun, setSelectedRun] = useState(null);
  const [payslips, setPayslips] = useState([]);
  const [checked, setChecked] = useState(new Set());
  const [walletBalance, setWalletBalance] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = runs.find((r) => r.id === selectedRun);
  const paymentsOpen = run && ['APPROVED', 'PAID'].includes(run.status);

  async function loadRuns() {
    const { data } = await api.get('/payroll/runs');
    setRuns(data.runs);
  }
  useEffect(() => {
    loadRuns();
    api.get('/clients').then((r) => {
      setClients(r.data.clients);
      if (r.data.clients.length === 1) setClientId(r.data.clients[0].id);
    }).catch(() => {});
  }, []);

  async function loadWalletBalance(forRun) {
    setWalletBalance(null);
    if (!isSuper || !forRun?.clientId) return;
    try {
      const { data } = await api.get('/wallet/clients');
      setWalletBalance(data.clients.find((c) => c.clientId === forRun.clientId)?.balance ?? 0);
    } catch { /* balance is a convenience only */ }
  }

  async function act(action, runId, body) {
    setError('');
    setNotice('');
    try {
      await api.post(`/payroll/runs/${runId}/${action}`, body);
      await loadRuns();
      if (selectedRun === runId) viewPayslips(runId);
    } catch (err) {
      setError(err.response?.data?.message || 'Action failed');
    }
  }

  async function createRun() {
    setError('');
    if (!clientId) { setError('Choose a client first — payroll is run per client.'); return; }
    try {
      await api.post('/payroll/runs', { month: Number(month), year: Number(year), clientId });
      loadRuns();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not open the run');
    }
  }

  async function viewPayslips(runId) {
    setSelectedRun(runId);
    setChecked(new Set());
    const { data } = await api.get(`/payroll/runs/${runId}/payslips`);
    setPayslips(data.payslips);
    loadWalletBalance(runs.find((r) => r.id === runId));
  }

  async function exportRun(runId, runLabel) {
    setExporting(true);
    try {
      await downloadFile(`/payroll/runs/${runId}/export`, {}, `payroll-${runLabel}.xlsx`);
    } catch (err) {
      alert('Export failed — please try again.');
    } finally {
      setExporting(false);
    }
  }

  function reject(runId) {
    const reason = prompt('Reason for rejecting this run (sent back to Review):');
    if (reason) act('reject', runId, { reason });
  }

  const payable = (p) => (p.paymentStatus === 'SUCCESS' ? false : true);
  const selectable = payslips.filter(payable);

  function toggle(id) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setChecked((prev) => (prev.size === selectable.length ? new Set() : new Set(selectable.map((p) => p.id))));
  }

  async function setApproval(approve, ids) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/payroll/runs/${selectedRun}/payment-approval`, { approve, ...(ids ? { payslipIds: ids } : {}) });
      setNotice(`${approve ? 'Approved' : 'Approval removed for'} ${data.updated} payment(s).`);
      await viewPayslips(selectedRun);
    } catch (err) {
      setError(err.response?.data?.message || 'Could not update payment approval');
    } finally {
      setBusy(false);
    }
  }

  const approvedUnpaid = payslips.filter((p) => p.paymentApproval === 'APPROVED' && ['NOT_PAID', 'FAILED'].includes(p.paymentStatus));
  const approvedTotal = approvedUnpaid.reduce((n, p) => n + p.totalPayable, 0);

  async function disburse() {
    if (!window.confirm(`Disburse ${naira(approvedTotal)} to ${approvedUnpaid.length} employee wallet(s) from the client wallet? This cannot be undone.`)) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/payroll/runs/${selectedRun}/disburse`);
      setNotice(`Paid ${data.succeeded} employee(s) — ${naira(data.total)}.${data.failed ? ` ${data.failed} failed: ${data.failures.join('; ')}` : ''}`);
      await loadRuns();
      await viewPayslips(selectedRun);
    } catch (err) {
      setError(err.response?.data?.message || 'Disbursement failed');
    } finally {
      setBusy(false);
    }
  }

  const totals = payslips.reduce(
    (acc, p) => {
      const { housing, transport, other } = splitAllowances(p.breakdown);
      acc.basic += p.basicSalary;
      acc.housing += housing;
      acc.transport += transport;
      acc.other += other;
      acc.overtime += p.overtimePay;
      acc.paye += p.paye;
      acc.pension += p.pensionEmployee;
      acc.nhf += p.nhf;
      acc.net += p.netPay;
      acc.payable += p.totalPayable;
      return acc;
    },
    { basic: 0, housing: 0, transport: 0, other: 0, overtime: 0, paye: 0, pension: 0, nhf: 0, net: 0, payable: 0 }
  );

  const colCount = 14 + (isSuper && paymentsOpen ? 1 : 0);

  return (
    <div className="space-y-5">
      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {notice && <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-3 py-2 rounded-lg">{notice}</div>}

      {canRunPayroll && (
        <div className="card p-4 flex flex-wrap items-end gap-3">
          <div>
            <label className="label">Client</label>
            <select className="input w-56" value={clientId} onChange={(e) => setClientId(e.target.value)}>
              <option value="">Select client…</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div><label className="label">Month</label><input type="number" min={1} max={12} className="input w-24" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
          <div><label className="label">Year</label><input type="number" className="input w-28" value={year} onChange={(e) => setYear(e.target.value)} /></div>
          <button onClick={createRun} className="btn-primary">Create/Open Run</button>
          {clients.length === 0 && <p className="text-xs text-amber-600">No clients assigned to you yet — ask the Super Admin for access.</p>}
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr><th className="text-left px-4 py-3">Period</th><th className="text-left px-4 py-3">Client</th><th className="text-left px-4 py-3">Status</th><th className="text-left px-4 py-3">Actions</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {runs.map((r) => (
              <tr key={r.id} className={selectedRun === r.id ? 'bg-orange-50/50 dark:bg-slate-800/40' : ''}>
                <td className="px-4 py-3">{r.month}/{r.year}</td>
                <td className="px-4 py-3">{r.client?.name || <span className="text-slate-400">Legacy (all clients)</span>}</td>
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
                  <button onClick={() => viewPayslips(r.id)} className="btn-secondary text-xs">View Summary</button>
                  {(canRunPayroll || canApprove) && (
                    <button onClick={() => exportRun(r.id, `${r.client?.name || 'all'}-${r.month}-${r.year}`)} disabled={exporting} className="btn-secondary text-xs">
                      {exporting ? 'Exporting…' : 'Export Excel'}
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {runs.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={4}>No payroll runs yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {selectedRun && (
        <div className="card overflow-x-auto">
          <div className="px-4 pt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-800 dark:text-white">Payroll Summary{run?.client ? ` — ${run.client.name}` : ''} {run ? `(${run.month}/${run.year})` : ''}</h3>
              <p className="text-xs text-slate-400 mb-2">Full breakdown per employee — visible to everyone with payroll access, regardless of approval stage.</p>
            </div>

            {isSuper && paymentsOpen && (
              <div className="flex flex-col items-end gap-2">
                {walletBalance !== null && (
                  <p className={`text-xs ${walletBalance < approvedTotal ? 'text-red-600' : 'text-slate-500'}`}>
                    Client wallet balance: <span className="font-semibold">{naira(walletBalance)}</span>
                    {walletBalance < approvedTotal && ' — not enough for the approved payments'}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 justify-end">
                  <button disabled={busy || checked.size === 0} onClick={() => setApproval(true, [...checked])} className="btn-secondary text-xs">Approve selected ({checked.size})</button>
                  <button disabled={busy || selectable.length === 0} onClick={() => setApproval(true)} className="btn-secondary text-xs">Approve all unpaid</button>
                  <button disabled={busy || checked.size === 0} onClick={() => setApproval(false, [...checked])} className="btn-secondary text-xs">Remove approval</button>
                  <button disabled={busy || approvedUnpaid.length === 0} onClick={disburse} className="btn-primary text-xs">
                    {busy ? 'Working…' : `Disburse approved (${approvedUnpaid.length} · ${naira(approvedTotal)})`}
                  </button>
                </div>
              </div>
            )}
          </div>

          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
              <tr>
                {isSuper && paymentsOpen && (
                  <th className="px-3 py-3"><input type="checkbox" checked={selectable.length > 0 && checked.size === selectable.length} onChange={toggleAll} /></th>
                )}
                <th className="text-left px-3 py-3">Employee</th>
                <th className="text-right px-3 py-3">Days</th>
                <th className="text-right px-3 py-3">Basic</th>
                <th className="text-right px-3 py-3">Housing</th>
                <th className="text-right px-3 py-3">Transport</th>
                <th className="text-right px-3 py-3">Other Allow.</th>
                <th className="text-right px-3 py-3">Overtime</th>
                <th className="text-right px-3 py-3">PAYE</th>
                <th className="text-right px-3 py-3">Pension</th>
                <th className="text-right px-3 py-3">NHF</th>
                <th className="text-right px-3 py-3">Net Pay</th>
                <th className="text-right px-3 py-3">Total Payable</th>
                <th className="text-left px-3 py-3">Payment Approval</th>
                <th className="text-left px-3 py-3">Payment Status</th>
                <th className="text-left px-3 py-3">Payslip</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {payslips.map((p) => {
                const { housing, transport, other } = splitAllowances(p.breakdown);
                return (
                  <tr key={p.id}>
                    {isSuper && paymentsOpen && (
                      <td className="px-3 py-3">
                        {payable(p) && <input type="checkbox" checked={checked.has(p.id)} onChange={() => toggle(p.id)} />}
                      </td>
                    )}
                    <td className="px-3 py-3">{p.employee.firstName} {p.employee.lastName}<span className="block text-[11px] text-slate-400">{p.employee.employeeCode}</span></td>
                    <td className="px-3 py-3 text-right whitespace-nowrap">
                      {p.requiredDays != null ? (
                        <span className={p.prorationFactor < 1 ? 'text-amber-600 font-medium' : ''} title={p.prorationFactor < 1 ? `Prorated to ${(p.prorationFactor * 100).toFixed(1)}%` : 'Full attendance'}>
                          {p.daysPresent}/{p.requiredDays}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-3 py-3 text-right">{p.basicSalary.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{housing.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{transport.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{other.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{p.overtimePay.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">-{p.paye.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">-{p.pensionEmployee.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">-{p.nhf.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right">{p.netPay.toFixed(2)}</td>
                    <td className="px-3 py-3 text-right font-semibold">{p.totalPayable.toFixed(2)}</td>
                    <td className="px-3 py-3">
                      <span className={`badge ${p.paymentApproval === 'APPROVED' ? 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'}`}>
                        {p.paymentApproval === 'APPROVED' ? 'Approved' : 'Pending'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <span className={`badge ${PAY_STATUS_STYLE[p.paymentStatus]}`}>{p.paymentStatus.replace('_', ' ')}</span>
                      {p.paymentMessage && <p className={`text-[11px] mt-1 max-w-[14rem] ${p.paymentStatus === 'FAILED' ? 'text-red-500' : 'text-slate-400'}`}>{p.paymentMessage}</p>}
                    </td>
                    <td className="px-3 py-3">
                      {p.pdfUrl ? (
                        <a href={p.pdfUrl} target="_blank" rel="noreferrer" className="text-xs text-estrada-red hover:underline">Download</a>
                      ) : (
                        <span className="text-xs text-slate-400">On approval</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {payslips.length === 0 && <tr><td className="px-3 py-6 text-slate-400" colSpan={colCount}>No payslips in this run yet — process it first.</td></tr>}
            </tbody>
            {payslips.length > 0 && (
              <tfoot className="bg-slate-50 dark:bg-slate-800/50 font-semibold text-slate-700 dark:text-slate-200">
                <tr>
                  {isSuper && paymentsOpen && <td />}
                  <td className="px-3 py-3">Total</td>
                  <td />
                  <td className="px-3 py-3 text-right">{totals.basic.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{totals.housing.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{totals.transport.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{totals.other.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{totals.overtime.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">-{totals.paye.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">-{totals.pension.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">-{totals.nhf.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{totals.net.toFixed(2)}</td>
                  <td className="px-3 py-3 text-right">{totals.payable.toFixed(2)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}
    </div>
  );
}

function SalaryStructures() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [basicSalary, setBasicSalary] = useState('');
  const [housing, setHousing] = useState('');
  const [transport, setTransport] = useState('');
  const [payeEnabled, setPayeEnabled] = useState(false);
  const [pensionEnabled, setPensionEnabled] = useState(false);
  const [nhfEnabled, setNhfEnabled] = useState(false);
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
    setPayeEnabled(data.structure?.payeEnabled ?? false);
    setPensionEnabled(data.structure?.pensionEnabled ?? false);
    setNhfEnabled(data.structure?.nhfEnabled ?? false);
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
      payeEnabled,
      pensionEnabled,
      nhfEnabled,
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
            <p className="label !mb-2">Statutory Deductions</p>
            <p className="text-xs text-slate-400 mb-3">
              Off by default for every employee — turn on only what actually applies to this person. Rates come from Statutory Settings.
            </p>
            <div className="flex flex-wrap gap-5">
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={payeEnabled} onChange={(e) => setPayeEnabled(e.target.checked)} className="h-4 w-4 accent-estrada-red" />
                Apply PAYE
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={pensionEnabled} onChange={(e) => setPensionEnabled(e.target.checked)} className="h-4 w-4 accent-estrada-red" />
                Apply Pension
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                <input type="checkbox" checked={nhfEnabled} onChange={(e) => setNhfEnabled(e.target.checked)} className="h-4 w-4 accent-estrada-red" />
                Apply NHF
              </label>
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
  const [clients, setClients] = useState([]);
  const [form, setForm] = useState({ name: '', type: 'PENSION_EMPLOYEE', percent: '', clientId: '', effectiveFrom: '' });

  async function load() {
    const { data } = await api.get('/payroll/settings');
    setSettings(data.settings);
  }
  useEffect(() => {
    load();
    api.get('/clients').then((r) => setClients(r.data.clients)).catch(() => {});
  }, []);

  async function create() {
    await api.post('/payroll/settings', {
      name: form.name,
      type: form.type,
      config: { percent: Number(form.percent) / 100 },
      clientId: form.clientId || null,
      effectiveFrom: form.effectiveFrom,
    });
    setForm({ name: '', type: 'PENSION_EMPLOYEE', percent: '', clientId: '', effectiveFrom: '' });
    load();
  }

  async function deactivate(id) {
    if (!confirm('Deactivate this rate? It will stop applying to any employee going forward.')) return;
    await api.patch(`/payroll/settings/${id}`, { isActive: false });
    load();
  }

  const anyExampleRatesActive = settings.some((s) => s.isActive && (s.name.toLowerCase().includes('example') || s.name.toLowerCase().includes('8%')));

  return (
    <div className="space-y-5">
      {anyExampleRatesActive && (
        <div className="card p-4 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            ⚠️ One or more rates below look like leftover example/placeholder values. Confirm the real percentage with your finance/compliance team, then either edit or deactivate anything that isn't accurate before enabling it for any employee.
          </p>
        </div>
      )}

      <div className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-white">Add Statutory Rule (flat %)</h2>
          <p className="text-xs text-slate-400 mt-1">
            For PAYE tax bands (progressive, not flat %), add the base rule here then edit its bracket config via the API. Leave "Client" as Company-wide unless a specific client's contract requires a different rate.
          </p>
        </div>
        <div className="grid sm:grid-cols-5 gap-3">
          <input className="input" placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="PENSION_EMPLOYEE">Pension (Employee)</option>
            <option value="PENSION_EMPLOYER">Pension (Employer)</option>
            <option value="NHF">NHF</option>
            <option value="PAYE">PAYE (flat % only — use API for brackets)</option>
            <option value="CUSTOM">Custom</option>
          </select>
          <input type="number" className="input" placeholder="Percent e.g. 8" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} />
          <select className="input" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })}>
            <option value="">Company-wide</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <input type="date" className="input" value={form.effectiveFrom} onChange={(e) => setForm({ ...form, effectiveFrom: e.target.value })} />
        </div>
        <button onClick={create} className="btn-primary">Add Rule</button>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400">
            <tr>
              <th className="text-left px-4 py-3">Name</th>
              <th className="text-left px-4 py-3">Type</th>
              <th className="text-left px-4 py-3">Applies To</th>
              <th className="text-left px-4 py-3">Effective From</th>
              <th className="text-left px-4 py-3">Active</th>
              <th className="text-left px-4 py-3"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {settings.map((s) => (
              <tr key={s.id}>
                <td className="px-4 py-3">{s.name}</td>
                <td className="px-4 py-3">{s.type}</td>
                <td className="px-4 py-3">{s.client?.name || 'Company-wide'}</td>
                <td className="px-4 py-3">{new Date(s.effectiveFrom).toDateString()}</td>
                <td className="px-4 py-3">{s.isActive ? <span className="text-green-600">Yes</span> : <span className="text-slate-400">No</span>}</td>
                <td className="px-4 py-3">
                  {s.isActive && <button onClick={() => deactivate(s.id)} className="text-xs text-red-600 hover:underline">Deactivate</button>}
                </td>
              </tr>
            ))}
            {settings.length === 0 && <tr><td className="px-4 py-6 text-slate-400" colSpan={6}>No statutory rates configured yet.</td></tr>}
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

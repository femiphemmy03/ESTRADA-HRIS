import { useState } from 'react';
import api, { downloadFile } from '../../lib/api.js';
import { readFileAsBase64, naira } from '../../lib/readFile.js';

// Columns the admin can choose for the template. Employee Code and Name are always included.
const GROUPS = [
  { name: 'Pay', cols: [['monthlyGross', 'Gross Salary (monthly)', true], ['annualGross', 'Annual Gross', false]] },
  {
    name: 'Pay components (leave blank to split gross by the client rates)',
    cols: [['basic', 'Basic'], ['housing', 'Housing'], ['transport', 'Transport'], ['feeding', 'Feeding'], ['bonus13th', '13th Month / Bonus'], ['utility', 'Utility'], ['leave', 'Leave'], ['entertainment', 'Entertainment'], ['furniture', 'Furniture'], ['education', 'Education'], ['domestic', 'Domestic']].map(([k, l]) => [k, l, false]),
  },
  { name: 'Attendance (pre-filled from attendance records)', cols: [['daysInMonth', 'No of Days', true], ['daysWorked', 'No of days worked', true]] },
  { name: 'Deductions (blank = system calculates PAYE / pension)', cols: [['eePension', 'EE pension', true], ['paye', 'PAYE', true], ['leaveDeduction', 'Leave Deduction', false], ['thirteenthDeduction', '13th Month Deduction', false], ['otherDeductions', 'Other Deductions', true]] },
  { name: 'Employer costs', cols: [['groupLife', 'Group Life Insurance', false]] },
];

const STATUS_STYLE = {
  OK: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  WARNING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ERROR: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

export default function PayrollSheetModal({ run, onClose, onImported }) {
  const initial = new Set(GROUPS.flatMap((g) => g.cols.filter((c) => c[2]).map((c) => c[0])));
  const [selected, setSelected] = useState(initial);
  const [format, setFormat] = useState('xlsx');
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [onlyProblems, setOnlyProblems] = useState(false);
  const [done, setDone] = useState(null);

  const label = `${run.client?.name || 'client'}-${run.year}-${String(run.month).padStart(2, '0')}`;

  function toggle(key) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function download() {
    setError('');
    try {
      await downloadFile(`/payroll-sheet/runs/${run.id}/template`, { columns: ['employeeCode', 'employeeName', ...selected].join(','), format }, `payroll-template-${label}.${format}`);
    } catch {
      setError('Could not download the template. Please try again.');
    }
  }

  async function send(mode) {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const contentBase64 = await readFileAsBase64(file);
      const { data } = await api.post(`/payroll-sheet/runs/${run.id}/upload`, { fileName: file.name, contentBase64, mode });
      if (mode === 'commit') {
        setDone(data);
        onImported?.();
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  const rows = result ? (onlyProblems ? result.rows.filter((r) => r.status !== 'OK') : result.rows) : [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="card w-full max-w-5xl p-6 space-y-5 my-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Payroll sheet — {run.client?.name} ({run.month}/{run.year})</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Download a template, fill it, upload it. Every row is matched to the employee by Employee Code, with their attendance and statutory settings.</p>
          </div>
          <button onClick={onClose} className="btn-secondary text-xs">Close</button>
        </div>

        {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

        {done ? (
          <div className="space-y-3">
            <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-3 py-3 rounded-lg">
              Imported {done.imported} payslip(s). The run is now in Review — check the summary, then submit it for approval.
              {done.summary.errors > 0 && ` ${done.summary.errors} row(s) with errors were skipped.`}
            </div>
            <button onClick={onClose} className="btn-primary">Done</button>
          </div>
        ) : (
          <>
            <section className="space-y-3">
              <h3 className="font-semibold text-slate-800 dark:text-white">1. Build your template</h3>
              <div className="grid md:grid-cols-2 gap-3">
                {GROUPS.map((g) => (
                  <div key={g.name} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-2">{g.name}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {g.cols.map(([key, text]) => (
                        <label key={key} className="flex items-center gap-1.5 text-sm text-slate-700 dark:text-slate-200 cursor-pointer">
                          <input type="checkbox" checked={selected.has(key)} onChange={() => toggle(key)} /> {text}
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <select className="input w-44" value={format} onChange={(e) => setFormat(e.target.value)}>
                  <option value="xlsx">Excel (.xlsx) + Rates sheet</option>
                  <option value="csv">CSV (.csv)</option>
                </select>
                <button onClick={download} className="btn-primary">Download template</button>
                <p className="text-xs text-slate-400">Pre-filled with this client's active employees, their salary structure and attendance days.</p>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-semibold text-slate-800 dark:text-white">2. Upload the filled sheet</h3>
              <div className="flex flex-wrap items-center gap-3">
                <input type="file" accept=".xlsx,.csv" onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }} className="text-sm" />
                <button disabled={!file || busy} onClick={() => send('preview')} className="btn-secondary">{busy ? 'Checking…' : 'Check file'}</button>
              </div>
              <p className="text-xs text-slate-400">Nothing is saved until you press Import. Calculated columns in your file are ignored — the system recalculates everything.</p>
            </section>

            {result && (
              <section className="space-y-3">
                <h3 className="font-semibold text-slate-800 dark:text-white">3. Review</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  <Box label="Rows" value={result.summary.rows} />
                  <Box label="Ready" value={result.summary.ok + result.summary.warnings} tone="green" />
                  <Box label="With errors (skipped)" value={result.summary.errors} tone={result.summary.errors ? 'red' : undefined} />
                  <Box label="Employees missing from sheet" value={result.summary.missingFromSheet} tone={result.summary.missingFromSheet ? 'amber' : undefined} />
                  <Box label="Gross (payable)" value={naira(result.summary.totals.payableGross)} />
                  <Box label="PAYE" value={naira(result.summary.totals.paye)} />
                  <Box label="Employee pension" value={naira(result.summary.totals.eePension)} />
                  <Box label="Net salary" value={naira(result.summary.totals.netSalary)} />
                </div>
                {result.summary.ratesFromFile && <p className="text-xs text-slate-500">The Rates sheet in your file will be saved for this client when you import.</p>}

                <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={onlyProblems} onChange={(e) => setOnlyProblems(e.target.checked)} /> Show only rows with errors or warnings
                </label>

                <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg max-h-96">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-left sticky top-0">
                      <tr>
                        <th className="px-3 py-2">Row</th><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2 text-right">Days</th><th className="px-3 py-2 text-right">Payable gross</th><th className="px-3 py-2 text-right">PAYE</th>
                        <th className="px-3 py-2 text-right">EE pension</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {rows.map((r) => (
                        <tr key={r.rowNumber} className="align-top">
                          <td className="px-3 py-2">{r.rowNumber}</td>
                          <td className="px-3 py-2">{r.name || '—'}<span className="block text-[11px] text-slate-400">{r.code}</span></td>
                          <td className="px-3 py-2"><span className={`badge ${STATUS_STYLE[r.status]}`}>{r.status}</span></td>
                          <td className="px-3 py-2 text-right whitespace-nowrap">{r.summary?.daysInMonth != null ? `${r.summary.daysWorked ?? '—'}/${r.summary.daysInMonth}` : '—'}</td>
                          <td className="px-3 py-2 text-right">{r.summary ? r.summary.payableGross.toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right">{r.summary ? r.summary.paye.toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right">{r.summary ? r.summary.eePension.toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-right font-medium">{r.summary ? r.summary.netSalary.toLocaleString() : '—'}</td>
                          <td className="px-3 py-2 text-xs max-w-xs">
                            {r.errors.map((m, i) => <p key={`e${i}`} className="text-red-600">{m}</p>)}
                            {r.warnings.map((m, i) => <p key={`w${i}`} className="text-amber-600">{m}</p>)}
                          </td>
                        </tr>
                      ))}
                      {rows.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-slate-400">No rows to show.</td></tr>}
                    </tbody>
                  </table>
                </div>

                {result.missing.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-amber-700 dark:text-amber-300">{result.missing.length} active employee(s) have no row in this sheet and will get no payslip</summary>
                    <p className="text-xs text-slate-500 mt-2">{result.missing.map((m) => `${m.name} (${m.code})`).join(', ')}</p>
                  </details>
                )}

                <div className="flex gap-2">
                  <button disabled={busy || result.summary.ok + result.summary.warnings === 0} onClick={() => send('commit')} className="btn-primary">
                    {busy ? 'Importing…' : `Import ${result.summary.ok + result.summary.warnings} payslip(s)`}
                  </button>
                  <button onClick={onClose} className="btn-secondary">Cancel</button>
                </div>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Box({ label, value, tone }) {
  const color = tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-600' : tone === 'amber' ? 'text-amber-600' : 'text-slate-900 dark:text-white';
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

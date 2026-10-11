import { useEffect, useState } from 'react';
import api, { downloadFile } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { readFileAsBase64, naira } from '../../lib/readFile.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const STATUS = {
  MATCHED_OK: ['Paid · valid number', 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300'],
  MATCHED_NO_ID: ['Paid · no number on record', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'],
  ID_MISMATCH: ['Paid · number mismatch', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'],
  ID_INVALID: ['Paid · invalid number', 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'],
  UNMATCHED: ['Not matched', 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'],
};

/**
 * PAYE and Pension tabs share this component (type = 'PAYE' | 'PENSION'):
 *   - how many employees have a usable PAYE number / RSA PIN (and a quick way to fix the ones that don't)
 *   - month-by-month expected vs remitted, with what is still outstanding
 *   - upload the schedule that was actually paid, see who was paid with a correct number, who without, and who wasn't paid
 *   - exports
 */
export default function StatutoryTab({ type }) {
  const { user } = useAuth();
  const isPaye = type === 'PAYE';
  const key = isPaye ? 'paye' : 'pension';
  const idLabel = isPaye ? 'PAYE number' : 'RSA PIN';

  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [overview, setOverview] = useState(null);
  const [employees, setEmployees] = useState([]);
  const [onlyMissing, setOnlyMissing] = useState(true);
  const [schedules, setSchedules] = useState([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    api.get('/clients').then((r) => {
      setClients(r.data.clients);
      if (r.data.clients.length === 1) setClientId(r.data.clients[0].id);
    }).catch(() => {});
  }, []);

  async function load() {
    const params = { year, ...(clientId ? { clientId } : {}) };
    try {
      const [o, e, s] = await Promise.all([
        api.get('/statutory/overview', { params }),
        api.get('/statutory/employees', { params: { type, ...(clientId ? { clientId } : {}) } }),
        api.get('/statutory/remittances', { params: { type, year, ...(clientId ? { clientId } : {}) } }),
      ]);
      setOverview(o.data);
      setEmployees(e.data.employees);
      setSchedules(s.data.remittances);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || 'Could not load this tab.');
    }
  }
  useEffect(() => { load(); }, [clientId, year, type]); // eslint-disable-line

  const exportReport = (format) =>
    downloadFile('/statutory/export', { report: key, year, format, ...(clientId ? { clientId } : {}) }, `${key}-report-${year}.${format}`).catch(() => setError('Export failed.'));

  const cov = overview?.idCoverage;
  const withId = isPaye ? cov?.withPayeNumber : cov?.withRsaPin;
  const withoutId = isPaye ? cov?.withoutPayeNumber : cov?.withoutRsaPin;
  const list = onlyMissing ? employees.filter((e) => !e.valid) : employees;

  return (
    <div className="space-y-6">
      <div className="card p-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Client</label>
          <select className="input w-56" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            {user?.role === 'SUPER_ADMIN' || clients.length > 1 ? <option value="">All {user?.role === 'SUPER_ADMIN' ? 'clients' : 'my clients'}</option> : null}
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Year</label>
          <input type="number" className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} />
        </div>
        <div className="flex gap-2 ml-auto">
          <button onClick={() => exportReport('xlsx')} className="btn-secondary text-xs">Export {type === 'PAYE' ? 'PAYE' : 'Pension'} (Excel)</button>
          <button onClick={() => exportReport('csv')} className="btn-secondary text-xs">CSV</button>
        </div>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {notice && <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-3 py-2 rounded-lg">{notice}</div>}

      {overview && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Tile label={`Expected (${year})`} value={naira(overview.totals.year[key].expected)} />
            <Tile label={`Remitted (${year})`} value={naira(overview.totals.year[key].remitted)} />
            <Tile label="Outstanding (this year)" value={naira(overview.totals.year[key].outstanding)} accent={overview.totals.year[key].outstanding > 0} />
            <Tile label="Outstanding since inception" value={naira(overview.totals.inception[key].outstanding)} accent={overview.totals.inception[key].outstanding > 0} />
          </div>
          {overview.projection && (
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Projected {type === 'PAYE' ? 'PAYE' : 'pension'} for {MONTHS[overview.projection.month - 1]} {overview.projection.year}:{' '}
              <b>{naira(overview.projection[key])}</b> <span className="text-slate-400">(average of the last {overview.projection.basedOnMonths} month(s) of payroll)</span>
            </p>
          )}

          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Month</th>
                  <th className="px-3 py-2 text-right">Expected</th>
                  <th className="px-3 py-2 text-right">Remitted</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-right">Paid with valid {idLabel}</th>
                  <th className="px-3 py-2 text-right">Paid without</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {overview.months.map((m) => (
                  <tr key={m.month}>
                    <td className="px-3 py-2">{MONTHS[m.month - 1]}</td>
                    <td className="px-3 py-2 text-right">{naira(m[key].expected)}</td>
                    <td className="px-3 py-2 text-right">{naira(m[key].remitted)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${m[key].outstanding > 0 ? 'text-estrada-red' : ''}`}>{naira(m[key].outstanding)}</td>
                    <td className="px-3 py-2 text-right">{naira(m[key].remittedWithId)}</td>
                    <td className="px-3 py-2 text-right">{naira(m[key].remittedWithoutId)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <ScheduleUpload type={type} clients={clients} clientId={clientId} year={year} onSaved={(msg) => { setNotice(msg); load(); }} setError={setError} />

      {schedules.length > 0 && (
        <div className="card overflow-x-auto">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800"><h3 className="font-semibold text-slate-800 dark:text-white">Uploaded {type === 'PAYE' ? 'PAYE' : 'pension'} schedules ({year})</h3></div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-left">
              <tr><th className="px-3 py-2">Period</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">File</th><th className="px-3 py-2 text-right">Lines</th><th className="px-3 py-2 text-right">Matched</th><th className="px-3 py-2 text-right">Total</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {schedules.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2">{MONTHS[s.month - 1]} {s.year}</td>
                  <td className="px-3 py-2">{s.client?.name}</td>
                  <td className="px-3 py-2 text-xs">{s.fileName}</td>
                  <td className="px-3 py-2 text-right">{s.rowCount}</td>
                  <td className="px-3 py-2 text-right">{s.matchedCount}</td>
                  <td className="px-3 py-2 text-right font-medium">{naira(s.totalAmount)}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-xs text-red-600" onClick={async () => {
                      if (!window.confirm('Delete this uploaded schedule? Its amounts will no longer count as remitted.')) return;
                      try { await api.delete(`/statutory/remittances/${s.id}`); load(); } catch (e) { setError(e.response?.data?.message || 'Could not delete.'); }
                    }}>Delete</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card overflow-x-auto">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-white">{idLabel}s on employee records</h3>
            {cov && <p className="text-xs text-slate-500 dark:text-slate-400">{withId} of {cov.employees} active employees have a usable {idLabel}; <span className={withoutId ? 'text-amber-600' : ''}>{withoutId} do not</span>.</p>}
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
            <input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> Show only missing / invalid
          </label>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-left">
            <tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2">Client</th><th className="px-3 py-2">{idLabel}</th>{!isPaye && <th className="px-3 py-2">PFA</th>}<th className="px-3 py-2" /></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {list.slice(0, 300).map((e) => (
              <IdRow key={e.id} emp={e} isPaye={isPaye} onSaved={() => { setNotice(`Saved details for ${e.name}.`); load(); }} setError={setError} />
            ))}
            {list.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">{onlyMissing ? `Everyone here has a valid ${idLabel}.` : 'No employees.'}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function IdRow({ emp, isPaye, onSaved, setError }) {
  const [id, setId] = useState(isPaye ? emp.payeNumber || '' : emp.pensionRSA || '');
  const [pfa, setPfa] = useState(emp.pensionAdmin || '');
  const [busy, setBusy] = useState(false);
  const current = isPaye ? emp.payeNumber || '' : emp.pensionRSA || '';
  const dirty = id.trim() !== current || (!isPaye && pfa.trim() !== (emp.pensionAdmin || ''));

  async function save() {
    setBusy(true);
    try {
      await api.patch(`/statutory/employees/${emp.id}/ids`, isPaye ? { payeNumber: id } : { pensionRSA: id, pensionAdmin: pfa });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <tr>
      <td className="px-3 py-2">{emp.name}<span className="block text-[11px] text-slate-400">{emp.employeeCode}</span></td>
      <td className="px-3 py-2 text-xs">{emp.client || '—'}</td>
      <td className="px-3 py-2">
        <input className={`input !py-1 w-52 ${emp.valid ? '' : 'border-amber-400'}`} value={id} onChange={(e) => setId(e.target.value)} placeholder={isPaye ? 'PAYE / tax ID' : 'PEN123456789012'} />
      </td>
      {!isPaye && <td className="px-3 py-2"><input className="input !py-1 w-44" value={pfa} onChange={(e) => setPfa(e.target.value)} placeholder="PFA name" /></td>}
      <td className="px-3 py-2 text-right">{dirty && <button disabled={busy} onClick={save} className="btn-secondary text-xs">{busy ? 'Saving…' : 'Save'}</button>}</td>
    </tr>
  );
}

function ScheduleUpload({ type, clients, clientId, year, onSaved, setError }) {
  const [month, setMonth] = useState(new Date().getMonth() + 1);
  const [yr, setYr] = useState(year);
  const [file, setFile] = useState(null);
  const [result, setResult] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [busy, setBusy] = useState(false);
  const target = clientId || (clients.length === 1 ? clients[0].id : '');

  useEffect(() => setYr(year), [year]);

  async function send(mode) {
    if (!file) return;
    if (!target) { setError('Choose a client above before uploading a schedule.'); return; }
    setBusy(true);
    setError('');
    try {
      const contentBase64 = await readFileAsBase64(file);
      const { data } = await api.post('/statutory/remittances', { type, clientId: target, month: Number(month), year: Number(yr), fileName: file.name, contentBase64, mode });
      if (mode === 'commit') {
        setResult(null);
        setFile(null);
        onSaved(`${type === 'PAYE' ? 'PAYE' : 'Pension'} schedule saved: ${data.lines.length} line(s).`);
      } else {
        setResult(data);
      }
    } catch (err) {
      setError(err.response?.data?.message || err.message || 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  const lines = result ? result.lines.filter((l) => filter === 'ALL' || (filter === 'ISSUES' ? l.status !== 'MATCHED_OK' || l.amountMismatch : l.status === filter)) : [];
  const sm = result?.summary;

  return (
    <div className="card p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-slate-800 dark:text-white">Upload the {type === 'PAYE' ? 'PAYE' : 'pension'} schedule you paid</h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          The system reads your sheet (.xlsx or .csv), matches each line to an employee (by employee code, then {type === 'PAYE' ? 'PAYE number' : 'RSA PIN'}, then name),
          and shows who was paid with a correct number, who without, and who in this month's payroll was not paid at all.
        </p>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <div><label className="label">Month</label>
          <select className="input w-28" value={month} onChange={(e) => setMonth(e.target.value)}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        </div>
        <div><label className="label">Year</label><input type="number" className="input w-24" value={yr} onChange={(e) => setYr(e.target.value)} /></div>
        <input type="file" accept=".xlsx,.csv" className="text-sm" onChange={(e) => { setFile(e.target.files?.[0] || null); setResult(null); }} />
        <button disabled={!file || busy} onClick={() => send('preview')} className="btn-secondary">{busy ? 'Reading…' : 'Check file'}</button>
      </div>

      {sm && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile label="Schedule total" value={naira(sm.total)} />
            <Tile label="Paid · valid number" value={`${sm.withValidId.count} · ${naira(sm.withValidId.amount)}`} />
            <Tile label="Paid · number missing / wrong" value={`${sm.withoutValidId.count} · ${naira(sm.withoutValidId.amount)}`} accent={sm.withoutValidId.count > 0} />
            <Tile label="Not matched to an employee" value={`${sm.unmatched.count} · ${naira(sm.unmatched.amount)}`} accent={sm.unmatched.count > 0} />
            <Tile label="Expected from payroll" value={naira(sm.expectedTotal)} />
            <Tile label="In payroll but NOT in schedule" value={`${sm.notRemittedCount} · ${naira(sm.notRemittedAmount)}`} accent={sm.notRemittedCount > 0} />
            <Tile label="Amount differs from payroll" value={sm.amountMismatches} accent={sm.amountMismatches > 0} />
          </div>

          <select className="input w-64" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="ALL">All lines</option>
            <option value="ISSUES">Only lines with issues</option>
            {Object.entries(STATUS).map(([k, [text]]) => <option key={k} value={k}>{text}</option>)}
          </select>

          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg max-h-96">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-left sticky top-0">
                <tr><th className="px-3 py-2">Row</th><th className="px-3 py-2">In schedule</th><th className="px-3 py-2">Matched employee</th><th className="px-3 py-2 text-right">Amount</th><th className="px-3 py-2 text-right">Payroll</th><th className="px-3 py-2">Result</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {lines.map((l) => (
                  <tr key={l.rowNumber} className="align-top">
                    <td className="px-3 py-2">{l.rowNumber}</td>
                    <td className="px-3 py-2">{l.name}<span className="block text-[11px] text-slate-400">{[l.code, l.idInFile].filter(Boolean).join(' · ')}</span></td>
                    <td className="px-3 py-2">{l.employeeName ? <>{l.employeeName}<span className="block text-[11px] text-slate-400">{l.employeeCode} · by {l.matchedBy}</span></> : '—'}</td>
                    <td className="px-3 py-2 text-right">{l.amount.toLocaleString()}</td>
                    <td className={`px-3 py-2 text-right ${l.amountMismatch ? 'text-amber-600 font-medium' : ''}`}>{l.expected != null ? l.expected.toLocaleString() : '—'}</td>
                    <td className="px-3 py-2"><span className={`badge ${STATUS[l.status][1]}`}>{STATUS[l.status][0]}</span>{l.note && <p className="text-[11px] text-slate-500 mt-1 max-w-xs">{l.note}</p>}</td>
                  </tr>
                ))}
                {lines.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-400">No lines to show.</td></tr>}
              </tbody>
            </table>
          </div>

          {result.notRemitted.length > 0 && (
            <details className="text-sm" open>
              <summary className="cursor-pointer text-red-600 font-medium">{result.notRemitted.length} employee(s) in this month's payroll are not in the schedule (not paid)</summary>
              <div className="overflow-x-auto mt-2 border border-slate-200 dark:border-slate-800 rounded-lg max-h-64">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-left"><tr><th className="px-3 py-2">Employee</th><th className="px-3 py-2 text-right">Expected</th><th className="px-3 py-2">{type === 'PAYE' ? 'PAYE number' : 'RSA PIN'}</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {result.notRemitted.map((n) => (
                      <tr key={n.employeeCode}><td className="px-3 py-2">{n.name} <span className="text-[11px] text-slate-400">{n.employeeCode}</span></td><td className="px-3 py-2 text-right">{n.expected.toLocaleString()}</td><td className="px-3 py-2 text-xs">{n.hasValidId ? 'Valid' : 'Missing / invalid'}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div className="flex gap-2">
            <button disabled={busy || sm.rows === 0} onClick={() => send('commit')} className="btn-primary">{busy ? 'Saving…' : `Save ${sm.rows} line(s) to history`}</button>
            <button onClick={() => setResult(null)} className="btn-secondary">Discard</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, accent }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${accent ? 'text-estrada-red' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
}

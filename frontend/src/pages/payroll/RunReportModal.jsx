import { useEffect, useState } from 'react';
import api, { downloadFile } from '../../lib/api.js';
import { naira } from '../../lib/readFile.js';

/** Key highlights for one payroll run — totals, employer costs / invoice to client, attendance, payment progress. */
export default function RunReportModal({ run, onClose }) {
  const [summary, setSummary] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/payroll-sheet/runs/${run.id}/summary`).then((r) => setSummary(r.data.summary)).catch((e) => setError(e.response?.data?.message || 'Could not load the report.'));
  }, [run.id]);

  const label = `${run.client?.name || 'all'}-${run.year}-${String(run.month).padStart(2, '0')}`;
  const exportIt = (format) => downloadFile(`/payroll-sheet/runs/${run.id}/export`, { format }, `payroll-report-${label}.${format}`).catch(() => setError('Export failed. Please try again.'));

  const s = summary;
  return (
    <div className="fixed inset-0 bg-black/40 flex items-start justify-center z-50 p-4 overflow-y-auto">
      <div className="card w-full max-w-4xl p-6 space-y-5 my-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">Payroll report — {run.client?.name} ({run.month}/{run.year})</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">Run status: {run.status.replace(/_/g, ' ')}{s?.run.sourceFileName ? ` · from sheet "${s.run.sourceFileName}"` : ''}</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => exportIt('xlsx')} className="btn-secondary text-xs">Export Excel</button>
            <button onClick={() => exportIt('csv')} className="btn-secondary text-xs">Export CSV</button>
            <button onClick={onClose} className="btn-secondary text-xs">Close</button>
          </div>
        </div>

        {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
        {!s && !error && <p className="text-sm text-slate-400">Loading…</p>}

        {s && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Tile label="Employees" value={s.headcount} />
              <Tile label="Gross pay" value={naira(s.totals.grossPay)} />
              <Tile label="Total deductions" value={naira(s.totals.totalDeductions)} />
              <Tile label="Net pay" value={naira(s.totals.net)} strong />
              <Tile label="PAYE" value={naira(s.totals.paye)} />
              <Tile label="Employee pension" value={naira(s.totals.pensionEmployee)} />
              <Tile label="Average net pay" value={naira(s.highlights.averageNet)} />
              <Tile label="Prorated for attendance" value={s.attendance.prorated} />
            </div>

            {s.previous && (
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Compared with {s.previous.month}/{s.previous.year}: net pay {naira(s.previous.net)} → {naira(s.totals.net)}
                {s.previous.netChangePct != null && (
                  <span className={s.previous.netChangePct > 0 ? 'text-amber-600 font-medium' : 'text-green-600 font-medium'}> ({s.previous.netChangePct > 0 ? '+' : ''}{s.previous.netChangePct}%)</span>
                )}, headcount {s.previous.headcount} → {s.headcount}.
              </p>
            )}

            {s.employer ? (
              <div>
                <h3 className="font-semibold text-slate-800 dark:text-white mb-2">Employer costs & amount payable by the client</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <Tile label="Employer pension" value={naira(s.employer.pensionEmployer)} />
                  <Tile label="ITF" value={naira(s.employer.itf)} />
                  <Tile label="NSITF" value={naira(s.employer.nsitf)} />
                  <Tile label="Group life" value={naira(s.employer.groupLife)} />
                  <Tile label="Total employee emolument" value={naira(s.employer.totalEmolument)} />
                  <Tile label="Management fees" value={naira(s.employer.managementFees)} />
                  <Tile label="VAT" value={naira(s.employer.vat)} />
                  <Tile label="Payable to service provider" value={naira(s.employer.payableToProvider)} strong />
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Employer costs, management fees and VAT appear for runs created from an uploaded payroll sheet.</p>
            )}

            <div>
              <h3 className="font-semibold text-slate-800 dark:text-white mb-2">Payment progress</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Tile label="Approved for payment" value={s.payments.approved} />
                <Tile label="Paid" value={`${s.payments.paid} · ${naira(s.payments.paidTotal)}`} />
                <Tile label="Not yet paid" value={`${s.payments.unpaid} · ${naira(s.payments.outstandingTotal)}`} />
                <Tile label="Failed" value={s.payments.failed} />
              </div>
            </div>

            <div className="text-sm text-slate-600 dark:text-slate-300 grid sm:grid-cols-2 gap-2">
              {s.highlights.highestNet && <p>Highest net pay: <b>{s.highlights.highestNet.name}</b> ({naira(s.highlights.highestNet.amount)})</p>}
              {s.highlights.lowestNet && <p>Lowest net pay: <b>{s.highlights.lowestNet.name}</b> ({naira(s.highlights.lowestNet.amount)})</p>}
              {s.attendance.averageDaysPresent != null && <p>Average days present: <b>{s.attendance.averageDaysPresent}</b></p>}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, strong }) {
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 px-3 py-2">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`font-bold ${strong ? 'text-lg text-estrada-red' : 'text-base text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
}

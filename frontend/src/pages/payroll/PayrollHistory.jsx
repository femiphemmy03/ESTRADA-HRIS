import { useEffect, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api, { downloadFile } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { naira } from '../../lib/readFile.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** History & reporting: payroll, PAYE and pension totals per month and since inception, with outstanding amounts. */
export default function PayrollHistory() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [clientId, setClientId] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/clients').then((r) => {
      setClients(r.data.clients);
      if (r.data.clients.length === 1) setClientId(r.data.clients[0].id);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    api.get('/statutory/overview', { params: { year, ...(clientId ? { clientId } : {}) } })
      .then((r) => { setData(r.data); setError(''); })
      .catch((e) => setError(e.response?.data?.message || 'Could not load history.'));
  }, [clientId, year]);

  const exportIt = (report, format) =>
    downloadFile('/statutory/export', { report, year, format, ...(clientId ? { clientId } : {}) }, `${report}-report-${year}.${format}`).catch(() => setError('Export failed.'));

  const chart = data?.months.map((m) => ({
    name: MONTHS[m.month - 1],
    'PAYE expected': m.paye.expected, 'PAYE remitted': m.paye.remitted,
    'Pension expected': m.pension.expected, 'Pension remitted': m.pension.remitted,
  }));
  const inc = data?.totals.inception;
  const yr = data?.totals.year;

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
        <div><label className="label">Year</label><input type="number" className="input w-28" value={year} onChange={(e) => setYear(Number(e.target.value))} /></div>
        <div className="flex flex-wrap gap-2 ml-auto">
          {[['payroll', 'Payroll'], ['paye', 'PAYE'], ['pension', 'Pension']].map(([k, l]) => (
            <span key={k} className="flex">
              <button onClick={() => exportIt(k, 'xlsx')} className="btn-secondary text-xs rounded-r-none">{l} Excel</button>
              <button onClick={() => exportIt(k, 'csv')} className="btn-secondary text-xs rounded-l-none border-l-0">CSV</button>
            </span>
          ))}
        </div>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

      {data && (
        <>
          <div>
            <h3 className="font-semibold text-slate-800 dark:text-white mb-2">Since inception</h3>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <Tile label="Payroll processed (net)" value={naira(inc.net)} />
              <Tile label="Salaries paid out" value={naira(inc.paid)} />
              <Tile label="PAYE · remitted / expected" value={`${naira(inc.paye.remitted)} / ${naira(inc.paye.expected)}`} />
              <Tile label="Pension · remitted / expected" value={`${naira(inc.pension.remitted)} / ${naira(inc.pension.expected)}`} />
              <Tile label="PAYE outstanding" value={naira(inc.paye.outstanding)} accent={inc.paye.outstanding > 0} />
              <Tile label="Pension outstanding" value={naira(inc.pension.outstanding)} accent={inc.pension.outstanding > 0} />
              <Tile label="Employees with PAYE number" value={`${data.idCoverage.withPayeNumber} / ${data.idCoverage.employees}`} accent={data.idCoverage.withoutPayeNumber > 0} />
              <Tile label="Employees with RSA PIN" value={`${data.idCoverage.withRsaPin} / ${data.idCoverage.employees}`} accent={data.idCoverage.withoutRsaPin > 0} />
            </div>
            {data.projection && (
              <p className="text-sm text-slate-600 dark:text-slate-300 mt-3">
                Projected for {MONTHS[data.projection.month - 1]} {data.projection.year}: PAYE <b>{naira(data.projection.paye)}</b> · pension <b>{naira(data.projection.pension)}</b>
                <span className="text-slate-400"> (average of the last {data.projection.basedOnMonths} month(s))</span>
              </p>
            )}
          </div>

          <div className="card p-4">
            <h3 className="font-semibold text-slate-800 dark:text-white mb-3">{year}: expected vs remitted, month on month</h3>
            <div style={{ width: '100%', height: 280 }}>
              <ResponsiveContainer>
                <BarChart data={chart}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="name" />
                  <YAxis tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}m` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : v)} />
                  <Tooltip formatter={(v) => naira(v)} />
                  <Legend />
                  <Bar dataKey="PAYE expected" fill="#f97316" />
                  <Bar dataKey="PAYE remitted" fill="#16a34a" />
                  <Bar dataKey="Pension expected" fill="#6366f1" />
                  <Bar dataKey="Pension remitted" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="card overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800"><h3 className="font-semibold text-slate-800 dark:text-white">Monthly summary — {year}</h3></div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-800/50 text-slate-500 text-left">
                <tr>
                  <th className="px-3 py-2">Month</th><th className="px-3 py-2 text-right">Employees</th><th className="px-3 py-2 text-right">Gross</th><th className="px-3 py-2 text-right">Net</th><th className="px-3 py-2 text-right">Paid out</th>
                  <th className="px-3 py-2 text-right">PAYE expected</th><th className="px-3 py-2 text-right">PAYE remitted</th><th className="px-3 py-2 text-right">PAYE outstanding</th>
                  <th className="px-3 py-2 text-right">Pension expected</th><th className="px-3 py-2 text-right">Pension remitted</th><th className="px-3 py-2 text-right">Pension outstanding</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.months.map((m) => (
                  <tr key={m.month} className={m.headcount === 0 ? 'text-slate-400' : ''}>
                    <td className="px-3 py-2">{MONTHS[m.month - 1]}</td>
                    <td className="px-3 py-2 text-right">{m.headcount || '—'}</td>
                    <td className="px-3 py-2 text-right">{naira(m.gross)}</td>
                    <td className="px-3 py-2 text-right">{naira(m.net)}</td>
                    <td className="px-3 py-2 text-right">{naira(m.paid)}</td>
                    <td className="px-3 py-2 text-right">{naira(m.paye.expected)}</td>
                    <td className="px-3 py-2 text-right">{naira(m.paye.remitted)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${m.paye.outstanding > 0 ? 'text-estrada-red' : ''}`}>{naira(m.paye.outstanding)}</td>
                    <td className="px-3 py-2 text-right">{naira(m.pension.expected)}</td>
                    <td className="px-3 py-2 text-right">{naira(m.pension.remitted)}</td>
                    <td className={`px-3 py-2 text-right font-medium ${m.pension.outstanding > 0 ? 'text-estrada-red' : ''}`}>{naira(m.pension.outstanding)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-slate-50 dark:bg-slate-800/50 font-semibold text-slate-700 dark:text-slate-200">
                <tr>
                  <td className="px-3 py-2">Total {year}</td><td />
                  <td className="px-3 py-2 text-right">{naira(yr.gross)}</td><td className="px-3 py-2 text-right">{naira(yr.net)}</td><td className="px-3 py-2 text-right">{naira(yr.paid)}</td>
                  <td className="px-3 py-2 text-right">{naira(yr.paye.expected)}</td><td className="px-3 py-2 text-right">{naira(yr.paye.remitted)}</td><td className="px-3 py-2 text-right">{naira(yr.paye.outstanding)}</td>
                  <td className="px-3 py-2 text-right">{naira(yr.pension.expected)}</td><td className="px-3 py-2 text-right">{naira(yr.pension.remitted)}</td><td className="px-3 py-2 text-right">{naira(yr.pension.outstanding)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Tile({ label, value, accent }) {
  return (
    <div className="card px-4 py-3">
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`text-base font-bold mt-0.5 ${accent ? 'text-estrada-red' : 'text-slate-900 dark:text-white'}`}>{value}</p>
    </div>
  );
}

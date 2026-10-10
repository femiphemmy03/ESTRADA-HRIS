import { useEffect, useState } from 'react';
import api from '../../lib/api.js';

const when = (d) => new Date(d).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' });
const MODULES = [
  ['ALL', 'All money activity'],
  ['PAYROLL', 'Payroll'],
  ['WALLET', 'Wallets & funding'],
  ['ACCESS', 'Client access'],
];

/**
 * Super Admin only — a filterable trail of everything done in payroll, wallets and client access:
 * who changed a salary structure, uploaded/changed statutory settings, ran/approved payroll, funded a wallet, etc.
 */
export default function PayrollActivity() {
  const [filters, setFilters] = useState({ module: 'ALL', clientId: '', q: '', from: '', to: '' });
  const [clients, setClients] = useState([]);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ logs: [], total: 0, pageSize: 50 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    api.get('/clients').then((r) => setClients(r.data.clients)).catch(() => {});
  }, []);

  async function load(p = page, f = filters) {
    setLoading(true);
    setError('');
    try {
      const params = { page: p, module: f.module };
      if (f.clientId) params.clientId = f.clientId;
      if (f.q) params.q = f.q;
      if (f.from) params.from = f.from;
      if (f.to) params.to = f.to;
      const { data } = await api.get('/payroll/activity', { params });
      setResult(data);
    } catch (e) {
      setError(e.response?.data?.message || 'Could not load activity.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(page, filters); }, [page]); // eslint-disable-line

  function apply(e) {
    e.preventDefault();
    setPage(1);
    load(1, filters);
  }

  const pages = Math.max(1, Math.ceil(result.total / result.pageSize));
  const set = (k) => (e) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Payroll Activity</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Every payroll, wallet and access change, with who did it and when.</p>
      </div>

      <form onSubmit={apply} className="card p-4 grid sm:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
        <div>
          <label className="label">Area</label>
          <select className="input" value={filters.module} onChange={set('module')}>
            {MODULES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Client</label>
          <select className="input" value={filters.clientId} onChange={set('clientId')}>
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </div>
        <div className="lg:col-span-2">
          <label className="label">Search</label>
          <input className="input" placeholder="e.g. salary structure, PAYE, funded…" value={filters.q} onChange={set('q')} />
        </div>
        <div>
          <label className="label">From</label>
          <input type="date" className="input" value={filters.from} onChange={set('from')} />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" className="input" value={filters.to} onChange={set('to')} />
        </div>
        <div className="lg:col-span-6 flex gap-2">
          <button type="submit" className="btn-primary">Apply filters</button>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              const cleared = { module: 'ALL', clientId: '', q: '', from: '', to: '' };
              setFilters(cleared);
              setPage(1);
              load(1, cleared);
            }}
          >
            Reset
          </button>
        </div>
      </form>

      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2">When</th>
                <th className="px-4 py-2">Who</th>
                <th className="px-4 py-2">Action</th>
                <th className="px-4 py-2">Details</th>
                <th className="px-4 py-2">Client</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {result.logs.map((l) => (
                <tr key={l.id} className="align-top">
                  <td className="px-4 py-2 whitespace-nowrap">{when(l.createdAt)}</td>
                  <td className="px-4 py-2">
                    <p className="text-slate-800 dark:text-slate-100">{l.actor?.email || 'System'}</p>
                    <p className="text-[11px] text-slate-400">{l.actor?.role?.replace(/_/g, ' ')}</p>
                  </td>
                  <td className="px-4 py-2"><span className="badge bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300">{l.action.replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-2 max-w-md">
                    <p className="text-slate-700 dark:text-slate-200">{l.description}</p>
                    {l.metadata && (
                      <button className="text-xs text-estrada-red mt-1" onClick={() => setOpenId(openId === l.id ? null : l.id)}>
                        {openId === l.id ? 'Hide details' : 'View details'}
                      </button>
                    )}
                    {openId === l.id && (
                      <pre className="mt-2 text-[11px] bg-slate-50 dark:bg-slate-800 rounded-lg p-2 overflow-x-auto max-h-60">{JSON.stringify(l.metadata, null, 2)}</pre>
                    )}
                  </td>
                  <td className="px-4 py-2">{l.clientName || (l.employee ? '' : '—')}{l.employee && <span className="block text-[11px] text-slate-400">{l.employee.firstName} {l.employee.lastName}</span>}</td>
                </tr>
              ))}
              {!loading && result.logs.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">No activity matches these filters.</td></tr>
              )}
              {loading && (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Loading…</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 py-3 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-sm text-slate-500">
          <span>{result.total} record(s)</span>
          <div className="flex items-center gap-2">
            <button className="btn-secondary text-xs" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</button>
            <span>Page {page} of {pages}</span>
            <button className="btn-secondary text-xs" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</button>
          </div>
        </div>
      </div>
    </div>
  );
}

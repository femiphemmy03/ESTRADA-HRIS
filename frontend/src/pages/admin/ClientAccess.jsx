import { useEffect, useState } from 'react';
import api from '../../lib/api.js';

const ROLE_LABEL = { HR_ADMIN: 'HR Admin', HR_MANAGER: 'HR Manager', PAYROLL_OFFICER: 'Payroll Officer' };
const errMsg = (err, fallback) => err?.response?.data?.message || fallback;

/**
 * Super Admin: decide which clients each HR Admin / HR Manager / Payroll Officer works on,
 * and whether they may fund that client's wallet. Everything those roles see in the HRIS
 * (employees, payroll, dashboard numbers, wallets) is limited to these assignments.
 */
export default function ClientAccess() {
  const [data, setData] = useState(null);
  const [editing, setEditing] = useState(null); // userId
  const [draft, setDraft] = useState({}); // { [clientId]: { canFund } }
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function load() {
    try {
      const r = await api.get('/access');
      setData(r.data);
    } catch (e) {
      setError(errMsg(e, 'Could not load client access.'));
    }
  }
  useEffect(() => { load(); }, []);

  function startEdit(admin) {
    const d = {};
    admin.clientAssignments.forEach((a) => { d[a.clientId] = { canFund: a.canFund }; });
    setDraft(d);
    setEditing(admin.id);
    setNotice('');
    setError('');
  }

  function toggleClient(clientId) {
    setDraft((prev) => {
      const next = { ...prev };
      if (next[clientId]) delete next[clientId];
      else next[clientId] = { canFund: true };
      return next;
    });
  }

  function toggleFund(clientId) {
    setDraft((prev) => ({ ...prev, [clientId]: { canFund: !prev[clientId].canFund } }));
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.put(`/access/users/${editing}`, {
        assignments: Object.entries(draft).map(([clientId, v]) => ({ clientId, canFund: v.canFund })),
      });
      setNotice('Access updated.');
      setEditing(null);
      await load();
    } catch (e) {
      setError(errMsg(e, 'Could not save access.'));
    } finally {
      setSaving(false);
    }
  }

  if (!data) return <p className="text-sm text-slate-400">{error || 'Loading…'}</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Client Access</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
          HR Admins, HR Managers and Payroll Officers only see the clients you assign here — their employees, payroll,
          dashboard numbers and wallet funding. They can fund an assigned client's wallet (if allowed) but never disburse salaries.
        </p>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {notice && <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-3 py-2 rounded-lg">{notice}</div>}

      <div className="space-y-3">
        {data.admins.map((a) => {
          const name = a.employee ? `${a.employee.firstName} ${a.employee.lastName}` : a.email;
          const assigned = a.clientAssignments
            .map((x) => data.clients.find((c) => c.id === x.clientId)?.name)
            .filter(Boolean);
          const isEditing = editing === a.id;

          return (
            <div key={a.id} className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-slate-800 dark:text-white">
                    {name} {!a.isActive && <span className="badge bg-slate-200 text-slate-600 ml-2">Deactivated</span>}
                  </p>
                  <p className="text-xs text-slate-400">{a.email} · {ROLE_LABEL[a.role] || a.role}</p>
                </div>
                {!isEditing && (
                  <button onClick={() => startEdit(a)} className="btn-secondary text-xs">Edit access</button>
                )}
              </div>

              {!isEditing && (
                <p className="text-sm mt-3 text-slate-600 dark:text-slate-300">
                  {assigned.length ? assigned.join(', ') : <span className="text-amber-600">No clients assigned — this person currently sees no client data.</span>}
                </p>
              )}

              {isEditing && (
                <div className="mt-4 space-y-3">
                  <div className="grid sm:grid-cols-2 gap-2">
                    {data.clients.map((c) => {
                      const on = !!draft[c.id];
                      return (
                        <div key={c.id} className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2 ${on ? 'border-estrada-orange/60 bg-orange-50/50 dark:bg-slate-800/50' : 'border-slate-200 dark:border-slate-800'}`}>
                          <label className="flex items-center gap-2 text-sm cursor-pointer">
                            <input type="checkbox" checked={on} onChange={() => toggleClient(c.id)} />
                            <span className="text-slate-800 dark:text-slate-100">{c.name}</span>
                          </label>
                          {on && (
                            <label className="flex items-center gap-1 text-xs text-slate-500 cursor-pointer">
                              <input type="checkbox" checked={draft[c.id].canFund} onChange={() => toggleFund(c.id)} />
                              can fund wallet
                            </label>
                          )}
                        </div>
                      );
                    })}
                    {data.clients.length === 0 && <p className="text-sm text-slate-400">No active clients yet — create one under Clients & Sites first.</p>}
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(null)} className="btn-secondary">Cancel</button>
                    <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save access'}</button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
        {data.admins.length === 0 && (
          <div className="card p-6 text-sm text-slate-500">
            There are no HR Admin, HR Manager or Payroll Officer accounts yet. Invite them from Employees, then assign their clients here.
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../../lib/api.js';

export default function Exit() {
  const [employees, setEmployees] = useState([]);
  const [employeeId, setEmployeeId] = useState('');
  const [exitProcess, setExitProcess] = useState(null);
  const [showInitiate, setShowInitiate] = useState(false);

  useEffect(() => {
    api.get('/employees', { params: { employmentStatus: 'ACTIVE' } }).then((r) => setEmployees(r.data.employees));
  }, []);

  async function loadExit(id) {
    setEmployeeId(id);
    const { data } = await api.get(`/exit/${id}`);
    setExitProcess(data.exitProcess);
  }

  async function completeTask(taskId) {
    await api.patch(`/exit/clearance-task/${taskId}`);
    loadExit(employeeId);
  }

  async function saveInterview(notes) {
    await api.patch(`/exit/${exitProcess.id}/interview-notes`, { notes });
    loadExit(employeeId);
  }

  async function saveSettlement(amount) {
    await api.patch(`/exit/${exitProcess.id}/final-settlement`, { amount: Number(amount) });
    loadExit(employeeId);
  }

  async function completeExit() {
    if (!confirm('Complete exit and archive employee? This cannot be undone.')) return;
    await api.post(`/exit/${exitProcess.id}/complete`);
    loadExit(employeeId);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Exit Management</h1>
        <button onClick={() => setShowInitiate(true)} className="btn-primary">+ Initiate Exit</button>
      </div>

      <div className="card p-4">
        <label className="label">Select Employee</label>
        <select className="input max-w-sm" value={employeeId} onChange={(e) => loadExit(e.target.value)}>
          <option value="">Select…</option>
          {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName} ({e.employeeCode})</option>)}
        </select>
      </div>

      {employeeId && !exitProcess && <p className="text-slate-400 text-sm">No exit process has been initiated for this employee.</p>}

      {exitProcess && (
        <div className="space-y-5">
          <div className="card p-6">
            <h2 className="font-semibold text-slate-800 dark:text-white mb-3">Clearance Checklist</h2>
            <div className="space-y-2">
              {exitProcess.clearanceTasks.map((t) => (
                <label key={t.id} className="flex items-center gap-3 text-sm">
                  <input type="checkbox" checked={t.isComplete} onChange={() => !t.isComplete && completeTask(t.id)} className="h-4 w-4 accent-estrada-red" />
                  <span className={t.isComplete ? 'line-through text-slate-400' : 'text-slate-700 dark:text-slate-200'}>{t.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="card p-6 space-y-3">
            <h2 className="font-semibold text-slate-800 dark:text-white">Exit Interview</h2>
            <textarea
              className="input"
              rows={3}
              defaultValue={exitProcess.exitInterviewNotes || ''}
              onBlur={(e) => saveInterview(e.target.value)}
              placeholder="Notes from exit interview…"
            />
          </div>

          <div className="card p-6 space-y-3">
            <h2 className="font-semibold text-slate-800 dark:text-white">Final Settlement</h2>
            <input
              type="number"
              className="input max-w-xs"
              defaultValue={exitProcess.finalSettlementAmount || ''}
              onBlur={(e) => saveSettlement(e.target.value)}
              placeholder="Amount"
            />
          </div>

          <div className="card p-6 flex items-center justify-between">
            <div>
              <p className="font-medium text-slate-800 dark:text-white">Status: {exitProcess.status.replace(/_/g, ' ')}</p>
              <p className="text-sm text-slate-400">Once all steps are done, complete the exit to archive the employee.</p>
            </div>
            {exitProcess.status !== 'ARCHIVED' && <button onClick={completeExit} className="btn-primary">Complete Exit</button>}
          </div>
        </div>
      )}

      {showInitiate && <InitiateModal onClose={() => setShowInitiate(false)} employees={employees} onCreated={loadExit} />}
    </div>
  );
}

function InitiateModal({ onClose, employees, onCreated }) {
  const [form, setForm] = useState({ employeeId: '', reason: '', lastWorkingDay: '' });
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    await api.post('/exit/initiate', form);
    setLoading(false);
    onCreated(form.employeeId);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-md space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white">Initiate Exit</h2>
        <div>
          <label className="label">Employee</label>
          <select required className="input" value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Select…</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.firstName} {e.lastName}</option>)}
          </select>
        </div>
        <div><label className="label">Reason</label><input className="input" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></div>
        <div><label className="label">Last Working Day</label><input type="date" className="input" value={form.lastWorkingDay} onChange={(e) => setForm({ ...form, lastWorkingDay: e.target.value })} /></div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Saving…' : 'Initiate'}</button>
        </div>
      </form>
    </div>
  );
}

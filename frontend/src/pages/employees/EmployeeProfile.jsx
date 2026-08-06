import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import api from '../../lib/api.js';
import StatusBadge from '../../components/shared/StatusBadge.jsx';
import { useAuth } from '../../context/AuthContext.jsx';

const TABS = ['Overview', 'Timeline'];

export default function EmployeeProfile() {
  const { id } = useParams();
  const { user } = useAuth();
  const [employee, setEmployee] = useState(null);
  const [tab, setTab] = useState('Overview');
  const [timeline, setTimeline] = useState([]);
  const [showAssignModal, setShowAssignModal] = useState(false);

  async function load() {
    const { data } = await api.get(`/employees/${id}`);
    setEmployee(data.employee);
  }

  useEffect(() => { load(); }, [id]); // eslint-disable-line

  useEffect(() => {
    if (tab === 'Timeline') {
      api.get(`/employees/${id}/timeline`).then((r) => setTimeline(r.data.logs));
    }
  }, [tab, id]);

  async function approveOnboarding() {
    await api.post(`/employees/${id}/approve-onboarding`);
    load();
  }

  async function archiveEmployee() {
    if (!confirm('Archive this employee record?')) return;
    await api.post(`/employees/${id}/archive`);
    load();
  }

  if (!employee) return <p className="text-slate-400">Loading…</p>;

  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);

  return (
    <div className="space-y-5">
      <div className="card p-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between">
        <div className="flex items-center gap-4">
          <div className="h-16 w-16 rounded-full bg-estrada-gradient text-white flex items-center justify-center text-xl font-bold">
            {employee.firstName[0]}{employee.lastName[0]}
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">{employee.firstName} {employee.lastName}</h1>
            <p className="text-sm text-slate-400">{employee.employeeCode} · {employee.position?.title || 'No position set'}</p>
            <div className="mt-2 flex gap-2">
              <StatusBadge status={employee.employmentStatus} />
              <StatusBadge status={employee.onboardingStatus} />
            </div>
          </div>
        </div>
        {isPrivileged && (
          <div className="flex gap-2">
            {employee.onboardingStatus === 'SUBMITTED' && (
              <button onClick={approveOnboarding} className="btn-primary">Approve Onboarding</button>
            )}
            {!employee.archived && (
              <button onClick={archiveEmployee} className="btn-secondary text-red-600">Archive</button>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === t ? 'border-estrada-red text-estrada-red' : 'border-transparent text-slate-500'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'Overview' && (
        <div className="grid lg:grid-cols-2 gap-5">
          <InfoCard
            title="Employment"
            action={isPrivileged && <button onClick={() => setShowAssignModal(true)} className="text-xs text-estrada-red hover:underline">Edit Assignment</button>}
          >
            <Row label="Department" value={employee.department?.name} />
            <Row label="Position" value={employee.position?.title} />
            <Row label="Client" value={employee.client?.name} />
            <Row label="Site" value={employee.site?.name} />
            <Row label="Team Lead / Line Manager" value={employee.teamLead ? `${employee.teamLead.firstName} ${employee.teamLead.lastName}` : null} />
            <Row label="Date Hired" value={employee.dateHired ? new Date(employee.dateHired).toDateString() : '—'} />
          </InfoCard>
          <InfoCard title="Personal">
            <Row label="Phone" value={employee.phone} />
            <Row label="Gender" value={employee.gender} />
            <Row label="Date of Birth" value={employee.dateOfBirth ? new Date(employee.dateOfBirth).toDateString() : '—'} />
            <Row label="Address" value={employee.address} />
          </InfoCard>
          <InfoCard title="Emergency Contact">
            <Row label="Name" value={employee.emergencyContactName} />
            <Row label="Phone" value={employee.emergencyContactPhone} />
            <Row label="Relationship" value={employee.emergencyContactRelationship} />
          </InfoCard>
          <InfoCard title="Next of Kin">
            <Row label="Name" value={employee.nextOfKinName} />
            <Row label="Phone" value={employee.nextOfKinPhone} />
            <Row label="Relationship" value={employee.nextOfKinRelationship} />
          </InfoCard>
          <InfoCard title="Bank & Pension">
            <Row label="Bank Name" value={employee.bankName} />
            <Row label="Account Number" value={employee.bankAccountNumber} />
            <Row label="Account Name" value={employee.bankAccountName} />
            <Row label="Pension RSA" value={employee.pensionRSA} />
          </InfoCard>
        </div>
      )}

      {tab === 'Timeline' && (
        <div className="card p-6">
          <ol className="relative border-l border-slate-200 dark:border-slate-800 ml-2 space-y-6">
            {timeline.map((log) => (
              <li key={log.id} className="ml-4">
                <div className="absolute -ml-[9px] mt-1 h-3 w-3 rounded-full bg-estrada-gradient" />
                <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{log.description}</p>
                <p className="text-xs text-slate-400">{new Date(log.createdAt).toLocaleString()} {log.actor ? `· ${log.actor.email}` : ''}</p>
              </li>
            ))}
            {timeline.length === 0 && <p className="text-slate-400 text-sm">No activity recorded yet.</p>}
          </ol>
        </div>
      )}

      {showAssignModal && (
        <AssignmentModal
          employee={employee}
          onClose={() => setShowAssignModal(false)}
          onSaved={() => { setShowAssignModal(false); load(); }}
        />
      )}
    </div>
  );
}

function AssignmentModal({ employee, onClose, onSaved }) {
  const [departments, setDepartments] = useState([]);
  const [positions, setPositions] = useState([]);
  const [clients, setClients] = useState([]);
  const [teamLeads, setTeamLeads] = useState([]);
  const [form, setForm] = useState({
    departmentId: employee.departmentId || '',
    positionId: employee.positionId || '',
    clientId: employee.clientId || '',
    siteId: employee.siteId || '',
    teamLeadId: employee.teamLeadId || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([api.get('/org/departments'), api.get('/org/positions'), api.get('/clients')]).then(
      ([d, p, c]) => {
        setDepartments(d.data.departments);
        setPositions(p.data.positions);
        setClients(c.data.clients);
      }
    );
  }, []);

  // Reload eligible team lead candidates whenever the selected site changes, since
  // Team Lead-role candidates are scoped to that site (HR Admin/Super Admin always included).
  useEffect(() => {
    api
      .get('/employees/eligible-team-leads', { params: { siteId: form.siteId || undefined, excludeEmployeeId: employee.id } })
      .then((r) => setTeamLeads(r.data.candidates))
      .catch(() => setTeamLeads([]));
  }, [form.siteId]); // eslint-disable-line

  const selectedClient = clients.find((c) => c.id === form.clientId);
  const positionsInDept = form.departmentId ? positions.filter((p) => p.departmentId === form.departmentId) : positions;

  function roleLabel(role) {
    if (role === 'TEAM_LEAD') return 'Team Lead';
    if (role === 'HR_ADMIN') return 'HR Admin';
    if (role === 'SUPER_ADMIN') return 'Super Admin';
    return role;
  }

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.patch(`/employees/${employee.id}`, {
        departmentId: form.departmentId || null,
        positionId: form.positionId || null,
        clientId: form.clientId || null,
        siteId: form.siteId || null,
        teamLeadId: form.teamLeadId || null,
      });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to save assignment');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="card p-6 w-full max-w-md max-h-[90vh] overflow-y-auto space-y-4">
        <div>
          <h2 className="font-bold text-lg text-slate-900 dark:text-white">Edit Assignment</h2>
          <p className="text-xs text-slate-400 mt-1">Change department, position, client, site, or team lead — useful for promotions, transfers, or clients with multiple locations.</p>
        </div>
        {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

        <div>
          <label className="label">Department</label>
          <select className="input" value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value, positionId: '' })}>
            <option value="">Not assigned</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>

        <div>
          <label className="label">Position</label>
          <select className="input" value={form.positionId} onChange={(e) => setForm({ ...form, positionId: e.target.value })}>
            <option value="">Not assigned</option>
            {positionsInDept.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <div>
            <label className="label">Client</label>
            <select className="input" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value, siteId: '' })}>
              <option value="">Not assigned</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="mt-3">
            <label className="label">Site</label>
            <select className="input" value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })} disabled={!selectedClient}>
              <option value="">{selectedClient ? 'Not assigned' : 'Select a client first'}</option>
              {selectedClient?.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <p className="text-xs text-slate-400 mt-1">This determines where the employee is expected to check in for attendance.</p>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className="label">Team Lead / Line Manager</label>
          <select className="input" value={form.teamLeadId} onChange={(e) => setForm({ ...form, teamLeadId: e.target.value })}>
            <option value="">No team lead — leave requests go straight to HR</option>
            {teamLeads.map((tl) => (
              <option key={tl.id} value={tl.id}>{tl.firstName} {tl.lastName} — {roleLabel(tl.user.role)}</option>
            ))}
          </select>
          <p className="text-xs text-slate-400 mt-1">
            This person approves this employee's leave requests first, before HR gives final approval. Team Leads shown here are limited to the site selected above; HR Admin/Super Admin are always available.
          </p>
        </div>

        <div className="flex gap-2 pt-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? 'Saving…' : 'Save Assignment'}</button>
        </div>
      </div>
    </div>
  );
}

function InfoCard({ title, action, children }) {
  return (
    <div className="card p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold text-slate-800 dark:text-white">{title}</h3>
        {action}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-sm">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 dark:text-slate-200">{value || '—'}</span>
    </div>
  );
}

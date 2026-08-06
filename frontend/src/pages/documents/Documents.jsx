import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Documents() {
  const { employee, user } = useAuth();
  const [types, setTypes] = useState([]);
  const [companyDocs, setCompanyDocs] = useState([]);
  const [myDocs, setMyDocs] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [uploadingType, setUploadingType] = useState(null);

  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);

  async function load() {
    const [{ data: typesData }, { data: companyData }] = await Promise.all([
      api.get('/documents/types'),
      api.get('/documents/company'),
    ]);
    setTypes(typesData.types);
    setCompanyDocs(companyData.documents);
    if (isPrivileged) {
      const { data } = await api.get('/org/departments');
      setDepartments(data.departments);
    }
    if (employee) {
      const { data } = await api.get('/documents', { params: { employeeId: employee.id } });
      setMyDocs(data.documents);
    }
  }

  useEffect(() => { load(); }, [employee, user]); // eslint-disable-line

  async function uploadDocument(file, documentTypeId) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentTypeId', documentTypeId);
    formData.append('employeeId', employee.id);
    setUploadingType(documentTypeId);
    try {
      await api.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } finally {
      setUploadingType(null);
    }
  }

  async function deleteCompanyDoc(id) {
    if (!confirm('Delete this document?')) return;
    await api.delete(`/documents/company/${id}`);
    load();
  }

  const employeeDocTypes = types.filter((t) => t.owner === 'EMPLOYEE');

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Documents</h1>

      {isPrivileged && <UploadCompanyDocumentForm departments={departments} onUploaded={load} />}

      <div className="card p-6">
        <h2 className="font-semibold text-slate-800 dark:text-white mb-1">Company Documents</h2>
        <p className="text-xs text-slate-400 mb-3">
          {isPrivileged
            ? 'Showing every department-scoped document across the company.'
            : 'Showing documents for your department, plus anything shared company-wide.'}
        </p>
        <div className="space-y-3">
          {companyDocs.map((doc) => (
            <div key={doc.id} className="flex items-center justify-between border border-slate-100 dark:border-slate-800 rounded-lg px-4 py-3">
              <div>
                <p className="font-medium text-sm text-slate-800 dark:text-slate-100">{doc.title || doc.fileName}</p>
                <p className="text-xs text-slate-400">{doc.department?.name || 'All departments'}</p>
                <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-estrada-red hover:underline">View / Download</a>
              </div>
              {isPrivileged && (
                <button onClick={() => deleteCompanyDoc(doc.id)} className="text-xs text-red-600 hover:underline">Delete</button>
              )}
            </div>
          ))}
          {companyDocs.length === 0 && <p className="text-slate-400 text-sm">No company documents uploaded yet.</p>}
        </div>
      </div>

      {employee && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-800 dark:text-white mb-3">My Documents</h2>
          <div className="space-y-3">
            {employeeDocTypes.map((type) => {
              const uploaded = myDocs.filter((d) => d.documentTypeId === type.id);
              return (
                <div key={type.id} className="flex items-center justify-between border border-slate-100 dark:border-slate-800 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium text-sm text-slate-800 dark:text-slate-100">{type.name}</p>
                    {uploaded.length > 0 ? (
                      uploaded.map((d) => (
                        <a key={d.id} href={d.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-estrada-red hover:underline block">{d.fileName}</a>
                      ))
                    ) : (
                      <p className="text-xs text-slate-400">Not uploaded</p>
                    )}
                  </div>
                  <label className="btn-secondary text-xs cursor-pointer">
                    {uploadingType === type.id ? 'Uploading…' : 'Upload'}
                    <input type="file" hidden onChange={(e) => e.target.files[0] && uploadDocument(e.target.files[0], type.id)} />
                  </label>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function UploadCompanyDocumentForm({ departments, onUploaded }) {
  const [title, setTitle] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [file, setFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    if (!file) {
      setError('Please choose a file to upload.');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('title', title);
      if (departmentId) formData.append('departmentId', departmentId);
      await api.post('/documents/company-upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      setTitle('');
      setDepartmentId('');
      setFile(null);
      e.target.reset();
      onUploaded();
    } catch (err) {
      setError(err.response?.data?.message || 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <form onSubmit={submit} className="card p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-slate-800 dark:text-white">Upload Company Document</h2>
        <p className="text-xs text-slate-400 mt-1">
          For SOPs and policies that differ by department. Leave department as "All Departments" for company-wide documents like the Employee Handbook.
        </p>
      </div>

      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

      <div className="grid sm:grid-cols-3 gap-3">
        <div className="sm:col-span-1">
          <label className="label">Title</label>
          <input required className="input" placeholder='e.g. "Finance SOP" or "Employee Handbook"' value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="sm:col-span-1">
          <label className="label">Department</label>
          <select className="input" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
            <option value="">All Departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div className="sm:col-span-1">
          <label className="label">File</label>
          <input required type="file" className="input" onChange={(e) => setFile(e.target.files[0] || null)} />
        </div>
      </div>

      <button type="submit" disabled={uploading} className="btn-primary">{uploading ? 'Uploading…' : 'Upload Document'}</button>
    </form>
  );
}

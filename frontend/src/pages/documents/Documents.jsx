import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';

export default function Documents() {
  const { employee, user } = useAuth();
  const [types, setTypes] = useState([]);
  const [companyDocs, setCompanyDocs] = useState([]);
  const [myDocs, setMyDocs] = useState([]);
  const [uploadingType, setUploadingType] = useState(null);

  async function load() {
    const [{ data: typesData }, { data: companyData }] = await Promise.all([
      api.get('/documents/types'),
      api.get('/documents'),
    ]);
    setTypes(typesData.types);
    setCompanyDocs(companyData.documents);
    if (employee) {
      const { data } = await api.get('/documents', { params: { employeeId: employee.id } });
      setMyDocs(data.documents);
    }
  }

  useEffect(() => { load(); }, [employee]); // eslint-disable-line

  async function acknowledge(docId) {
    await api.post(`/documents/${docId}/acknowledge`);
    load();
  }

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

  async function uploadCompanyDocument(file, documentTypeId) {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('documentTypeId', documentTypeId);
    setUploadingType(documentTypeId);
    try {
      await api.post('/documents/upload', formData, { headers: { 'Content-Type': 'multipart/form-data' } });
      await load();
    } finally {
      setUploadingType(null);
    }
  }

  const employeeDocTypes = types.filter((t) => t.owner === 'EMPLOYEE');
  const companyDocTypes = types.filter((t) => t.owner === 'COMPANY');
  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Documents</h1>

      {isPrivileged && (
        <div className="card p-6">
          <h2 className="font-semibold text-slate-800 dark:text-white mb-1">Upload Company Document</h2>
          <p className="text-xs text-slate-400 mb-3">These are visible to every employee (Employee Handbook, Company Policy, HSE Policy, Code of Conduct).</p>
          <div className="space-y-3">
            {companyDocTypes.map((type) => {
              const existing = companyDocs.filter((d) => d.documentTypeId === type.id);
              return (
                <div key={type.id} className="flex items-center justify-between border border-slate-100 dark:border-slate-800 rounded-lg px-4 py-3">
                  <div>
                    <p className="font-medium text-sm text-slate-800 dark:text-slate-100">{type.name}</p>
                    {existing.length > 0 ? (
                      existing.map((d) => <p key={d.id} className="text-xs text-slate-400">Current: {d.fileName}</p>)
                    ) : (
                      <p className="text-xs text-slate-400">Not uploaded yet</p>
                    )}
                  </div>
                  <label className="btn-secondary text-xs cursor-pointer">
                    {uploadingType === type.id ? 'Uploading…' : existing.length > 0 ? 'Replace' : 'Upload'}
                    <input type="file" hidden onChange={(e) => e.target.files[0] && uploadCompanyDocument(e.target.files[0], type.id)} />
                  </label>
                </div>
              );
            })}
            {companyDocTypes.length === 0 && <p className="text-slate-400 text-sm">No company document types configured yet.</p>}
          </div>
        </div>
      )}

      <div className="card p-6">
        <h2 className="font-semibold text-slate-800 dark:text-white mb-3">Company Documents</h2>
        <div className="space-y-3">
          {companyDocs.map((doc) => {
            const mine = myDocs.find((d) => d.documentTypeId === doc.documentTypeId && d.ackStatus !== 'NOT_REQUIRED');
            return (
              <div key={doc.id} className="flex items-center justify-between border border-slate-100 dark:border-slate-800 rounded-lg px-4 py-3">
                <div>
                  <p className="font-medium text-sm text-slate-800 dark:text-slate-100">{doc.documentType.name}</p>
                  <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-xs text-estrada-red hover:underline">View / Download</a>
                </div>
                {doc.documentType.requiresAck && (
                  doc.ackStatus === 'ACKNOWLEDGED' ? (
                    <span className="badge bg-green-100 text-green-700">Acknowledged</span>
                  ) : (
                    <button onClick={() => acknowledge(doc.id)} className="btn-secondary text-xs">Acknowledge</button>
                  )
                )}
              </div>
            );
          })}
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

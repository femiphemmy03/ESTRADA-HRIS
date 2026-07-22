import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

// Default marker icon fix for bundlers
const markerIcon = new L.Icon({
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
  iconSize: [25, 41],
  iconAnchor: [12, 41],
});

export default function Clients() {
  const { user } = useAuth();
  const [clients, setClients] = useState([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showNewClient, setShowNewClient] = useState(false);
  const [showNewSite, setShowNewSite] = useState(false);
  const isPrivileged = ['SUPER_ADMIN', 'HR_ADMIN'].includes(user?.role);

  async function load() {
    const { data } = await api.get('/clients');
    setClients(data.clients);
  }
  useEffect(() => { load(); }, []);

  const selectedClient = clients.find((c) => c.id === selectedClientId);

  async function approveSite(siteId) {
    await api.post(`/clients/sites/${siteId}/approve`);
    load();
  }
  async function rejectSite(siteId) {
    await api.post(`/clients/sites/${siteId}/reject`);
    load();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-slate-900 dark:text-white">Clients & Sites</h1>
        {isPrivileged && <button onClick={() => setShowNewClient(true)} className="btn-primary">+ New Client</button>}
      </div>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="card p-4 space-y-2 h-fit">
          {clients.map((c) => (
            <button
              key={c.id}
              onClick={() => setSelectedClientId(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm ${selectedClientId === c.id ? 'bg-estrada-gradient text-white' : 'hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200'}`}
            >
              {c.name} <span className="opacity-70">({c.sites.length} sites)</span>
            </button>
          ))}
          {clients.length === 0 && <p className="text-slate-400 text-sm">No clients yet.</p>}
        </div>

        <div className="lg:col-span-2 space-y-4">
          {selectedClient ? (
            <>
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-slate-800 dark:text-white">{selectedClient.name} — Sites</h2>
                {['SUPER_ADMIN', 'HR_ADMIN', 'TEAM_LEAD'].includes(user.role) && (
                  <button onClick={() => setShowNewSite(true)} className="btn-secondary text-xs">+ Register Site</button>
                )}
              </div>
              <div className="space-y-3">
                {selectedClient.sites.map((s) => (
                  <div key={s.id} className="card p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm text-slate-800 dark:text-white">{s.name}</p>
                      <p className="text-xs text-slate-400">{s.latitude.toFixed(4)}, {s.longitude.toFixed(4)} · radius {s.radiusMeters}m</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={s.approvalStatus} />
                      {isPrivileged && s.approvalStatus === 'PENDING' && (
                        <>
                          <button onClick={() => approveSite(s.id)} className="btn-secondary text-xs">Approve</button>
                          <button onClick={() => rejectSite(s.id)} className="btn-secondary text-xs text-red-600">Reject</button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {selectedClient.sites.length === 0 && <p className="text-slate-400 text-sm">No sites registered for this client yet.</p>}
              </div>
            </>
          ) : (
            <p className="text-slate-400 text-sm">Select a client to view its sites.</p>
          )}
        </div>
      </div>

      {showNewClient && <NewClientModal onClose={() => setShowNewClient(false)} onCreated={load} />}
      {showNewSite && selectedClient && (
        <NewSiteModal clientId={selectedClient.id} onClose={() => setShowNewSite(false)} onCreated={load} />
      )}
    </div>
  );
}

function NewClientModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    await api.post('/clients', { name });
    setLoading(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white">New Client</h2>
        <input required className="input" placeholder="Client name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Saving…' : 'Create'}</button>
        </div>
      </form>
    </div>
  );
}

function LocationPicker({ position, setPosition }) {
  useMapEvents({
    click(e) {
      setPosition([e.latlng.lat, e.latlng.lng]);
    },
  });
  return position ? <Marker position={position} icon={markerIcon} /> : null;
}

function NewSiteModal({ clientId, onClose, onCreated }) {
  const [name, setName] = useState('');
  const [radius, setRadius] = useState(150);
  const [position, setPosition] = useState([9.0765, 7.3986]); // Abuja default center
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setLoading(true);
    await api.post('/clients/sites', {
      clientId,
      name,
      latitude: position[0],
      longitude: position[1],
      radiusMeters: Number(radius),
    });
    setLoading(false);
    onCreated();
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-2xl space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white">Register New Site</h2>
        <p className="text-xs text-slate-400">Click on the map to set the site's GPS location. New sites require HR approval before activation unless you are HR/Admin.</p>
        <div className="grid sm:grid-cols-2 gap-3">
          <input required className="input" placeholder="Site name" value={name} onChange={(e) => setName(e.target.value)} />
          <input type="number" className="input" placeholder="Radius (meters)" value={radius} onChange={(e) => setRadius(e.target.value)} />
        </div>
        <div className="h-72 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
          <MapContainer center={position} zoom={13} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <LocationPicker position={position} setPosition={setPosition} />
            <Circle center={position} radius={Number(radius) || 0} pathOptions={{ color: '#EE3124' }} />
          </MapContainer>
        </div>
        <p className="text-xs text-slate-400">Selected: {position[0].toFixed(5)}, {position[1].toFixed(5)}</p>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={loading} className="btn-primary flex-1">{loading ? 'Saving…' : 'Register Site'}</button>
        </div>
      </form>
    </div>
  );
}

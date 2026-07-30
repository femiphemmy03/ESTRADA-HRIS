import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Circle, useMapEvents, useMap } from 'react-leaflet';
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

function RecenterMap({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.flyTo(position, 17);
  }, [position]); // eslint-disable-line
  return null;
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
  const [radiusTouched, setRadiusTouched] = useState(false); // true once admin manually edits the radius
  const [position, setPosition] = useState(null); // no default — must be set (auto or manual)
  const [accuracy, setAccuracy] = useState(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Fallback map view only — no marker/circle shown until `position` is actually set.
  const initialMapCenter = [9.0820, 8.6753]; // roughly the center of Nigeria, display only

  function suggestRadius(accuracyMeters) {
    // Auto-suggested allowance: device accuracy + a buffer, rounded up to the nearest 50m,
    // with a sensible floor/ceiling. Admin can still override manually.
    const withBuffer = accuracyMeters + 50;
    const rounded = Math.ceil(withBuffer / 50) * 50;
    return Math.min(500, Math.max(100, rounded));
  }

  function useMyLocation() {
    setLocateError('');
    if (!navigator.geolocation) {
      setLocateError('Geolocation is not supported by this browser.');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition([pos.coords.latitude, pos.coords.longitude]);
        const acc = Math.round(pos.coords.accuracy);
        setAccuracy(acc);
        if (!radiusTouched) setRadius(suggestRadius(acc));
        setLocating(false);
      },
      (err) => {
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? 'Location permission was denied. You can allow it in your browser settings, or set the location manually on the map below.'
            : err.message || 'Could not get your location — set it manually on the map below.'
        );
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  }

  // Auto-detect as soon as the modal opens — no button press required.
  // The button below still works for retrying (e.g. after granting permission, or moving outdoors).
  useEffect(() => {
    useMyLocation();
  }, []); // eslint-disable-line

  function handleManualPick(pos) {
    setPosition(pos);
    setAccuracy(null); // manual map clicks have no device accuracy figure to base a suggestion on
  }

  function handleRadiusChange(v) {
    setRadiusTouched(true);
    setRadius(v);
  }

  async function submit(e) {
    e.preventDefault();
    if (!position) {
      setError('Please set the site location first — click "Use my current location" while physically at the site, or click the exact spot on the map.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await api.post('/clients/sites', {
        clientId,
        name,
        latitude: position[0],
        longitude: position[1],
        radiusMeters: Number(radius),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to register site');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white">Register New Site</h2>
        <p className="text-xs text-slate-400">
          We'll try to detect the site's GPS location automatically as soon as this opens. For the most accurate result, open this on a phone <strong>while physically standing at the site</strong>. You can also click the exact spot on the map to override it. New sites require HR approval before activation unless you are HR/Admin.
        </p>

        {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}

        <div className="grid sm:grid-cols-2 gap-3">
          <input required className="input" placeholder="Site name" value={name} onChange={(e) => setName(e.target.value)} />
          <div>
            <input type="number" className="input" placeholder="Radius (meters)" value={radius} onChange={(e) => handleRadiusChange(e.target.value)} />
            {!radiusTouched && accuracy != null && (
              <p className="text-[11px] text-slate-400 mt-1">Auto-suggested from GPS accuracy — adjust if the physical site is larger/smaller.</p>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={useMyLocation} disabled={locating} className="btn-primary text-sm">
            {locating ? 'Detecting location…' : position ? '📍 Re-detect my location' : '📍 Use my current location'}
          </button>
          {accuracy != null && (
            <span className={`text-xs ${accuracy > 100 ? 'text-amber-600' : 'text-green-600'}`}>
              Device accuracy: ±{accuracy}m {accuracy > 100 ? '(quite wide — move outdoors or near a window if possible)' : ''}
            </span>
          )}
          {locateError && <span className="text-xs text-red-600">{locateError}</span>}
        </div>

        <div className="h-72 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-800">
          <MapContainer center={position || initialMapCenter} zoom={position ? 17 : 6} style={{ height: '100%', width: '100%' }}>
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
            <LocationPicker position={position} setPosition={handleManualPick} />
            <RecenterMap position={position} />
            {position && <Circle center={position} radius={Number(radius) || 0} pathOptions={{ color: '#EE3124' }} />}
          </MapContainer>
        </div>

        <p className="text-xs text-slate-400">
          {position ? `Selected: ${position[0].toFixed(5)}, ${position[1].toFixed(5)}` : 'No location set yet — the map above is just a general view until you set one.'}
        </p>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={loading || !position} className="btn-primary flex-1">{loading ? 'Saving…' : 'Register Site'}</button>
        </div>
      </form>
    </div>
  );
}

import { useEffect, useState } from 'react';
import api from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import StatusBadge from '../../components/shared/StatusBadge.jsx';

const FUND_ROLES = ['SUPER_ADMIN', 'HR_ADMIN', 'HR_MANAGER'];

const naira = (n) =>
  `₦${Number(n || 0).toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const when = (d) => (d ? new Date(d).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const errMsg = (err, fallback) => err?.response?.data?.message || fallback;

export default function Wallet() {
  const { user } = useAuth();
  const canFund = FUND_ROLES.includes(user?.role);
  const [tab, setTab] = useState('My Wallet');
  const [unread, setUnread] = useState(0);

  const tabs = ['My Wallet', 'Loans', ...(canFund ? [user?.role === 'SUPER_ADMIN' ? 'Client Wallets' : 'Fund Client Wallet'] : []), 'Notifications'];

  useEffect(() => {
    api.get('/wallet/notifications').then((r) => setUnread(r.data.unreadCount)).catch(() => {});
  }, [tab]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold text-slate-900 dark:text-white">Wallet</h1>
      <div className="flex gap-2 border-b border-slate-200 dark:border-slate-800 flex-wrap">
        {tabs.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t ? 'border-estrada-red text-estrada-red' : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
          >
            {t}
            {t === 'Notifications' && unread > 0 && (
              <span className="ml-2 inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1 rounded-full bg-estrada-red text-white text-[11px]">{unread}</span>
            )}
          </button>
        ))}
      </div>

      {tab === 'My Wallet' && <MyWallet />}
      {tab === 'Loans' && <LoansTab />}
      {tab === 'Client Wallets' && <FundingPanel isSuper />}
      {tab === 'Fund Client Wallet' && <FundingPanel isSuper={false} />}
      {tab === 'Notifications' && <Notifications onChange={setUnread} />}
    </div>
  );
}

// ------------------------------------------------------------------ My wallet
function MyWallet() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get('/wallet/me').then((r) => setData(r.data)).catch((e) => setError(errMsg(e, 'Could not load your wallet.')));
  }, []);

  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!data) return <p className="text-sm text-slate-400">Loading wallet…</p>;
  const { wallet, transactions } = data;

  return (
    <div className="space-y-5">
      <div className="grid md:grid-cols-3 gap-4">
        <div className="card p-6 md:col-span-2 bg-estrada-gradient text-white">
          <p className="text-sm opacity-90">Available balance</p>
          <p className="text-3xl font-bold mt-1">{naira(wallet.balance)}</p>
          <div className="mt-4 flex flex-wrap gap-x-8 gap-y-1 text-sm opacity-95">
            <p><span className="opacity-80">Wallet ID:</span> <span className="font-mono">{wallet.walletCode}</span></p>
            {wallet.employeeCode && <p><span className="opacity-80">Linked employee:</span> {wallet.employeeCode}</p>}
            <p><span className="opacity-80">Status:</span> {wallet.status}</p>
          </div>
        </div>
        <div className="card p-6 flex flex-col justify-between">
          <div>
            <p className="font-semibold text-slate-800 dark:text-white">Withdraw to bank</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Withdrawals to your personal bank account will be switched on once salary payments go live.
            </p>
          </div>
          <button disabled className="btn-primary mt-4">Withdraw</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
          <h2 className="font-semibold text-slate-800 dark:text-white">Transactions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2">Date</th>
                <th className="px-4 py-2">Reference</th>
                <th className="px-4 py-2">Description</th>
                <th className="px-4 py-2 text-right">Amount</th>
                <th className="px-4 py-2">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {transactions.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2 whitespace-nowrap">{when(t.createdAt)}</td>
                  <td className="px-4 py-2 font-mono text-xs">{t.reference}</td>
                  <td className="px-4 py-2">{t.description || t.type.replace(/_/g, ' ')}</td>
                  <td className={`px-4 py-2 text-right font-medium ${t.direction === 'CREDIT' ? 'text-green-600' : 'text-red-600'}`}>
                    {t.direction === 'CREDIT' ? '+' : '−'}{naira(t.amount)}
                  </td>
                  <td className="px-4 py-2"><StatusBadge status={t.status} /></td>
                </tr>
              ))}
              {transactions.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No transactions yet. Salary payments will appear here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Loans (placeholder)
function LoansTab() {
  return (
    <div className="card p-8 text-center space-y-2">
      <p className="text-3xl">🏦</p>
      <h2 className="font-semibold text-slate-800 dark:text-white">Loans are not active yet</h2>
      <p className="text-sm text-slate-500 dark:text-slate-400 max-w-md mx-auto">
        Every client has its own loan policy. Once your client's loan rules are set up by the Super Admin or your client admin,
        you'll be able to see your eligibility and apply here.
      </p>
    </div>
  );
}

// ------------------------------------------------------------------ Funding
function FundingPanel({ isSuper }) {
  const [clients, setClients] = useState([]);
  const [requests, setRequests] = useState([]);
  const [instructions, setInstructions] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const [c, r, i] = await Promise.all([
        api.get('/wallet/clients'),
        api.get('/wallet/funding-requests'),
        api.get('/wallet/funding-instructions'),
      ]);
      setClients(c.data.clients);
      setRequests(r.data.requests);
      setInstructions(i.data.instructions);
      setError('');
    } catch (e) {
      setError(errMsg(e, 'Could not load funding information.'));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  if (loading) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="space-y-5">
      {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
      {notice && <div className="bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 text-sm px-3 py-2 rounded-lg">{notice}</div>}

      {isSuper ? (
        <SuperClientWallets clients={clients} requests={requests} reload={load} setNotice={setNotice} setError={setError} />
      ) : (
        <AdminFunding clients={clients} instructions={instructions} reload={load} setNotice={setNotice} setError={setError} />
      )}

      <RequestsTable requests={requests} isSuper={isSuper} reload={load} setNotice={setNotice} setError={setError} />
    </div>
  );
}

function AccountDetails({ instructions }) {
  const [copied, setCopied] = useState(false);
  if (!instructions?.configured) {
    return (
      <div className="bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 text-sm px-3 py-2 rounded-lg">
        Funding account details haven't been configured yet. Ask the Super Admin to set them up.
      </div>
    );
  }
  function copy() {
    navigator.clipboard?.writeText(instructions.accountNumber).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }
  return (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-4 space-y-1 text-sm">
      <p className="text-xs uppercase tracking-wide text-slate-400">Pay into this Estrada account</p>
      <p><span className="text-slate-400">Bank:</span> <span className="font-medium text-slate-800 dark:text-white">{instructions.bankName}</span></p>
      <p><span className="text-slate-400">Account name:</span> <span className="font-medium text-slate-800 dark:text-white">{instructions.accountName}</span></p>
      <p className="flex items-center gap-2">
        <span className="text-slate-400">Account number:</span>
        <span className="font-mono font-semibold text-slate-800 dark:text-white">{instructions.accountNumber}</span>
        <button onClick={copy} className="btn-secondary text-xs !py-1 !px-2">{copied ? 'Copied' : 'Copy'}</button>
      </p>
      {instructions.note && <p className="text-xs text-slate-500 dark:text-slate-400 pt-1">{instructions.note}</p>}
    </div>
  );
}

function AdminFunding({ clients, instructions, reload, setNotice, setError }) {
  const [clientId, setClientId] = useState('');
  const [amount, setAmount] = useState('');
  const [paymentReference, setPaymentReference] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const selected = clients.find((c) => c.clientId === clientId);

  useEffect(() => {
    if (!clientId && clients.length === 1) setClientId(clients[0].clientId);
  }, [clients, clientId]);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const { data } = await api.post(`/wallet/clients/${clientId}/fund-requests`, {
        amount: Number(amount),
        paymentReference: paymentReference || undefined,
        note: note || undefined,
      });
      setNotice(`Payment reported. Your reference is ${data.transaction.reference}. You'll be notified here once it's received.`);
      setAmount('');
      setPaymentReference('');
      setNote('');
      reload();
    } catch (err) {
      setError(errMsg(err, 'Could not submit your payment.'));
    } finally {
      setBusy(false);
    }
  }

  if (clients.length === 0) {
    return (
      <div className="card p-6 text-sm text-slate-500 dark:text-slate-400">
        You haven't been assigned to any client yet, so there's nothing to fund. Ask the Super Admin to give you access.
      </div>
    );
  }

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <div className="card p-6 space-y-4">
        <div>
          <h2 className="font-semibold text-slate-800 dark:text-white">Fund a client wallet</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Pay into the account below, then tell us what you paid. The Super Admin confirms receipt and the client wallet is funded.
            You can fund wallets but not disburse salaries.
          </p>
        </div>
        <AccountDetails instructions={instructions} />
      </div>

      <form onSubmit={submit} className="card p-6 space-y-3">
        <h2 className="font-semibold text-slate-800 dark:text-white">I've made a payment</h2>
        <div>
          <label className="label">Client</label>
          <select required className="input" value={clientId} onChange={(e) => setClientId(e.target.value)}>
            <option value="">Select client…</option>
            {clients.map((c) => (
              <option key={c.clientId} value={c.clientId} disabled={!c.canFund}>
                {c.name}{!c.canFund ? ' (funding disabled)' : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Amount paid (₦)</label>
          <input required type="number" min="1" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="label">Bank transfer reference (optional)</label>
          <input className="input" value={paymentReference} onChange={(e) => setPaymentReference(e.target.value)} placeholder="From your bank receipt" />
        </div>
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. October payroll funding" />
        </div>
        <button type="submit" disabled={busy || !clientId || !amount || (selected && !selected.canFund)} className="btn-primary w-full">
          {busy ? 'Submitting…' : 'Submit payment'}
        </button>
      </form>
    </div>
  );
}

function SuperClientWallets({ clients, reload, setNotice, setError }) {
  const [fundFor, setFundFor] = useState(null);
  const total = clients.reduce((n, c) => n + (c.balance || 0), 0);

  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">Total in client wallets</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{naira(total)}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">Funding awaiting confirmation</p>
          <p className="text-2xl font-bold text-estrada-red mt-1">{clients.reduce((n, c) => n + c.pendingCount, 0)}</p>
        </div>
        <div className="card p-5">
          <p className="text-sm text-slate-500 dark:text-slate-400">Clients</p>
          <p className="text-2xl font-bold text-slate-900 dark:text-white mt-1">{clients.length}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2">Client</th>
                <th className="px-4 py-2">Wallet ID</th>
                <th className="px-4 py-2 text-right">Balance</th>
                <th className="px-4 py-2">Pending</th>
                <th className="px-4 py-2">Admins who can fund</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {clients.map((c) => (
                <tr key={c.clientId}>
                  <td className="px-4 py-2 font-medium text-slate-800 dark:text-white">{c.name}</td>
                  <td className="px-4 py-2 font-mono text-xs">{c.walletCode || '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold">{naira(c.balance)}</td>
                  <td className="px-4 py-2">{c.pendingCount ? `${c.pendingCount} · ${naira(c.pendingAmount)}` : '—'}</td>
                  <td className="px-4 py-2 text-xs text-slate-500">
                    {c.admins.filter((a) => a.canFund).map((a) => a.name).join(', ') || <span className="text-amber-600">No admin assigned</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <button onClick={() => setFundFor(c)} className="btn-secondary text-xs">Fund</button>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No clients yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {fundFor && (
        <DirectFundModal
          client={fundFor}
          onClose={() => setFundFor(null)}
          onDone={(msg) => { setNotice(msg); setError(''); setFundFor(null); reload(); }}
        />
      )}
    </div>
  );
}

function DirectFundModal({ client, onClose, onDone }) {
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/wallet/clients/${client.clientId}/fund`, { amount: Number(amount), note: note || undefined });
      onDone(`${client.name} wallet funded. New balance: ${naira(data.balance)}.`);
    } catch (err) {
      setError(errMsg(err, 'Could not fund the wallet.'));
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <form onSubmit={submit} className="card p-6 w-full max-w-sm space-y-4">
        <h2 className="font-bold text-slate-900 dark:text-white">Fund {client.name}</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Credits the client wallet immediately and is recorded in the audit trail.</p>
        {error && <div className="bg-red-50 dark:bg-red-900/30 text-red-600 text-sm px-3 py-2 rounded-lg">{error}</div>}
        <div>
          <label className="label">Amount (₦)</label>
          <input required autoFocus type="number" min="1" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancel</button>
          <button type="submit" disabled={busy || !amount} className="btn-primary flex-1">{busy ? 'Funding…' : 'Fund wallet'}</button>
        </div>
      </form>
    </div>
  );
}

function RequestsTable({ requests, isSuper, reload, setNotice, setError }) {
  const [busyId, setBusyId] = useState(null);

  async function act(id, action) {
    setBusyId(id);
    setError('');
    setNotice('');
    try {
      let body = {};
      if (action === 'reject') {
        const reason = window.prompt('Reason for rejecting (optional):') ?? null;
        if (reason === null) { setBusyId(null); return; }
        body = { reason: reason || undefined };
      }
      await api.post(`/wallet/funding-requests/${id}/${action}`, body);
      setNotice(action === 'confirm' ? 'Payment confirmed and client wallet funded.' : 'Funding request rejected.');
      reload();
    } catch (err) {
      setError(errMsg(err, 'Action failed.'));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="card overflow-hidden">
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800">
        <h2 className="font-semibold text-slate-800 dark:text-white">{isSuper ? 'Funding requests' : 'Your funding payments'}</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 dark:bg-slate-800/50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2">Date</th>
              <th className="px-4 py-2">Client</th>
              <th className="px-4 py-2">Reference</th>
              <th className="px-4 py-2 text-right">Amount</th>
              <th className="px-4 py-2">Reported by</th>
              <th className="px-4 py-2">Status</th>
              {isSuper && <th className="px-4 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {requests.map((r) => (
              <tr key={r.id}>
                <td className="px-4 py-2 whitespace-nowrap">{when(r.createdAt)}</td>
                <td className="px-4 py-2">{r.client?.name || '—'}</td>
                <td className="px-4 py-2 font-mono text-xs">
                  {r.reference}
                  {r.paymentReference && <span className="block text-slate-400">Bank ref: {r.paymentReference}</span>}
                </td>
                <td className="px-4 py-2 text-right font-medium">{naira(r.amount)}</td>
                <td className="px-4 py-2 text-xs">{r.requestedBy || '—'}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status === 'SUCCESS' ? 'SUCCESS' : r.status} />
                  {r.status === 'SUCCESS' && <span className="block text-[11px] text-slate-400 mt-0.5">Received</span>}
                </td>
                {isSuper && (
                  <td className="px-4 py-2 text-right whitespace-nowrap">
                    {r.status === 'PENDING' && (
                      <>
                        <button disabled={busyId === r.id} onClick={() => act(r.id, 'confirm')} className="btn-secondary text-xs mr-2">Confirm received</button>
                        <button disabled={busyId === r.id} onClick={() => act(r.id, 'reject')} className="btn-secondary text-xs text-red-600">Reject</button>
                      </>
                    )}
                  </td>
                )}
              </tr>
            ))}
            {requests.length === 0 && (
              <tr><td colSpan={isSuper ? 7 : 6} className="px-4 py-8 text-center text-slate-400">No funding activity yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ Notifications
function Notifications({ onChange }) {
  const [items, setItems] = useState(null);

  async function load() {
    const { data } = await api.get('/wallet/notifications');
    setItems(data.notifications);
    onChange(data.unreadCount);
  }
  useEffect(() => { load().catch(() => setItems([])); }, []); // eslint-disable-line

  async function markAll() {
    await api.post('/wallet/notifications/read', {});
    load();
  }

  if (items === null) return <p className="text-sm text-slate-400">Loading…</p>;

  return (
    <div className="card">
      <div className="px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
        <h2 className="font-semibold text-slate-800 dark:text-white">Notifications</h2>
        {items.some((n) => !n.isRead) && <button onClick={markAll} className="btn-secondary text-xs">Mark all read</button>}
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((n) => (
          <li key={n.id} className={`px-5 py-3 ${n.isRead ? '' : 'bg-orange-50/60 dark:bg-slate-800/40'}`}>
            <p className="text-sm font-medium text-slate-800 dark:text-white">{n.title}</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
            <p className="text-[11px] text-slate-400 mt-0.5">{when(n.createdAt)}</p>
          </li>
        ))}
        {items.length === 0 && <li className="px-5 py-8 text-center text-slate-400 text-sm">Nothing here yet.</li>}
      </ul>
    </div>
  );
}

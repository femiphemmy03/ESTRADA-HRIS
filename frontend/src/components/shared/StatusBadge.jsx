const COLORS = {
  ACTIVE: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  ONBOARDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ON_LEAVE: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  SUSPENDED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  EXITING: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300',
  EXITED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  PRESENT: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  LATE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  ABSENT: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  OVERTIME: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300',
  HALF_DAY: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  EARLY_DEPARTURE: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  MISSING_CHECKOUT: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  WEEKEND: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  PUBLIC_HOLIDAY: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400',
  PENDING: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  PENDING_MANAGER: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  PENDING_HR: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  APPROVED: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  REJECTED: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  CANCELLED: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  DRAFT: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  REVIEW: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  PAID: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
};

export default function StatusBadge({ status }) {
  const cls = COLORS[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
  return <span className={`badge ${cls}`}>{status?.replace(/_/g, ' ')}</span>;
}

import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: '🏠', roles: null },
  { to: '/employees', label: 'Employees', icon: '👥', roles: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'TEAM_LEAD'] },
  { to: '/onboarding', label: 'Onboarding', icon: '📋', roles: null },
  { to: '/documents', label: 'Documents', icon: '📁', roles: null },
  { to: '/attendance', label: 'Attendance', icon: '📍', roles: null },
  { to: '/leave', label: 'Leave', icon: '🌴', roles: null },
  { to: '/payroll', label: 'Payroll', icon: '💰', roles: ['SUPER_ADMIN', 'HR_ADMIN', 'PAYROLL_OFFICER', 'EMPLOYEE', 'TEAM_LEAD'] },
  { to: '/clients', label: 'Clients & Sites', icon: '🏢', roles: ['SUPER_ADMIN', 'HR_ADMIN', 'TEAM_LEAD'] },
  { to: '/exit', label: 'Exit Management', icon: '🚪', roles: ['SUPER_ADMIN', 'HR_ADMIN'] },
  { to: '/admin', label: 'Administration', icon: '⚙️', roles: ['SUPER_ADMIN', 'HR_ADMIN'] },
];

export default function Sidebar({ open, onClose }) {
  const { user } = useAuth();

  return (
    <>
      {open && <div className="fixed inset-0 bg-black/40 z-30 lg:hidden" onClick={onClose} />}
      <aside
        className={`fixed lg:static z-40 top-0 left-0 h-full w-64 bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 flex flex-col transition-transform ${
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="flex items-center gap-3 px-5 py-5 border-b border-slate-200 dark:border-slate-800">
          <img src="/estrada-logo.png" alt="Estrada International" className="h-9 w-auto" />
          <div>
            <p className="font-bold text-slate-900 dark:text-white leading-tight">ESTRADA</p>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">HRIS</p>
          </div>
        </div>
        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
          {NAV.filter((item) => !item.roles || item.roles.includes(user?.role)).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  isActive
                    ? 'bg-estrada-gradient text-white shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`
              }
            >
              <span>{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-4 border-t border-slate-200 dark:border-slate-800 text-xs text-slate-400">
          © {new Date().getFullYear()} Estrada International
        </div>
      </aside>
    </>
  );
}

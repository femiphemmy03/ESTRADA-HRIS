import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';

export default function Topbar({ onMenuClick }) {
  const { user, employee, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="h-16 flex items-center justify-between px-4 lg:px-6 border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur sticky top-0 z-20">
      <button className="lg:hidden text-slate-600 dark:text-slate-300" onClick={onMenuClick}>
        ☰
      </button>
      <div className="hidden lg:block text-sm text-slate-400">
        {employee?.client?.name ? `Assigned: ${employee.client.name}${employee.site?.name ? ' — ' + employee.site.name : ''}` : ''}
      </div>
      <div className="flex items-center gap-3">
        <button onClick={toggleTheme} className="h-9 w-9 rounded-full flex items-center justify-center bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
          {theme === 'dark' ? '☀️' : '🌙'}
        </button>
        <div className="relative">
          <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2">
            <div className="h-9 w-9 rounded-full bg-estrada-gradient text-white flex items-center justify-center font-semibold text-sm">
              {(employee?.firstName?.[0] || user?.email?.[0] || '?').toUpperCase()}
            </div>
          </button>
          {menuOpen && (
            <div className="absolute right-0 mt-2 w-48 card p-2 text-sm">
              <p className="px-2 py-1 font-medium text-slate-800 dark:text-slate-100 truncate">{employee ? `${employee.firstName} ${employee.lastName}` : user?.email}</p>
              <p className="px-2 pb-2 text-xs text-slate-400">{user?.role?.replace('_', ' ')}</p>
              <button onClick={logout} className="w-full text-left px-2 py-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-red-600">
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

import { Link } from 'react-router-dom';

export default function StatCard({ label, value, icon, accent = false, to }) {
  const content = (
    <div className={`card p-5 flex items-center justify-between ${to ? 'hover:border-estrada-orange/50 hover:shadow-md transition cursor-pointer' : ''}`}>
      <div>
        <p className="text-sm text-slate-500 dark:text-slate-400">{label}</p>
        <p className={`text-2xl font-bold mt-1 ${accent ? 'text-estrada-red' : 'text-slate-900 dark:text-white'}`}>{value}</p>
      </div>
      {icon && (
        <div className="h-11 w-11 rounded-lg bg-estrada-gradient flex items-center justify-center text-white text-lg">
          {icon}
        </div>
      )}
    </div>
  );

  return to ? <Link to={to}>{content}</Link> : content;
}

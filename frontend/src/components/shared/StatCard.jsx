export default function StatCard({ label, value, icon, accent = false }) {
  return (
    <div className="card p-5 flex items-center justify-between">
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
}

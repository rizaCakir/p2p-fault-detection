const STATS = [
  { key: 'critical', label: 'Critical Faults' },
  { key: 'faulted',  label: 'Faulted Nodes'  },
  { key: 'online',   label: 'Nodes Online'   },
  { key: 'total',    label: 'Total Nodes'    },
]

function statColor(key, value) {
  if (key === 'critical') return value > 0 ? 'var(--red)'    : 'var(--text-3)'
  if (key === 'faulted')  return value > 0 ? 'var(--orange)' : 'var(--text-3)'
  if (key === 'online')   return 'var(--green)'
  return 'var(--text-1)'
}

export default function StatBar({ total, online, faulted, critical }) {
  const values = { total, online, faulted, critical }
  return (
    <div className="stat-bar">
      {STATS.map(({ key, label }) => (
        <div key={key} className="stat-card">
          <div className="stat-value" style={{ color: statColor(key, values[key]) }}>
            {values[key]}
          </div>
          <div className="stat-label">{label}</div>
        </div>
      ))}
    </div>
  )
}

import { useState } from 'react'

const FAULT_ICON = {
  gas_warning:  '⚠️',
  gas_critical: '🔴',
  flame:        '🔥',
}

const SEV_COLOR = {
  CRITICAL: 'var(--red)',
  WARNING:  'var(--orange)',
}

const FILTERS = ['ALL', 'CRITICAL', 'WARNING']

export default function AlertFeed({ alerts }) {
  const [filter, setFilter] = useState('ALL')

  const critCount = alerts.filter(a => a.severity === 'CRITICAL').length
  const warnCount = alerts.filter(a => a.severity === 'WARNING').length

  const filtered = filter === 'ALL'
    ? alerts
    : alerts.filter(a => a.severity === filter)

  return (
    <div>
      <div className="alert-filters">
        {FILTERS.map(f => (
          <button
            key={f}
            className={`filter-btn ${filter === f ? 'active' : ''}`}
            onClick={() => setFilter(f)}
          >
            {f === 'CRITICAL' ? `Critical (${critCount})`
              : f === 'WARNING'  ? `Warning (${warnCount})`
              : `All (${alerts.length})`}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="alert-empty">No alerts match the current filter.</div>
      ) : (
        <div className="alert-scroll">
          {filtered.map((a, i) => (
            <div key={a.event_id ?? i} className="alert-item">
              <span className="alert-icon">{FAULT_ICON[a.fault_type] ?? '⚠️'}</span>
              <div className="alert-body">
                <div className="alert-header">
                  <span className="alert-node">{a.node_id}</span>
                  <span
                    className="alert-severity"
                    style={{ background: SEV_COLOR[a.severity] ?? 'var(--text-3)' }}
                  >
                    {a.severity}
                  </span>
                </div>
                <div className="alert-detail">
                  {a.fault_type} &nbsp;·&nbsp; val={a.value} &nbsp;·&nbsp; zone: {a.zone_id}
                </div>
                <div className="alert-time">{new Date(a.timestamp).toLocaleString()}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

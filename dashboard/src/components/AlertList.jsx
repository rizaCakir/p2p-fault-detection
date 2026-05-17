import { useState } from 'react'

const ICONS = {
  gas_critical: '🔴',
  gas_warning:  '🟡',
  flame:        '🔥',
}

export default function AlertList({ alerts }) {
  const [filter, setFilter] = useState('ALL')

  const visible = filter === 'ALL' ? alerts
    : alerts.filter(a => a.severity === filter)

  return (
    <>
      <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
        {['ALL', 'CRITICAL', 'WARNING'].map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '3px 10px', borderRadius: 4, fontSize: 10,
              fontWeight: 700, letterSpacing: '.06em',
              border: '1px solid',
              borderColor: filter === f ? 'var(--blue)' : 'var(--border)',
              background: filter === f ? 'var(--blue-bg)' : 'var(--surface2)',
              color: filter === f ? 'var(--blue)' : 'var(--text-2)',
              cursor: 'pointer', fontFamily: 'system-ui, sans-serif',
            }}
          >{f}</button>
        ))}
      </div>

      <div className="alert-list">
        {visible.length === 0
          ? <div className="alert-empty">no alerts</div>
          : visible.map(a => (
            <div key={a.event_id} className="alert-row">
              <div className="alert-icon">{ICONS[a.fault_type] ?? '⚠️'}</div>
              <div className="alert-body">
                <div className="alert-top">
                  <span className="alert-node">{a.node_id}</span>
                  <span className={`alert-sev ${a.severity === 'CRITICAL' ? 'sev-critical' : 'sev-warning'}`}>
                    {a.severity}
                  </span>
                </div>
                <div className="alert-detail">
                  {a.fault_type.replace(/_/g, ' ')} · val={a.value} · {a.zone_id}
                </div>
                <div className="alert-time">{new Date(a.timestamp).toLocaleString()}</div>
              </div>
            </div>
          ))
        }
      </div>
    </>
  )
}

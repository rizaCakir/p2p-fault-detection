const SEVERITY_COLOR = { CRITICAL: '#dc2626', WARNING: '#ea580c' }
const FAULT_ICON     = { gas_warning: '⚠️', gas_critical: '🔴', flame: '🔥' }

export default function AlertFeed({ alerts }) {
  if (alerts.length === 0) {
    return (
      <div style={{ color: '#94a3b8', textAlign: 'center', padding: '32px 0', fontSize: 14 }}>
        No alerts yet
      </div>
    )
  }

  return (
    <div style={{ maxHeight: 420, overflowY: 'auto' }}>
      {alerts.map((a, i) => (
        <div key={a.event_id ?? i} style={{
          display: 'flex',
          gap: 12,
          padding: '10px 0',
          borderBottom: '1px solid #e2e8f0',
          alignItems: 'flex-start',
        }}>
          <span style={{ fontSize: 22, lineHeight: 1 }}>
            {FAULT_ICON[a.fault_type] ?? '⚠️'}
          </span>

          <div style={{ flex: 1 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontWeight: 700, fontSize: 13 }}>{a.node_id}</span>
              <span style={{
                fontSize: 10,
                fontWeight: 700,
                color: '#fff',
                background: SEVERITY_COLOR[a.severity] ?? '#64748b',
                padding: '1px 7px',
                borderRadius: 999,
                letterSpacing: '0.05em',
              }}>
                {a.severity}
              </span>
            </div>
            <div style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>
              {a.fault_type}  ·  val={a.value}  ·  zone: {a.zone_id}
            </div>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 1 }}>
              {new Date(a.timestamp).toLocaleString()}
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

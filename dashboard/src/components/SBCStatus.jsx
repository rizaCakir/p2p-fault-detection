const OFFLINE_THRESHOLD_MS = 90_000  // consider offline after 90 s with no heartbeat

export default function SBCStatus({ sbcStatus }) {
  const sbcs = Object.values(sbcStatus)

  if (sbcs.length === 0) {
    return (
      <div style={{ color: '#94a3b8', fontSize: 13 }}>
        Waiting for SBC heartbeats…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {sbcs.map(sbc => {
        const age    = Date.now() - new Date(sbc.timestamp).getTime()
        const online = age < OFFLINE_THRESHOLD_MS
        const color  = online ? '#16a34a' : '#dc2626'
        return (
          <div key={sbc.node_id} style={{
            border: `2px solid ${color}`,
            borderRadius: 8,
            padding: '8px 16px',
            background: online ? '#f0fdf4' : '#fef2f2',
            minWidth: 130,
          }}>
            <div style={{ fontWeight: 700, fontSize: 14 }}>{sbc.node_id}</div>
            <div style={{ color, fontSize: 12, fontWeight: 600, marginTop: 2 }}>
              {online ? '● Online' : '○ Offline'}
            </div>
            <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 4 }}>
              Last: {new Date(sbc.timestamp).toLocaleTimeString()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

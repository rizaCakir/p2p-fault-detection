const OFFLINE_MS = 90_000

export default function SBCStatus({ sbcStatus }) {
  const sbcs = Object.values(sbcStatus)

  if (sbcs.length === 0) {
    return <p style={{ color: 'var(--text-3)', fontSize: 13 }}>Waiting for SBC heartbeats…</p>
  }

  return (
    <div className="sbc-grid">
      {sbcs.map(sbc => {
        const ts     = sbc.timestamp ?? sbc.last_seen
        const online = Date.now() - new Date(ts).getTime() < OFFLINE_MS
        return (
          <div
            key={sbc.node_id}
            className="sbc-card"
            style={{
              borderColor: online ? 'var(--green)' : 'var(--red)',
              background:  online ? 'var(--green-bg)' : 'var(--red-bg)',
            }}
          >
            <div className="sbc-name">{sbc.node_id}</div>
            <div className="sbc-status" style={{ color: online ? 'var(--green)' : 'var(--red)' }}>
              {online ? '● Online' : '○ Offline'}
            </div>
            <div className="sbc-time">
              Last seen: {new Date(ts).toLocaleTimeString()}
            </div>
          </div>
        )
      })}
    </div>
  )
}

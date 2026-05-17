const OFFLINE_MS = 90_000

export default function SBCRow({ sbcStatus }) {
  const sbcs = Object.values(sbcStatus)

  if (sbcs.length === 0) {
    return <p style={{ color: 'var(--text-3)', fontSize: 12 }}>No SBC heartbeats yet…</p>
  }

  return (
    <div className="sbc-row">
      {sbcs.map(s => {
        const online = Date.now() - new Date(s.last_seen).getTime() < OFFLINE_MS
        return (
          <div key={s.node_id} className={`sbc-card ${online ? 'online' : 'offline'}`}>
            <div className="sbc-id">{s.node_id}</div>
            <div className="sbc-status" style={{ color: online ? 'var(--green)' : 'var(--red)' }}>
              {online ? '● online' : '○ offline'}
            </div>
            <div className="sbc-time">{new Date(s.last_seen).toLocaleTimeString()}</div>
          </div>
        )
      })}
    </div>
  )
}

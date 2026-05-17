import { useEffect, useState } from 'react'

const STATE_CFG = {
  IDLE:              { label: 'Normal',     color: 'var(--green)',  bg: 'var(--green-bg)' },
  FAULT_DETECTED:    { label: 'FAULT',      color: 'var(--red)',    bg: 'var(--red-bg)'   },
  PEER_ALARM_ACTIVE: { label: 'PEER ALARM', color: 'var(--orange)', bg: 'var(--orange-bg)' },
}

export default function NodeCard({ node }) {
  const [blink, setBlink] = useState(false)
  const cfg     = STATE_CFG[node.state] ?? STATE_CFG.IDLE
  const faulted = node.state !== 'IDLE'

  useEffect(() => {
    if (!faulted) { setBlink(false); return }
    const t = setInterval(() => setBlink(b => !b), 600)
    return () => clearInterval(t)
  }, [faulted])

  return (
    <div
      className="node-card"
      style={{
        borderColor: cfg.color,
        background:  faulted && blink ? 'var(--red-bg)' : cfg.bg,
      }}
    >
      <div className="node-name">{node.node_id}</div>
      <div className="node-zone">{node.zone_id}</div>

      <span className="node-badge" style={{ background: cfg.color }}>
        {cfg.label}
      </span>

      <div className="node-gas">
        Gas: <strong>{node.gas_val}</strong>
        <span>/ 4095 ADC</span>
      </div>

      <div className="node-online" style={{ color: node.online ? 'var(--green)' : 'var(--red)' }}>
        {node.online ? '● Online' : '○ Offline'}
      </div>

      <div className="node-time">
        {new Date(node.last_seen).toLocaleTimeString()}
      </div>
    </div>
  )
}

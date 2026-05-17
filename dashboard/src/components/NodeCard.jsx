import { useEffect, useState } from 'react'

const STATE_CONFIG = {
  IDLE:              { label: 'Normal',     color: '#16a34a', bg: '#f0fdf4' },
  FAULT_DETECTED:    { label: 'FAULT',      color: '#dc2626', bg: '#fef2f2' },
  PEER_ALARM_ACTIVE: { label: 'PEER ALARM', color: '#ea580c', bg: '#fff7ed' },
}

export default function NodeCard({ node }) {
  const [blink, setBlink] = useState(false)
  const cfg = STATE_CONFIG[node.state] ?? STATE_CONFIG.IDLE
  const faulted = node.state !== 'IDLE'

  useEffect(() => {
    if (!faulted) { setBlink(false); return }
    const t = setInterval(() => setBlink(b => !b), 600)
    return () => clearInterval(t)
  }, [faulted])

  const cardBg = faulted && blink ? '#fee2e2' : cfg.bg

  return (
    <div style={{
      border: `2px solid ${cfg.color}`,
      borderRadius: 10,
      padding: '14px 18px',
      background: cardBg,
      minWidth: 170,
      transition: 'background 0.25s',
    }}>
      <div style={{ fontWeight: 700, fontSize: 15 }}>{node.node_id}</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>
        {node.zone_id}
      </div>

      <span style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 999,
        background: cfg.color,
        color: '#fff',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.04em',
      }}>
        {cfg.label}
      </span>

      <div style={{ marginTop: 10, fontSize: 13 }}>
        Gas: <strong>{node.gas_val}</strong>
        <span style={{ color: '#94a3b8', marginLeft: 4 }}>/ 4095 ADC</span>
      </div>

      <div style={{
        marginTop: 4,
        fontSize: 11,
        color: node.online ? '#16a34a' : '#dc2626',
        fontWeight: 600,
      }}>
        {node.online ? '● Online' : '○ Offline'}
      </div>

      <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>
        {new Date(node.last_seen).toLocaleTimeString()}
      </div>
    </div>
  )
}

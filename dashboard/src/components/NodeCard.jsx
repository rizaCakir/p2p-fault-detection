import { useEffect, useState } from 'react'

export default function NodeCard({ node }) {
  const [blink, setBlink] = useState(false)
  const fault = node.state === 'FAULT_DETECTED'
  const peer  = node.state === 'PEER_ALARM_ACTIVE'

  useEffect(() => {
    if (!fault && !peer) { setBlink(false); return }
    const t = setInterval(() => setBlink(b => !b), 600)
    return () => clearInterval(t)
  }, [fault, peer])

  const badgeClass = fault ? 'badge-fault' : peer ? 'badge-peer' : 'badge-idle'
  const badgeLabel = fault ? 'FAULT' : peer ? 'PEER ALARM' : 'NORMAL'
  const cardClass  = ['node-card', fault ? 'fault' : peer ? 'peer' : '', blink ? 'blink' : '']
    .filter(Boolean).join(' ')

  const statusColor = node.online ? 'var(--green)' : 'var(--red)'

  return (
    <div className={cardClass}>
      <div className="node-id">{node.node_id}</div>
      <div className="node-zone">{node.zone_id}</div>
      <span className={`node-badge ${badgeClass}`}>{badgeLabel}</span>
      <div className="node-gas">
        Gas: <strong>{node.gas_val}</strong>
        <span className="unit">ADC</span>
      </div>
      <div className="node-status" style={{ color: statusColor }}>
        {node.online ? '● online' : '○ offline'}
      </div>
      <div className="node-time">
        {new Date(node.last_seen).toLocaleTimeString()}
      </div>
    </div>
  )
}

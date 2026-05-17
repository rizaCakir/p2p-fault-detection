import { useEffect, useCallback } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { useWebSocket }        from './hooks/useWebSocket'
import StatBar      from './components/StatBar'
import SBCStatus    from './components/SBCStatus'
import NodeCard     from './components/NodeCard'
import GasChart     from './components/GasChart'
import AlertFeed    from './components/AlertFeed'
import AlertHistory from './components/AlertHistory'

const API    = '/api/v1'
const WS_URL = `ws://${location.host}/ws/realtime`

function Dashboard() {
  const { state, dispatch } = useApp()

  // ── Initial REST fetches ─────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API}/nodes/status`)
      .then(r => r.ok ? r.json() : [])
      .then(nodes => dispatch({ type: 'SET_NODES', payload: nodes }))
      .catch(console.error)

    fetch(`${API}/alerts/history?limit=100`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(body => dispatch({ type: 'SET_ALERTS', payload: body.data ?? [] }))
      .catch(console.error)

    fetch(`${API}/sbc/status`)
      .then(r => r.ok ? r.json() : [])
      .then(sbcs => dispatch({ type: 'SET_SBC_STATUSES', payload: sbcs }))
      .catch(console.error)
  }, [dispatch])

  // ── WebSocket handler ────────────────────────────────────────────────
  const onMessage = useCallback(msg => {
    switch (msg.type) {
      case 'telemetry':    dispatch({ type: 'UPDATE_NODE', payload: msg.payload }); break
      case 'alert':        dispatch({ type: 'ADD_ALERT',   payload: msg.payload }); break
      case 'sbc_heartbeat':dispatch({ type: 'UPDATE_SBC',  payload: msg.payload }); break
    }
  }, [dispatch])

  const connected = useWebSocket(WS_URL, onMessage)

  // ── Derived counts ───────────────────────────────────────────────────
  const onlineNodes    = state.nodes.filter(n => n.online)
  const faultedNodes   = state.nodes.filter(n => n.state !== 'IDLE')
  const criticalCount  = state.activeAlerts.filter(a => a.severity === 'CRITICAL').length

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div className="layout">

      {/* Header */}
      <header className="header">
        <div>
          <h1 className="header-title">P2P Fault Detection</h1>
          <p className="header-sub">Decentralized industrial monitoring · real-time</p>
        </div>
        <div className="header-right">
          {criticalCount > 0 && (
            <span className="crit-banner pulse">
              {criticalCount} CRITICAL
            </span>
          )}
          <span className={`ws-badge ${connected ? 'connected' : 'disconnected'}`}>
            <span className="ws-dot" />
            {connected ? 'Live' : 'Reconnecting…'}
          </span>
        </div>
      </header>

      {/* Summary stats */}
      <StatBar
        total={state.nodes.length}
        online={onlineNodes.length}
        faulted={faultedNodes.length}
        critical={criticalCount}
      />

      {/* SBC gateway cluster */}
      <section className="section">
        <h2 className="section-title">Gateway Cluster · SBC Redundancy</h2>
        <SBCStatus sbcStatus={state.sbcStatus} />
      </section>

      {/* Sensor node grid */}
      <section className="section">
        <h2 className="section-title">
          Sensor Nodes · {state.nodes.length} known, {faultedNodes.length} faulted
        </h2>
        {state.nodes.length === 0 ? (
          <p style={{ color: 'var(--text-3)', fontSize: 13 }}>
            Waiting for telemetry…
          </p>
        ) : (
          <div className="node-grid">
            {state.nodes.map(n => <NodeCard key={n.node_id} node={n} />)}
          </div>
        )}
      </section>

      {/* Gas concentration trend charts (faulted nodes only) */}
      {faultedNodes.length > 0 && (
        <section className="section">
          <h2 className="section-title">Gas Concentration Trends</h2>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))',
            gap: 20,
          }}>
            {faultedNodes.map(n => (
              <GasChart key={n.node_id} nodeId={n.node_id} />
            ))}
          </div>
        </section>
      )}

      {/* Live alert feed */}
      <section className="section">
        <h2 className="section-title">
          Live Alert Feed · last {state.activeAlerts.length}
        </h2>
        <AlertFeed alerts={state.activeAlerts} />
      </section>

      {/* Paginated, filterable alert history */}
      <section className="section">
        <h2 className="section-title">Alert History</h2>
        <AlertHistory />
      </section>

    </div>
  )
}

export default function App() {
  return (
    <AppProvider>
      <Dashboard />
    </AppProvider>
  )
}

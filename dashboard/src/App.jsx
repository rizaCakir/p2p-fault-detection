import { useEffect, useCallback } from 'react'
import { AppProvider, useApp } from './context/AppContext'
import { useWebSocket } from './hooks/useWebSocket'
import NodeCard   from './components/NodeCard'
import AlertFeed  from './components/AlertFeed'
import GasChart   from './components/GasChart'
import SBCStatus  from './components/SBCStatus'

const API_BASE = '/api/v1'
const WS_URL   = `ws://${location.host}/ws/realtime`

function Dashboard() {
  const { state, dispatch } = useApp()

  // ── Initial data load ────────────────────────────────────────────────
  useEffect(() => {
    fetch(`${API_BASE}/nodes/status`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(nodes => dispatch({ type: 'SET_NODES', payload: nodes }))
      .catch(err => console.error('[API] nodes/status:', err))

    fetch(`${API_BASE}/alerts/history?limit=100`)
      .then(r => r.ok ? r.json() : Promise.reject(r.status))
      .then(body => dispatch({ type: 'SET_ALERTS', payload: body.data ?? [] }))
      .catch(err => console.error('[API] alerts/history:', err))
  }, [dispatch])

  // ── WebSocket handler ────────────────────────────────────────────────
  const onMessage = useCallback((msg) => {
    switch (msg.type) {
      case 'telemetry':
        dispatch({ type: 'UPDATE_NODE',  payload: msg.payload })
        break
      case 'alert':
        dispatch({ type: 'ADD_ALERT',    payload: msg.payload })
        break
      case 'sbc_heartbeat':
        dispatch({ type: 'UPDATE_SBC',   payload: msg.payload })
        break
    }
  }, [dispatch])

  useWebSocket(WS_URL, onMessage)

  // ── Derived ──────────────────────────────────────────────────────────
  const faultedNodes = state.nodes.filter(n => n.state !== 'IDLE')
  const criticalCount = state.activeAlerts.filter(a => a.severity === 'CRITICAL').length

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '24px 16px' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.02em' }}>
            P2P Fault Detection
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', marginTop: 2 }}>
            Decentralized industrial monitoring — real-time
          </p>
        </div>
        {criticalCount > 0 && (
          <div style={{
            background: '#dc2626', color: '#fff',
            padding: '6px 16px', borderRadius: 999,
            fontWeight: 700, fontSize: 13, letterSpacing: '0.04em',
            animation: 'pulse 1s infinite',
          }}>
            {criticalCount} CRITICAL ACTIVE
          </div>
        )}
      </div>

      {/* ── SBC Gateway Cluster ── */}
      <Section title="Gateway Cluster (SBC Redundancy)">
        <SBCStatus sbcStatus={state.sbcStatus} />
      </Section>

      {/* ── Node Grid ── */}
      <Section title={`Sensor Nodes (${state.nodes.length} known, ${faultedNodes.length} faulted)`}>
        {state.nodes.length === 0 ? (
          <p style={{ color: '#94a3b8', fontSize: 13 }}>
            No nodes reported yet — waiting for telemetry…
          </p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14 }}>
            {state.nodes.map(n => <NodeCard key={n.node_id} node={n} />)}
          </div>
        )}
      </Section>

      {/* ── Gas charts for faulted / recently active nodes ── */}
      {faultedNodes.length > 0 && (
        <Section title="Gas Concentration Trends">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
            {faultedNodes.map(n => (
              <GasChart key={n.node_id} alerts={state.activeAlerts} nodeId={n.node_id} />
            ))}
          </div>
        </Section>
      )}

      {/* ── Alert Feed ── */}
      <Section title={`Alert Feed (last ${state.activeAlerts.length})`}>
        <AlertFeed alerts={state.activeAlerts} />
      </Section>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.6} }
      `}</style>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #e2e8f0',
      borderRadius: 12,
      padding: '18px 20px',
      marginBottom: 20,
      boxShadow: '0 1px 3px rgba(0,0,0,0.05)',
    }}>
      <h2 style={{ fontSize: 14, fontWeight: 700, color: '#475569', marginBottom: 14, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {title}
      </h2>
      {children}
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

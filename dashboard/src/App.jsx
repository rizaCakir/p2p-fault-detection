import { useCallback, useEffect, useReducer } from 'react'
import { useWebSocket } from './hooks/useWebSocket'
import NodeCard      from './components/NodeCard'
import SBCRow        from './components/SBCRow'
import AlertList     from './components/AlertList'
import GasChart      from './components/GasChart'
import AlertHistory  from './components/AlertHistory'

const API    = '/api/v1'
const WS_URL = `ws://${location.host}/ws/realtime`

// ── Reducer ───────────────────────────────────────────────────────────

const init = { nodes: [], alerts: [], sbcStatus: {} }

function reducer(state, action) {
  switch (action.type) {
    case 'SET_NODES':   return { ...state, nodes: action.payload }
    case 'SET_ALERTS':  return { ...state, alerts: action.payload }
    case 'SET_SBCS':    return { ...state, sbcStatus: action.payload }
    case 'UPD_NODE': {
      const p = action.payload
      const idx = state.nodes.findIndex(n => n.node_id === p.node_id)
      const nodes = idx >= 0
        ? state.nodes.map((n, i) => i === idx ? { ...n, ...p } : n)
        : [...state.nodes, p]
      return { ...state, nodes }
    }
    case 'ADD_ALERT':
      return { ...state, alerts: [action.payload, ...state.alerts].slice(0, 200) }
    case 'UPD_SBC':
      return {
        ...state,
        sbcStatus: { ...state.sbcStatus, [action.payload.node_id]: action.payload },
      }
    default: return state
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────

export default function App() {
  const [state, dispatch] = useReducer(reducer, init)

  useEffect(() => {
    fetch(`${API}/nodes/status`)
      .then(r => r.ok ? r.json() : [])
      .then(d => dispatch({ type: 'SET_NODES', payload: d }))
      .catch(() => {})

    fetch(`${API}/alerts/history?limit=100`)
      .then(r => r.ok ? r.json() : { data: [] })
      .then(d => dispatch({ type: 'SET_ALERTS', payload: d.data ?? [] }))
      .catch(() => {})

    fetch(`${API}/sbc/status`)
      .then(r => r.ok ? r.json() : [])
      .then(arr => {
        const map = Object.fromEntries(arr.map(s => [s.node_id, s]))
        dispatch({ type: 'SET_SBCS', payload: map })
      })
      .catch(() => {})
  }, [])

  const onWsMessage = useCallback(msg => {
    switch (msg.type) {
      case 'telemetry':     dispatch({ type: 'UPD_NODE',  payload: msg.payload }); break
      case 'alert':         dispatch({ type: 'ADD_ALERT', payload: msg.payload }); break
      case 'sbc_heartbeat': dispatch({ type: 'UPD_SBC',   payload: msg.payload }); break
    }
  }, [])

  const connected   = useWebSocket(WS_URL, onWsMessage)
  const faulted     = state.nodes.filter(n => n.state !== 'IDLE')
  const critCount   = state.alerts.filter(a => a.severity === 'CRITICAL').length
  const onlineCount = state.nodes.filter(n => n.online).length

  return (
    <div className="layout">

      {/* ── Header ─────────────────────────────────────────── */}
      <header className="header">
        <div className="header-left">
          <div className="header-title">P2P Fault Detection</div>
          <div className="header-sub">BBM460 · decentralized IoT monitoring · {new Date().toLocaleDateString()}</div>
        </div>
        <div className="header-right">
          {critCount > 0 && (
            <span className="crit-banner pulse">{critCount} CRITICAL</span>
          )}
          <span className={`ws-badge ${connected ? 'ok' : 'fail'}`}>
            <span className="ws-dot" />
            {connected ? 'live' : 'reconnecting…'}
          </span>
        </div>
      </header>

      {/* ── Stats ──────────────────────────────────────────── */}
      <div className="stat-row">
        {[
          { num: state.nodes.length, label: 'total nodes',    color: 'var(--text-1)' },
          { num: onlineCount,        label: 'online',          color: 'var(--green)'  },
          { num: faulted.length,     label: 'faulted',         color: faulted.length  ? 'var(--red)'    : 'var(--text-1)' },
          { num: critCount,          label: 'critical alerts', color: critCount        ? 'var(--red)'    : 'var(--text-1)' },
        ].map(s => (
          <div key={s.label} className="stat-card">
            <div className="stat-num" style={{ color: s.color }}>{s.num}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </div>

      {/* ── SBC cluster ────────────────────────────────────── */}
      <div className="card">
        <div className="card-title">gateway cluster · SBC redundancy</div>
        <SBCRow sbcStatus={state.sbcStatus} />
      </div>

      {/* ── Node grid + live alerts (side by side) ─────────── */}
      <div className="two-col">
        <div className="card">
          <div className="card-title">
            sensor nodes · {state.nodes.length} known · {faulted.length} faulted
          </div>
          {state.nodes.length === 0
            ? <p style={{ color: 'var(--text-3)', fontSize: 12, fontFamily: 'system-ui' }}>
                waiting for telemetry…
              </p>
            : <div className="node-grid">
                {state.nodes.map(n => <NodeCard key={n.node_id} node={n} />)}
              </div>
          }
        </div>

        <div className="card">
          <div className="card-title">live alert feed · last {state.alerts.length}</div>
          <AlertList alerts={state.alerts} />
        </div>
      </div>

      {/* ── Gas charts (faulted nodes only) ────────────────── */}
      {faulted.length > 0 && (
        <div className="card">
          <div className="card-title">gas concentration trend · faulted nodes</div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
            gap: 20,
          }}>
            {faulted.map(n => <GasChart key={n.node_id} nodeId={n.node_id} />)}
          </div>
        </div>
      )}

      {/* ── Alert history ───────────────────────────────────── */}
      <div className="card">
        <div className="card-title">alert history</div>
        <AlertHistory />
      </div>

    </div>
  )
}

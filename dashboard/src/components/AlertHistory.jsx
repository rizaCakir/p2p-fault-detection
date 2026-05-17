import { useEffect, useState } from 'react'

const PAGE_SIZE = 20

const SEV_COLOR = {
  CRITICAL: 'var(--red)',
  WARNING:  'var(--orange)',
}

export default function AlertHistory() {
  const [alerts,       setAlerts]       = useState([])
  const [total,        setTotal]        = useState(0)
  const [page,         setPage]         = useState(0)
  const [severity,     setSeverity]     = useState('')
  const [nodeIdInput,  setNodeIdInput]  = useState('')
  const [nodeId,       setNodeId]       = useState('')   // debounced
  const [loading,      setLoading]      = useState(true)

  // Debounce the node ID text input by 400 ms
  useEffect(() => {
    const t = setTimeout(() => { setNodeId(nodeIdInput.trim()); setPage(0) }, 400)
    return () => clearTimeout(t)
  }, [nodeIdInput])

  // Fetch whenever page, severity, or nodeId (debounced) changes
  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
    if (severity) params.set('severity', severity)
    if (nodeId)   params.set('node_id',  nodeId)

    fetch(`/api/v1/alerts/history?${params}`)
      .then(r => r.ok ? r.json() : { data: [], total: 0 })
      .then(body => { setAlerts(body.data ?? []); setTotal(body.total ?? 0) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [page, severity, nodeId])

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  function onSeverityChange(e) {
    setSeverity(e.target.value)
    setPage(0)
  }

  return (
    <div>
      {/* Controls */}
      <div className="history-controls">
        <input
          className="history-input"
          placeholder="Filter by node ID…"
          value={nodeIdInput}
          onChange={e => setNodeIdInput(e.target.value)}
          style={{ minWidth: 170 }}
        />
        <select className="history-input" value={severity} onChange={onSeverityChange}>
          <option value="">All severities</option>
          <option value="WARNING">WARNING</option>
          <option value="CRITICAL">CRITICAL</option>
        </select>
        <span className="page-info" style={{ marginLeft: 'auto' }}>
          {total.toLocaleString()} event{total !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Table */}
      {loading ? (
        <p className="gas-loading">Loading…</p>
      ) : alerts.length === 0 ? (
        <p className="history-empty">No events match the current filters.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="history-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Node</th>
                <th>Zone</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {alerts.map(a => (
                <tr key={a.event_id}>
                  <td style={{ color: 'var(--text-2)', fontSize: 12, whiteSpace: 'nowrap' }}>
                    {new Date(a.timestamp).toLocaleString()}
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.node_id}</td>
                  <td style={{ color: 'var(--text-2)' }}>{a.zone_id}</td>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{a.fault_type}</td>
                  <td>
                    <span
                      className="alert-severity"
                      style={{ background: SEV_COLOR[a.severity] ?? 'var(--text-3)' }}
                    >
                      {a.severity}
                    </span>
                  </td>
                  <td style={{ fontWeight: 600 }}>{a.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="pagination">
          <button className="page-btn" onClick={() => setPage(0)}              disabled={page === 0}>«</button>
          <button className="page-btn" onClick={() => setPage(p => p - 1)}    disabled={page === 0}>‹</button>
          <span className="page-info">Page {page + 1} of {totalPages}</span>
          <button className="page-btn" onClick={() => setPage(p => p + 1)}    disabled={page >= totalPages - 1}>›</button>
          <button className="page-btn" onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}>»</button>
        </div>
      )}
    </div>
  )
}

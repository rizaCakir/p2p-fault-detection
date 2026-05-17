import { useEffect, useState } from 'react'

const API = '/api/v1'
const PAGE = 20

export default function AlertHistory() {
  const [rows, setRows]       = useState([])
  const [total, setTotal]     = useState(0)
  const [page, setPage]       = useState(0)
  const [nodeId, setNodeId]   = useState('')
  const [severity, setSev]    = useState('')

  useEffect(() => {
    const params = new URLSearchParams({
      limit:  PAGE,
      offset: page * PAGE,
      ...(nodeId   ? { node_id:  nodeId }   : {}),
      ...(severity ? { severity: severity } : {}),
    })
    fetch(`${API}/alerts/history?${params}`)
      .then(r => r.ok ? r.json() : { data: [], total: 0 })
      .then(body => { setRows(body.data ?? []); setTotal(body.total ?? 0) })
      .catch(() => {})
  }, [page, nodeId, severity])

  const pages = Math.ceil(total / PAGE)

  return (
    <>
      <div className="hist-filters">
        <input
          className="hist-input" placeholder="node id…" value={nodeId}
          onChange={e => { setNodeId(e.target.value); setPage(0) }}
          style={{ width: 110 }}
        />
        <select
          className="hist-select" value={severity}
          onChange={e => { setSev(e.target.value); setPage(0) }}
        >
          <option value="">all severity</option>
          <option value="CRITICAL">CRITICAL</option>
          <option value="WARNING">WARNING</option>
        </select>
        <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 11, fontFamily: 'system-ui' }}>
          {total} total
        </span>
      </div>

      {rows.length === 0
        ? <div className="hist-empty">no records</div>
        : (
          <table className="hist-table">
            <thead>
              <tr>
                <th>Node</th>
                <th>Zone</th>
                <th>Type</th>
                <th>Severity</th>
                <th>Value</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.event_id}>
                  <td>{r.node_id}</td>
                  <td>{r.zone_id}</td>
                  <td>{r.fault_type}</td>
                  <td style={{ color: r.severity === 'CRITICAL' ? 'var(--red)' : 'var(--orange)' }}>
                    {r.severity}
                  </td>
                  <td>{r.value}</td>
                  <td>{new Date(r.timestamp).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      }

      {pages > 1 && (
        <div className="pagination">
          <button className="page-btn" disabled={page === 0} onClick={() => setPage(p => p - 1)}>
            ‹ prev
          </button>
          <span className="page-info">{page + 1} / {pages}</span>
          <button className="page-btn" disabled={page >= pages - 1} onClick={() => setPage(p => p + 1)}>
            next ›
          </button>
        </div>
      )}
    </>
  )
}

import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'

const GAS_WARN = 1500
const GAS_CRIT = 2500
const POLL_MS  = 10_000

function fetchHistory(nodeId) {
  return fetch(`/api/v1/nodes/${encodeURIComponent(nodeId)}/gas-history?limit=60`)
    .then(r => r.ok ? r.json() : [])
    .then(logs =>
      // API returns newest-first; reverse so chart reads left → right
      [...logs].reverse().map(l => ({
        t:   new Date(l.timestamp).toLocaleTimeString(),
        val: l.gas_val,
      }))
    )
}

export default function GasChart({ nodeId }) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    function load() {
      fetchHistory(nodeId)
        .then(rows => { if (!cancelled) { setData(rows); setLoading(false) } })
        .catch(()  => { if (!cancelled) setLoading(false) })
    }

    setLoading(true)
    load()
    const id = setInterval(load, POLL_MS)
    return () => { cancelled = true; clearInterval(id) }
  }, [nodeId])

  if (loading) return <p className="gas-loading">Loading gas history…</p>
  if (data.length === 0) return <p className="gas-loading">No gas data for {nodeId} yet.</p>

  return (
    <div>
      <div className="gas-chart-title">Gas Concentration — {nodeId}</div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="t"
            tick={{ fontSize: 10, fill: 'var(--text-3)' }}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[0, 4095]}
            tick={{ fontSize: 10, fill: 'var(--text-3)' }}
            width={38}
          />
          <Tooltip
            formatter={v => [v, 'ADC value']}
            contentStyle={{ fontSize: 12, borderColor: 'var(--border)' }}
          />
          <ReferenceLine
            y={GAS_WARN} stroke="var(--orange)" strokeDasharray="5 3"
            label={{ value: 'WARN', position: 'insideTopRight', fontSize: 10, fill: 'var(--orange)' }}
          />
          <ReferenceLine
            y={GAS_CRIT} stroke="var(--red)" strokeDasharray="5 3"
            label={{ value: 'CRIT', position: 'insideTopRight', fontSize: 10, fill: 'var(--red)' }}
          />
          <Line
            type="monotone" dataKey="val" name="Gas (ADC)"
            stroke="var(--blue)" strokeWidth={2}
            dot={false} activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

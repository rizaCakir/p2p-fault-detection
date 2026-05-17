import { useEffect, useState } from 'react'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer,
} from 'recharts'

const API = '/api/v1'

export default function GasChart({ nodeId }) {
  const [data, setData] = useState([])

  useEffect(() => {
    if (!nodeId) return
    fetch(`${API}/nodes/${nodeId}/gas-history?limit=60`)
      .then(r => r.ok ? r.json() : [])
      .then(rows => setData(rows.map(r => ({
        t:   new Date(r.timestamp).toLocaleTimeString(),
        gas: r.gas_val,
      }))))
      .catch(() => {})
  }, [nodeId])

  if (!nodeId) return null

  return (
    <>
      <div className="chart-node">{nodeId} — gas ADC</div>
      {data.length === 0
        ? <div className="chart-loading">loading…</div>
        : (
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#30363d" />
              <XAxis dataKey="t" tick={{ fontSize: 9, fill: '#8b949e' }} interval="preserveStartEnd" />
              <YAxis domain={[0, 4095]} tick={{ fontSize: 9, fill: '#8b949e' }} />
              <Tooltip
                contentStyle={{ background: '#161b22', border: '1px solid #30363d', borderRadius: 6 }}
                labelStyle={{ color: '#8b949e', fontSize: 11 }}
                itemStyle={{ color: '#58a6ff', fontSize: 11 }}
              />
              <ReferenceLine y={2500} stroke="#f85149" strokeDasharray="4 3"
                label={{ value: 'CRITICAL', position: 'right', fontSize: 9, fill: '#f85149' }} />
              <ReferenceLine y={1500} stroke="#d29922" strokeDasharray="4 3"
                label={{ value: 'WARNING', position: 'right', fontSize: 9, fill: '#d29922' }} />
              <Line
                type="monotone" dataKey="gas" stroke="#58a6ff"
                dot={false} strokeWidth={1.5} isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        )
      }
    </>
  )
}

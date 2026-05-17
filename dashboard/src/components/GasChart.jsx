import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ReferenceLine, ResponsiveContainer, Legend,
} from 'recharts'

const GAS_WARN = 1500
const GAS_CRIT = 2500

export default function GasChart({ alerts, nodeId }) {
  // Build time-series from the alert log for this node
  const data = alerts
    .filter(e => e.node_id === nodeId && e.value > 0)
    .slice(0, 60)
    .reverse()
    .map(e => ({
      t:   new Date(e.timestamp).toLocaleTimeString(),
      val: e.value,
    }))

  if (data.length === 0) {
    return (
      <div style={{ color: '#94a3b8', fontSize: 13 }}>
        No gas data for {nodeId} yet.
      </div>
    )
  }

  return (
    <div>
      <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
        Gas Concentration — {nodeId}
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={data} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="t" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
          <YAxis domain={[0, 4095]} tick={{ fontSize: 10 }} width={40} />
          <Tooltip
            formatter={(v) => [v, 'ADC value']}
            contentStyle={{ fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <ReferenceLine
            y={GAS_WARN} stroke="#ea580c" strokeDasharray="5 3"
            label={{ value: 'WARN', position: 'insideTopRight', fontSize: 10, fill: '#ea580c' }}
          />
          <ReferenceLine
            y={GAS_CRIT} stroke="#dc2626" strokeDasharray="5 3"
            label={{ value: 'CRIT', position: 'insideTopRight', fontSize: 10, fill: '#dc2626' }}
          />
          <Line
            type="monotone" dataKey="val" name="Gas (ADC)"
            stroke="#3b82f6" strokeWidth={2} dot={false} activeDot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

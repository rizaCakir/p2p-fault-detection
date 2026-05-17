import { useEffect, useRef, useState } from 'react'

const BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000]

export function useWebSocket(url, onMessage) {
  const [connected, setConnected] = useState(false)
  const wsRef    = useRef(null)
  const attempt  = useRef(0)
  const timerRef = useRef(null)
  const cbRef    = useRef(onMessage)
  cbRef.current  = onMessage

  useEffect(() => {
    let dead = false

    function connect() {
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        if (dead) { ws.close(); return }
        setConnected(true)
        attempt.current = 0
      }

      ws.onmessage = e => {
        try { cbRef.current(JSON.parse(e.data)) } catch {}
      }

      ws.onclose = ws.onerror = () => {
        if (dead) return
        setConnected(false)
        const delay = BACKOFF[Math.min(attempt.current++, BACKOFF.length - 1)]
        timerRef.current = setTimeout(connect, delay)
      }
    }

    connect()

    return () => {
      dead = true
      clearTimeout(timerRef.current)
      wsRef.current?.close()
    }
  }, [url])

  return connected
}

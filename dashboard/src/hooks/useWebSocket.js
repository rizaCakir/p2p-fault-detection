import { useEffect, useRef } from 'react'

/**
 * Connects to a WebSocket URL and calls onMessage with each parsed JSON object.
 * Automatically reconnects with exponential backoff (1s → 30s) on disconnect.
 */
export function useWebSocket(url, onMessage) {
  const wsRef    = useRef(null)
  const delayRef = useRef(1000)
  const cbRef    = useRef(onMessage)
  cbRef.current  = onMessage  // keep latest callback without re-running effect

  useEffect(() => {
    let timeout
    let active = true

    function connect() {
      if (!active) return
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        delayRef.current = 1000  // reset backoff on successful connect
      }

      ws.onmessage = ({ data }) => {
        try { cbRef.current(JSON.parse(data)) } catch (_) {}
      }

      ws.onclose = () => {
        if (!active) return
        timeout = setTimeout(() => {
          delayRef.current = Math.min(delayRef.current * 2, 30_000)
          connect()
        }, delayRef.current)
      }
    }

    connect()
    return () => {
      active = false
      clearTimeout(timeout)
      wsRef.current?.close()
    }
  }, [url])
}

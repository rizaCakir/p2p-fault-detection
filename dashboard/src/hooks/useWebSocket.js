import { useEffect, useRef, useState } from 'react'

/**
 * Connects to a WebSocket URL and calls onMessage with each parsed JSON object.
 * Automatically reconnects with exponential backoff (1 s → 30 s) on disconnect.
 * Returns the current connection status as a boolean.
 */
export function useWebSocket(url, onMessage) {
  const [connected, setConnected] = useState(false)
  const wsRef    = useRef(null)
  const delayRef = useRef(1000)
  const cbRef    = useRef(onMessage)
  cbRef.current  = onMessage

  useEffect(() => {
    let timeout
    let active = true

    function connect() {
      if (!active) return
      const ws = new WebSocket(url)
      wsRef.current = ws

      ws.onopen = () => {
        setConnected(true)
        delayRef.current = 1000
      }

      ws.onmessage = ({ data }) => {
        try { cbRef.current(JSON.parse(data)) } catch (_) {}
      }

      ws.onclose = () => {
        setConnected(false)
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

  return connected
}

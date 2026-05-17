package api

import (
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
)

const (
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
	pingPeriod = (pongWait * 9) / 10 // slightly shorter than pongWait
)

var upgrader = websocket.Upgrader{
	// Allow all origins in development; restrict in production
	CheckOrigin: func(r *http.Request) bool { return true },
}

// Hub maintains the set of active WebSocket clients and broadcasts messages.
type Hub struct {
	clients    map[*wsClient]struct{}
	broadcast  chan []byte
	register   chan *wsClient
	unregister chan *wsClient
	mu         sync.RWMutex
}

func NewHub() *Hub {
	return &Hub{
		clients:    make(map[*wsClient]struct{}),
		broadcast:  make(chan []byte, 512),
		register:   make(chan *wsClient),
		unregister: make(chan *wsClient),
	}
}

func (h *Hub) Run() {
	for {
		select {
		case c := <-h.register:
			h.mu.Lock()
			h.clients[c] = struct{}{}
			h.mu.Unlock()

		case c := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[c]; ok {
				delete(h.clients, c)
				close(c.send)
			}
			h.mu.Unlock()

		case msg := <-h.broadcast:
			h.mu.RLock()
			for c := range h.clients {
				select {
				case c.send <- msg:
				default:
					// Slow client – drop and close
					close(c.send)
					delete(h.clients, c)
				}
			}
			h.mu.RUnlock()
		}
	}
}

// Broadcast sends data to all connected dashboard clients.
func (h *Hub) Broadcast(data []byte) {
	h.broadcast <- data
}

// ServeWS upgrades an HTTP connection to WebSocket and registers the client.
func (h *Hub) ServeWS(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WS upgrade failed: %v", err)
		return
	}
	c := &wsClient{hub: h, conn: conn, send: make(chan []byte, 256)}
	h.register <- c
	go c.writePump()
	go c.readPump()
}

// ── wsClient ──────────────────────────────────────────────────────────

type wsClient struct {
	hub  *Hub
	conn *websocket.Conn
	send chan []byte
}

func (c *wsClient) writePump() {
	ticker := time.NewTicker(pingPeriod)
	defer func() {
		ticker.Stop()
		c.conn.Close()
	}()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
				c.conn.WriteMessage(websocket.CloseMessage, []byte{}) //nolint:errcheck
				return
			}
			if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
				return
			}
		case <-ticker.C:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if err := c.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				return
			}
		}
	}
}

func (c *wsClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		c.conn.SetReadDeadline(time.Now().Add(pongWait))
		return nil
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}

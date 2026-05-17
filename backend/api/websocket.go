package api

import (
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
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
	defer c.conn.Close()
	for msg := range c.send {
		if err := c.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}

func (c *wsClient) readPump() {
	defer func() {
		c.hub.unregister <- c
		c.conn.Close()
	}()
	// We only read to detect disconnects (ping/pong is handled by the library)
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			break
		}
	}
}

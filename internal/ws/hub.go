// Package ws pushes leaderboard updates from Redis Pub/Sub to browsers.
package ws

import (
	"context"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/redis/go-redis/v9"

	"github.com/adma77ya/Codium/internal/leaderboard"
)

const (
	sendBuffer = 16 // messages a client may fall behind before we drop it
	pingEvery  = 30 * time.Second
	writeWait  = 10 * time.Second
	pongWait   = 60 * time.Second
)

type client struct {
	conn *websocket.Conn
	send chan []byte
}

type Hub struct {
	mu       sync.Mutex
	clients  map[*client]struct{}
	upgrader websocket.Upgrader
}

func NewHub() *Hub {
	return &Hub{
		clients: make(map[*client]struct{}),
		// The leaderboard is public read-only data, so any origin may listen.
		// For anything private we would check r.Header.Get("Origin") here.
		upgrader: websocket.Upgrader{CheckOrigin: func(*http.Request) bool { return true }},
	}
}

// Run subscribes to Redis and fans every message out to local clients.
// One subscription per API instance, not one per browser.
func (h *Hub) Run(ctx context.Context, rdb *redis.Client) {
	sub := rdb.Subscribe(ctx, leaderboard.Channel)
	defer sub.Close()
	for {
		select {
		case <-ctx.Done():
			return
		case msg, ok := <-sub.Channel():
			if !ok {
				return
			}
			h.broadcast([]byte(msg.Payload))
		}
	}
}

func (h *Hub) broadcast(msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.send <- msg:
		default:
			// Buffer full: this client is too slow. Drop it rather than let
			// one bad connection stall every other viewer.
			delete(h.clients, c)
			close(c.send)
		}
	}
}

// ServeHTTP upgrades the HTTP request to a WebSocket and keeps it open.
func (h *Hub) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	conn, err := h.upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("ws upgrade: %v", err)
		return
	}
	c := &client{conn: conn, send: make(chan []byte, sendBuffer)}

	h.mu.Lock()
	h.clients[c] = struct{}{}
	h.mu.Unlock()

	go h.writePump(c)
	h.readPump(c) // blocks until the browser disconnects
}

// readPump exists only to notice disconnects and keep pong deadlines fresh.
func (h *Hub) readPump(c *client) {
	defer h.remove(c)
	c.conn.SetReadDeadline(time.Now().Add(pongWait))
	c.conn.SetPongHandler(func(string) error {
		return c.conn.SetReadDeadline(time.Now().Add(pongWait))
	})
	for {
		if _, _, err := c.conn.ReadMessage(); err != nil {
			return
		}
	}
}

// writePump is the ONLY goroutine that writes to the connection
// (gorilla connections allow one concurrent writer).
func (h *Hub) writePump(c *client) {
	ticker := time.NewTicker(pingEvery)
	defer ticker.Stop()
	defer c.conn.Close()
	for {
		select {
		case msg, ok := <-c.send:
			c.conn.SetWriteDeadline(time.Now().Add(writeWait))
			if !ok {
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

func (h *Hub) remove(c *client) {
	h.mu.Lock()
	if _, ok := h.clients[c]; ok {
		delete(h.clients, c)
		close(c.send)
	}
	h.mu.Unlock()
	c.conn.Close()
}

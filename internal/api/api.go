// Package api wires HTTP routes to handlers.
package api

import (
	"context"
	"encoding/json"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/adma77ya/Codium/internal/auth"
	"github.com/adma77ya/Codium/internal/ws"
)

type Server struct {
	pool      *pgxpool.Pool
	rdb       *redis.Client
	jwtSecret string
	hub       *ws.Hub
}

// RunHub starts the Redis Pub/Sub -> WebSocket fan-out. Call it in a goroutine.
func (s *Server) RunHub(ctx context.Context) { s.hub.Run(ctx, s.rdb) }

func New(pool *pgxpool.Pool, rdb *redis.Client, jwtSecret string) *Server {
	return &Server{pool: pool, rdb: rdb, jwtSecret: jwtSecret, hub: ws.NewHub()}
}

// Routes uses Go's built-in method+path patterns (Go 1.22+), so no router
// dependency is needed yet. Swapping in chi later would not change handlers.
func (s *Server) Routes() http.Handler {
	mux := http.NewServeMux()
	requireAuth := auth.Middleware(s.jwtSecret)

	mux.HandleFunc("GET /healthz", s.health)
	mux.HandleFunc("POST /api/auth/register", s.register)
	mux.HandleFunc("POST /api/auth/login", s.login)
	mux.Handle("GET /api/me", requireAuth(http.HandlerFunc(s.me)))
	mux.Handle("GET /ws/leaderboard", s.hub)
	mux.HandleFunc("GET /api/problems", s.listProblems)
	mux.HandleFunc("GET /api/problems/{slug}", s.getProblem)
	mux.HandleFunc("GET /api/leaderboard", s.getLeaderboard)
	mux.Handle("POST /api/submit", requireAuth(http.HandlerFunc(s.submit)))
	mux.Handle("GET /api/submissions/{id}", requireAuth(http.HandlerFunc(s.getSubmission)))
	return cors(mux)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, map[string]string{"error": msg})
}

func (s *Server) health(w http.ResponseWriter, r *http.Request) {
	if err := s.pool.Ping(r.Context()); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "db unreachable"})
		return
	}
	if err := s.rdb.Ping(r.Context()).Err(); err != nil {
		writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "redis unreachable"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "db": "up", "redis": "up"})
}

// cors lets the browser app (another origin in dev) call the API. In production
// the frontend and API share one origin behind a reverse proxy, so this narrows.
func cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		if r.Method == http.MethodOptions { // browser preflight
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

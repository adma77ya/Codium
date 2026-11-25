package api

import (
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5"

	"github.com/adma77ya/Codium/internal/leaderboard"
)

type problemView struct {
	ID            int64  `json:"id"`
	Slug          string `json:"slug"`
	Title         string `json:"title"`
	Difficulty    string `json:"difficulty"`
	Statement     string `json:"statement,omitempty"` // only on the detail endpoint
	TimeLimitMS   int    `json:"time_limit_ms"`
	MemoryLimitMB int    `json:"memory_limit_mb"`
}

// listProblems returns the list without statements (keeps the payload small).
func (s *Server) listProblems(w http.ResponseWriter, r *http.Request) {
	rows, err := s.pool.Query(r.Context(),
		`SELECT id, slug, title, difficulty, time_limit_ms, memory_limit_mb FROM problems ORDER BY id`)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load problems")
		return
	}
	defer rows.Close()

	out := []problemView{} // [] not null in JSON when empty
	for rows.Next() {
		var p problemView
		if err := rows.Scan(&p.ID, &p.Slug, &p.Title, &p.Difficulty, &p.TimeLimitMS, &p.MemoryLimitMB); err != nil {
			writeError(w, http.StatusInternalServerError, "could not load problems")
			return
		}
		out = append(out, p)
	}
	writeJSON(w, http.StatusOK, out)
}

func (s *Server) getProblem(w http.ResponseWriter, r *http.Request) {
	var p problemView
	err := s.pool.QueryRow(r.Context(),
		`SELECT id, slug, title, difficulty, statement, time_limit_ms, memory_limit_mb
		 FROM problems WHERE slug = $1`, r.PathValue("slug")).
		Scan(&p.ID, &p.Slug, &p.Title, &p.Difficulty, &p.Statement, &p.TimeLimitMS, &p.MemoryLimitMB)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "problem not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load problem")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// getLeaderboard is the initial snapshot; live changes arrive over WebSocket.
func (s *Server) getLeaderboard(w http.ResponseWriter, r *http.Request) {
	top, err := leaderboard.Top(r.Context(), s.pool, s.rdb, 50)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not load leaderboard")
		return
	}
	writeJSON(w, http.StatusOK, top)
}

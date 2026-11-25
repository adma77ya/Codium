package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/adma77ya/Codium/internal/auth"
)

// JudgeQueue is the Redis list the API pushes to and the worker BRPOPs from.
const JudgeQueue = "judge:queue"

const (
	pgForeignKeyViolation = "23503"
	maxCodeBytes          = 64 << 10
)

var validLanguages = map[string]bool{"python": true, "cpp": true, "go": true}

type submitRequest struct {
	ProblemID int64  `json:"problem_id"`
	Language  string `json:"language"`
	Code      string `json:"code"`
}

// submit is the "POST /submit" box in the diagram:
//  1. INSERT the row as status=pending (Postgres = source of truth, written first)
//  2. LPUSH only the id onto judge:queue (the queue carries ids, not code)
//  3. reply 202 Accepted immediately; judging happens asynchronously.
//
// If step 2 fails the row is still 'pending' in Postgres, so a sweeper can
// re-enqueue it later. That is why the DB write comes before the queue push.
func (s *Server) submit(w http.ResponseWriter, r *http.Request) {
	uid, ok := auth.UserID(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "not authenticated")
		return
	}

	var in submitRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if in.ProblemID <= 0 || !validLanguages[in.Language] || in.Code == "" || len(in.Code) > maxCodeBytes {
		writeError(w, http.StatusBadRequest, "need problem_id, language (python|cpp|go) and code (<=64KB)")
		return
	}

	var id int64
	err := s.pool.QueryRow(r.Context(),
		`INSERT INTO submissions (user_id, problem_id, language, code)
		 VALUES ($1, $2, $3, $4) RETURNING id`,
		uid, in.ProblemID, in.Language, in.Code).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation {
			writeError(w, http.StatusNotFound, "problem not found")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not save submission")
		return
	}

	if err := s.rdb.LPush(r.Context(), JudgeQueue, id).Err(); err != nil {
		writeError(w, http.StatusServiceUnavailable, "queue unavailable, submission saved as pending")
		return
	}

	writeJSON(w, http.StatusAccepted, map[string]any{"submission_id": id, "status": "pending"})
}

type submissionView struct {
	ID        int64   `json:"id"`
	ProblemID int64   `json:"problem_id"`
	Language  string  `json:"language"`
	Status    string  `json:"status"`
	Verdict   *string `json:"verdict"` // pointer so SQL NULL becomes JSON null
	TimeMS    *int    `json:"time_ms"`
	MemoryMB  *int    `json:"memory_mb"`
	Message   *string `json:"message"` // compiler output / runtime error detail
}

// getSubmission is what the browser polls (or the WebSocket replaces).
// The user_id filter stops one user reading another's submission.
func (s *Server) getSubmission(w http.ResponseWriter, r *http.Request) {
	uid, _ := auth.UserID(r.Context())
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "bad id")
		return
	}
	var v submissionView
	err = s.pool.QueryRow(r.Context(),
		`SELECT id, problem_id, language, status, verdict, time_ms, memory_mb, message
		 FROM submissions WHERE id = $1 AND user_id = $2`, id, uid).
		Scan(&v.ID, &v.ProblemID, &v.Language, &v.Status, &v.Verdict, &v.TimeMS, &v.MemoryMB, &v.Message)
	if errors.Is(err, pgx.ErrNoRows) {
		writeError(w, http.StatusNotFound, "submission not found")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "lookup failed")
		return
	}
	writeJSON(w, http.StatusOK, v)
}

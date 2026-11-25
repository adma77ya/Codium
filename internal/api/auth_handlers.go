package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"github.com/adma77ya/Codium/internal/auth"
)

type credentials struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authResponse struct {
	Token string `json:"token"`
	User  user   `json:"user"`
}

type user struct {
	ID       int64  `json:"id"`
	Username string `json:"username"`
}

// pgUniqueViolation is Postgres error code 23505.
const pgUniqueViolation = "23505"

func (s *Server) register(w http.ResponseWriter, r *http.Request) {
	var in credentials
	// Cap the body so a client cannot make us buffer gigabytes.
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	in.Username = strings.TrimSpace(in.Username)
	in.Email = strings.ToLower(strings.TrimSpace(in.Email))

	if len(in.Username) < 3 || len(in.Username) > 32 {
		writeError(w, http.StatusBadRequest, "username must be 3-32 characters")
		return
	}
	if _, err := mail.ParseAddress(in.Email); err != nil {
		writeError(w, http.StatusBadRequest, "invalid email address")
		return
	}
	if len(in.Password) < 8 || len(in.Password) > auth.MaxPasswordBytes {
		writeError(w, http.StatusBadRequest, "password must be 8-72 bytes")
		return
	}

	hash, err := auth.HashPassword(in.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not create account")
		return
	}

	// Parameterised query ($1..): values are never concatenated into SQL,
	// which is what prevents SQL injection.
	var id int64
	err = s.pool.QueryRow(r.Context(),
		`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
		in.Username, in.Email, hash).Scan(&id)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {
			// The UNIQUE constraint decides, not a check-then-insert, so two
			// simultaneous signups cannot both succeed.
			writeError(w, http.StatusConflict, "username or email already taken")
			return
		}
		writeError(w, http.StatusInternalServerError, "could not create account")
		return
	}

	s.respondWithToken(w, http.StatusCreated, user{ID: id, Username: in.Username})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var in credentials
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}

	var (
		u    user
		hash string
	)
	err := s.pool.QueryRow(r.Context(),
		`SELECT id, username, password_hash FROM users WHERE username = $1`,
		strings.TrimSpace(in.Username)).Scan(&u.ID, &u.Username, &hash)

	// Same message for "no such user" and "wrong password" so the endpoint
	// cannot be used to discover which usernames exist.
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !auth.CheckPassword(hash, in.Password)) {
		writeError(w, http.StatusUnauthorized, "invalid username or password")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "login failed")
		return
	}

	s.respondWithToken(w, http.StatusOK, u)
}

func (s *Server) respondWithToken(w http.ResponseWriter, status int, u user) {
	tok, err := auth.IssueToken(s.jwtSecret, u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "could not issue token")
		return
	}
	writeJSON(w, status, authResponse{Token: tok, User: u})
}

// me is behind the auth middleware, so the user id in the context was already
// verified from the JWT signature.
func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	id, _ := auth.UserID(r.Context())
	var u user
	err := s.pool.QueryRow(r.Context(),
		`SELECT id, username FROM users WHERE id = $1`, id).Scan(&u.ID, &u.Username)
	if err != nil {
		writeError(w, http.StatusNotFound, "user not found")
		return
	}
	writeJSON(w, http.StatusOK, u)
}

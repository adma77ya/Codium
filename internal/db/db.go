package db

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Connect creates a Postgres connection pool and verifies it is reachable.
// pgxpool.New is lazy (it does not actually connect), so we Ping to fail fast
// at startup if the database is down, instead of failing on the first request.
func Connect(ctx context.Context, url string) (*pgxpool.Pool, error) {
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return nil, fmt.Errorf("create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		return nil, fmt.Errorf("ping db: %w", err)
	}

	return pool, nil
}

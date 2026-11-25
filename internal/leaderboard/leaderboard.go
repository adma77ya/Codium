// Package leaderboard keeps the Redis sorted set in sync with Postgres.
// Postgres is the truth; the sorted set is a fast, rebuildable ranking.
package leaderboard

import (
	"context"
	"encoding/json"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"
)

const (
	Key     = "leaderboard:global" // ZSET: member=username, score=rank score
	Channel = "leaderboard:global" // Pub/Sub channel the WebSocket hub listens on

	penaltyPerTry = 20
	solvedWeight  = 1_000_000
)

type Cell struct {
	Solved bool `json:"solved"`
	Tries  int  `json:"tries"` // judged wrong tries before the first Accepted
}

type Standing struct {
	Username string          `json:"username"`
	Solved   int             `json:"solved"`
	Penalty  int             `json:"penalty"`
	Cells    map[string]Cell `json:"cells,omitempty"` // keyed by problem slug
}

// Update recomputes one user's standing from Postgres, ZADDs it, and PUBLISHes it.
// Penalty = 20 per judged try before the first Accepted, per solved problem.
// Score = solved*1e6 - penalty, so more solved always wins, then lower penalty.
func Update(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, userID int64) error {
	var st Standing
	err := pool.QueryRow(ctx, `
		WITH first_ac AS (
			SELECT problem_id, min(created_at) AS t
			FROM submissions WHERE user_id = $1 AND verdict = 'Accepted'
			GROUP BY problem_id)
		SELECT
			(SELECT username FROM users WHERE id = $1),
			count(*),
			coalesce(sum($2 * (
				SELECT count(*) FROM submissions s
				WHERE s.user_id = $1 AND s.problem_id = f.problem_id
				  AND s.status = 'done' AND s.created_at < f.t)), 0)
		FROM first_ac f`, userID, penaltyPerTry).Scan(&st.Username, &st.Solved, &st.Penalty)
	if err != nil {
		return err
	}

	score := float64(st.Solved*solvedWeight - st.Penalty)
	if err := rdb.ZAdd(ctx, Key, redis.Z{Score: score, Member: st.Username}).Err(); err != nil {
		return err
	}
	msg, _ := json.Marshal(st)
	return rdb.Publish(ctx, Channel, msg).Err()
}

// Top returns the best n users, highest score first.
func Top(ctx context.Context, pool *pgxpool.Pool, rdb *redis.Client, n int64) ([]Standing, error) {
	members, err := rdb.ZRevRangeWithScores(ctx, Key, 0, n-1).Result()
	if err != nil {
		return nil, err
	}
	out := make([]Standing, 0, len(members))
	for _, m := range members {
		score := int(m.Score)
		solved := (score + solvedWeight - 1) / solvedWeight // ceil for negative remainder
		if score <= 0 {
			solved = 0
		}
		out = append(out, Standing{
			Username: m.Member.(string),
			Solved:   solved,
			Penalty:  solved*solvedWeight - score,
		})
	}
	if err := fillCells(ctx, pool, out); err != nil {
		return nil, err
	}
	return out, nil
}

// fillCells adds the per-problem grid (one query for all listed users).
func fillCells(ctx context.Context, pool *pgxpool.Pool, rows []Standing) error {
	names := make([]string, len(rows))
	byName := make(map[string]*Standing, len(rows))
	for i := range rows {
		rows[i].Cells = map[string]Cell{}
		names[i] = rows[i].Username
		byName[rows[i].Username] = &rows[i]
	}
	res, err := pool.Query(ctx, `
		WITH fa AS (
			SELECT user_id, problem_id, min(created_at) AS t
			FROM submissions WHERE verdict = 'Accepted' GROUP BY user_id, problem_id)
		SELECT u.username, p.slug, fa.t IS NOT NULL,
		       count(*) FILTER (WHERE s.status = 'done' AND (fa.t IS NULL OR s.created_at < fa.t))
		FROM submissions s
		JOIN users u ON u.id = s.user_id
		JOIN problems p ON p.id = s.problem_id
		LEFT JOIN fa ON fa.user_id = s.user_id AND fa.problem_id = s.problem_id
		WHERE u.username = ANY($1)
		GROUP BY u.username, p.slug, fa.t`, names)
	if err != nil {
		return err
	}
	defer res.Close()
	for res.Next() {
		var user, slug string
		var c Cell
		if err := res.Scan(&user, &slug, &c.Solved, &c.Tries); err != nil {
			return err
		}
		byName[user].Cells[slug] = c
	}
	return res.Err()
}

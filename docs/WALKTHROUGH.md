# Codium: how a submission travels (study guide)

Draw this first, then explain each hop below.

```
Browser (React) --POST /api/submit + JWT--> Go API
Go API  --INSERT status=pending-->  PostgreSQL        (source of truth)
Go API  --LPUSH id-->               Redis list judge:queue
Go API  --202 + submission_id-->    Browser
Worker  --BRPOP-->                  Redis list
Worker  --claim, fetch code+tests-> PostgreSQL
Worker  --docker run --network=none--> sandbox container
Worker  --UPDATE verdict-->         PostgreSQL
Worker  --ZADD + PUBLISH-->         Redis (sorted set + Pub/Sub)
Go API (WebSocket hub) <--subscribe-- Redis Pub/Sub --> pushes to Browser
```

Two processes (`cmd/api`, `cmd/worker`) share nothing except Postgres and Redis. That is what lets you scale them independently.

---

## 1. Auth: stateless JWT (`internal/auth/auth.go`)

**Say:** Passwords are bcrypt-hashed (salted and deliberately slow). Login returns a signed JWT with the user id in `sub` and a 24h expiry. Any API instance with the secret can verify it, so there is no session store and the API scales horizontally.

```go
claims := jwt.RegisteredClaims{
    Subject:   strconv.FormatInt(userID, 10),
    ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
}
return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
```

**Say:** On verify I pin the algorithm, otherwise an attacker can send `alg: none` or swap algorithms.

```go
jwt.ParseWithClaims(token, &claims, keyFunc,
    jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
```

**Say:** Login returns the same error for "no such user" and "wrong password", so the endpoint can't be used to discover which usernames exist.

```go
if errors.Is(err, pgx.ErrNoRows) || (err == nil && !auth.CheckPassword(hash, in.Password)) {
    writeError(w, http.StatusUnauthorized, "invalid username or password")
```

**Say:** Middleware wraps handlers. It verifies the token, stores the user id in the request `context`, and only then calls the next handler.

```go
next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
```

## 2. Schema: let the database enforce the rules (`migrations/001_init.sql`)

**Say:** `UNIQUE` constraints decide races, not check-then-insert. `CHECK` constraints keep bad states out. `status` (pending/running/done) is separate from `verdict` (NULL until judged). There is a composite index for the hot query ("my submissions for this problem, newest first") and a partial index covering only unfinished rows.

```sql
status  TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done')),
verdict TEXT CHECK (verdict IN ('Accepted','Wrong Answer','Time Limit Exceeded','Runtime Error','Compile Error')),
CREATE INDEX submissions_user_problem_idx ON submissions (user_id, problem_id, created_at DESC);
CREATE INDEX submissions_status_idx ON submissions (status) WHERE status <> 'done';
```

Registering the same username twice is rejected by Postgres (error 23505) and mapped to HTTP 409, so two simultaneous signups cannot both win.

## 3. `POST /api/submit`: durable first, then queue (`internal/api/submit_handlers.go`)

**Say:** The API doesn't judge anything. It records the submission, enqueues the id, and returns `202 Accepted` immediately. Judging takes seconds, so doing it inside the request would tie up connections.

```go
err := s.pool.QueryRow(ctx,
    `INSERT INTO submissions (user_id, problem_id, language, code)
     VALUES ($1,$2,$3,$4) RETURNING id`, uid, in.ProblemID, in.Language, in.Code).Scan(&id)
...
s.rdb.LPush(ctx, JudgeQueue, id)
writeJSON(w, http.StatusAccepted, map[string]any{"submission_id": id, "status": "pending"})
```

**Why this order:** the DB write comes first. If Redis fails, the row is still `pending` in Postgres and can be re-enqueued. If I pushed to the queue first, a worker could pop an id that doesn't exist yet. The queue carries only ids, never code.

**Why `$1,$2…`:** parameterised queries mean user input is never concatenated into SQL, which is what prevents SQL injection.

## 4. The worker: BRPOP and atomic claim (`internal/judge/judge.go`)

**Say:** `BRPOP` blocks inside Redis until a job exists, so there is no polling loop. N goroutines each block on it, so N jobs are judged concurrently.

```go
res, err := w.RDB.BRPop(ctx, 5*time.Second, queueKey).Result()
```

**Say:** Before doing any work the worker claims the job with a conditional update. Postgres executes it atomically, so even if an id were delivered twice, exactly one worker gets `RowsAffected() == 1`.

```go
tag, _ := w.Pool.Exec(ctx,
    `UPDATE submissions SET status='running' WHERE id=$1 AND status='pending'`, id)
if tag.RowsAffected() == 0 { return nil } // someone else has it
```

**Say:** If Docker itself fails, that is our infrastructure problem and not a wrong answer. I put the row back to `pending` instead of inventing a verdict.

```go
if err != nil {
    _, _ = w.Pool.Exec(ctx, `UPDATE submissions SET status='pending' WHERE id=$1`, id)
```

**Say:** Shutdown is graceful. On SIGTERM the loops stop taking new jobs, but a job in progress finishes because it runs on a background context.

## 5. The sandbox (`internal/judge/sandbox.go`)

**Say:** User code is untrusted, so each test runs in a throwaway container with every dimension limited.

```go
"--network=none",                 // no internet, no access to our VPC/RDS
"--cpus=1", "--memory=256m", "--memory-swap=256m", // hard memory cap, no swap
"--pids-limit=64",                // fork bombs
"--cap-drop=ALL", "--security-opt=no-new-privileges",
"--read-only", "--tmpfs", "/tmp:rw,size=16m",
"--user", "65534:65534",          // nobody, not root
```

**Say:** On a timeout, killing the `docker` CLI process doesn't stop the container, so I remove it by name.

```go
if ctx.Err() == context.DeadlineExceeded {
    _ = exec.Command("docker", "rm", "-f", name).Run()
```

**Verdict mapping:** compile failure gives Compile Error; killed by the time limit gives Time Limit Exceeded; non-zero exit (137 means the memory limit killed it) gives Runtime Error; output mismatch gives Wrong Answer, comparing after trimming trailing whitespace; all tests pass gives Accepted.

## 6. Leaderboard: Postgres is truth, Redis is a fast view (`internal/leaderboard`)

**Say:** After each verdict I recompute that user's standing from Postgres and write it to a Redis sorted set. Recomputing instead of incrementing makes retries safe, and if Redis is wiped the whole board can be rebuilt from Postgres.

```go
score := float64(st.Solved*solvedWeight - st.Penalty) // more solved wins, then lower penalty
rdb.ZAdd(ctx, Key, redis.Z{Score: score, Member: st.Username})
rdb.Publish(ctx, Channel, msg)
```

**Why a sorted set:** `ZADD` is O(log n) and `ZREVRANGE 0 49` returns the top 50 already ordered. No `ORDER BY` over all submissions.

## 7. WebSocket hub: why Pub/Sub (`internal/ws/hub.go`)

**Say:** If I run two API servers behind a load balancer, a browser is connected to only one. The worker publishes once to Redis. Every API instance subscribes and pushes to its own browsers, so every viewer sees the update regardless of which server holds their socket.

```go
sub := rdb.Subscribe(ctx, leaderboard.Channel)
for msg := range sub.Channel() { h.broadcast([]byte(msg.Payload)) }
```

**Slow clients:** each connection has a bounded send buffer. If it fills, that client is dropped, so one slow browser can't stall the others.

```go
select {
case c.send <- msg:
default: delete(h.clients, c); close(c.send)
}
```

**Frontend:** the WebSocket message is only a "something changed" signal. The page refetches `/api/leaderboard`, so ranking stays in Redis and the per-problem grid stays in Postgres, with no duplicated state.

## 8. Deployment facts

- RDS and ElastiCache are private. Only the EC2 security group can reach them (security-group referencing, not IP allowlists).
- ElastiCache requires TLS (`rediss://`).
- The binaries are cross-compiled statically: `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build`.

---

## Be honest about the limits (interviewers respect this)

| Limit | What you'd say |
|---|---|
| Docker per test case has ~0.3-0.5s start-up | Wall-clock time includes container start; I allow a 1.5s grace. A production judge would use a long-lived sandbox (isolate/gVisor) and cgroup accounting. |
| Memory usage isn't measured, only limited | `memory_mb` is NULL; exceeding the limit shows as Runtime Error (exit 137). |
| A worker crash mid-job leaves `status='running'` | The fix is a sweeper that re-enqueues `running` rows older than a timeout. The partial index on `status` exists for exactly that scan. |
| Redis list queue is at-most-once | Postgres `pending` rows make it recoverable; a stream with consumer groups would give acknowledgements. |
| One global leaderboard, no contest timer | Contests would add a `contests` table and per-contest keys like `leaderboard:{id}`. |
| JWT in localStorage, CORS `*` | Fine for a demo. Production: httpOnly cookies or short-lived tokens, a same-origin reverse proxy, HTTPS. |
| Problem statements live in the frontend; the DB holds ids, limits and tests | Next step: serve statements from `/api/problems/{slug}`. |

## Likely questions

- **Why 202 and not 200?** The work isn't finished, only accepted.
- **What if two workers pop the same job?** The conditional `UPDATE ... WHERE status='pending'` lets only one proceed.
- **What if Redis dies?** The queue is lost but every submission is still `pending` in Postgres. Re-enqueue from there. The leaderboard rebuilds from Postgres.
- **How do you stop malicious code?** `--network=none`, memory/CPU/pids limits, read-only filesystem, no capabilities, non-root user, hard timeout, output size cap.
- **How would you scale it?** Add worker processes (they only share the queue), add API instances (stateless JWT plus Pub/Sub fan-out), and use a managed Postgres read replica for reads.

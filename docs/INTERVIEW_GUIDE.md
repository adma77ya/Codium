# Codium: complete interview guide (start to finish, with the real code)

How to use this: read Part 0 and Part 1 out loud until you can say them without looking. Then read each part once, so you know *why* every piece exists. Every code block is copied from the repo. If an interviewer says "show me", open that file.

---

## Part 0. The 60-second pitch

> Codium is a distributed coding-contest platform. You write code in the browser and submit it. A Go API stores the submission in Postgres and puts its id on a Redis queue, then replies `202` immediately. A separate judge worker pops the id, runs your code inside a locked-down Docker container (no network, CPU, memory and process limits), writes the verdict to Postgres, then updates a Redis sorted set for the leaderboard and publishes the change. The API's WebSocket hub is subscribed to that channel and pushes the update to every open browser. It runs on AWS: EC2 for the API, worker and nginx, RDS Postgres and ElastiCache Redis in private subnets that only the EC2 security group can reach.

Three design ideas to name:

1. **Postgres is the source of truth. Redis holds only derived or transient state** (the queue and the ranking). Anything in Redis can be rebuilt.
2. **Do the slow work asynchronously.** The API only records and enqueues, so judging time never blocks a request.
3. **The API and the worker share nothing except Postgres and Redis.** That is why each scales on its own.

## Part 1. The diagram (draw this on the whiteboard)

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

These 11 numbered arrows are exactly what the live diagram in the app lights up (Part 10).

Repo map:

| Path | Role |
|---|---|
| `cmd/api/main.go` | API process entrypoint |
| `cmd/worker/main.go` | Judge worker entrypoint |
| `internal/config` | Env-var config, fails fast |
| `internal/db`, `internal/redisc` | Postgres pool, Redis client |
| `internal/auth` | bcrypt, JWT, middleware |
| `internal/api` | HTTP routes and handlers |
| `internal/judge` | Worker loop and Docker sandbox |
| `internal/leaderboard` | ZSET ranking and Pub/Sub publish |
| `internal/ws` | WebSocket hub |
| `migrations/` | Schema and seed data |
| `web/` | React + Vite frontend |
| `deploy/nginx.conf` | Reverse proxy and static hosting |

---

## Part 2. Foundations: config, DB pool, Redis

### 2.1 Config fails fast (`internal/config/config.go`)

```go
func required(key string) string {
	value := os.Getenv(key)
	if value == "" {
		log.Fatalf("required environment variable not set: %s", key)
	}
	return value
}
func Load() *Config {
	return &Config{
		DatabaseURL: required("DATABASE_URL"),
		RedisURL:    required("REDIS_URL"),
		JWTSecret:   required("JWT_SECRET"),
		Port:        optional("PORT", "8080"),
	}
}
```

**Say:** Config comes from environment variables (12-factor), so the same binary runs locally and on EC2. A missing secret crashes at startup instead of failing mysteriously on the first request. Secrets live in `.env` on the server, which is gitignored.

### 2.2 Postgres pool (`internal/db/db.go`)

```go
pool, err := pgxpool.New(ctx, url)
...
if err := pool.Ping(ctx); err != nil {
	return nil, fmt.Errorf("ping db: %w", err)
}
```

**Say:** `pgxpool.New` is lazy: it doesn't connect. I `Ping` so that a bad database fails at startup, not on request one. A pool is shared by all goroutines, which is what makes concurrent handlers cheap.

### 2.3 Redis (`internal/redisc/redis.go`)

```go
opts, err := redis.ParseURL(url)
c := redis.NewClient(opts)
if err := c.Ping(ctx).Err(); err != nil { ... }
```

**Say:** `redis://` locally and `rediss://` (TLS) on AWS, because ElastiCache has encryption in transit on. The URL scheme is the only difference, so no code change.

### 2.4 Health check (`internal/api/api.go`)

```go
if err := s.pool.Ping(r.Context()); err != nil {
	writeJSON(w, http.StatusServiceUnavailable, map[string]string{"status": "db unreachable"})
	return
}
if err := s.rdb.Ping(r.Context()).Err(); err != nil { ...redis unreachable... }
writeJSON(w, http.StatusOK, map[string]string{"status": "ok", "db": "up", "redis": "up"})
```

**Say:** `/healthz` checks both dependencies and returns 503 if either is down, which is what a load balancer or monitor would use.

### 2.5 API entrypoint (`cmd/api/main.go`)

```go
cfg := config.Load()
pool, err := db.Connect(ctx, cfg.DatabaseURL)
rdb, err := redisc.Connect(ctx, cfg.RedisURL)
srv := api.New(pool, rdb, cfg.JWTSecret)
go srv.RunHub(ctx)                       // Redis Pub/Sub -> WebSocket fan-out
log.Fatal(http.ListenAndServe(addr, srv.Routes()))
```

**Say:** Load config, connect to both stores, start the hub in a goroutine, serve HTTP.

### 2.6 Routing (`internal/api/api.go`)

```go
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
```

**Say:** Go 1.22 `ServeMux` supports method and path patterns, so I needed no router library. Protected routes are wrapped in the auth middleware; public ones are not.

---

## Part 3. Schema (`migrations/001_init.sql`)

```sql
CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,           -- bcrypt, never the raw password
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE problems (
    id BIGSERIAL PRIMARY KEY, slug TEXT NOT NULL UNIQUE, title TEXT NOT NULL,
    statement TEXT NOT NULL,
    difficulty TEXT NOT NULL CHECK (difficulty IN ('Easy','Medium','Hard')),
    time_limit_ms INT NOT NULL DEFAULT 1000,
    memory_limit_mb INT NOT NULL DEFAULT 256
);

CREATE TABLE test_cases (
    id BIGSERIAL PRIMARY KEY,
    problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    ordinal INT NOT NULL, input TEXT NOT NULL, expected TEXT NOT NULL,
    UNIQUE (problem_id, ordinal)
);

CREATE TABLE submissions (
    id BIGSERIAL PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id),
    problem_id BIGINT NOT NULL REFERENCES problems(id),
    language TEXT NOT NULL CHECK (language IN ('python','cpp','go')),
    code     TEXT NOT NULL,
    status   TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','done')),
    verdict  TEXT CHECK (verdict IN ('Accepted','Wrong Answer','Time Limit Exceeded','Runtime Error','Compile Error')),
    time_ms INT, memory_mb INT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX submissions_user_problem_idx ON submissions (user_id, problem_id, created_at DESC);
CREATE INDEX submissions_status_idx ON submissions (status) WHERE status <> 'done';
```

**Say:**

- `UNIQUE` and `CHECK` constraints make the database enforce the rules, so a bug in Go can't create an invalid state.
- **`status` and `verdict` are separate on purpose.** `status` is the job lifecycle (pending, running, done). `verdict` is the result and is NULL until judged. That lets "is it finished?" and "was it right?" be asked independently.
- The composite index serves the hot query "my submissions for this problem, newest first".
- The **partial index** `WHERE status <> 'done'` only indexes unfinished rows. It stays tiny however many submissions pile up, and it's exactly what a "requeue stuck jobs" sweeper would scan.
- Test cases are in their own table with `ON DELETE CASCADE`, so deleting a problem can't orphan them.

**Seed (`002_seed.sql`):** two problems, `two-sum` (3 tests) and `valid-brackets` (4 tests). I/O is plain stdin to stdout so the judge is language-agnostic.

---

## Part 4. Authentication (`internal/auth/auth.go`, `internal/api/auth_handlers.go`)

### 4.1 Passwords

```go
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}
```

**Say:** bcrypt is salted and deliberately slow, so a stolen database is expensive to brute-force. Salt and cost are stored inside the hash string. bcrypt silently ignores bytes past 72, so I reject longer passwords (`MaxPasswordBytes = 72`).

### 4.2 Register

```go
if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in); err != nil { ...400... }
in.Email = strings.ToLower(strings.TrimSpace(in.Email))
if len(in.Username) < 3 || len(in.Username) > 32 { ... }
if _, err := mail.ParseAddress(in.Email); err != nil { ... }
if len(in.Password) < 8 || len(in.Password) > auth.MaxPasswordBytes { ... }

err = s.pool.QueryRow(r.Context(),
	`INSERT INTO users (username, email, password_hash) VALUES ($1, $2, $3) RETURNING id`,
	in.Username, in.Email, hash).Scan(&id)
if errors.As(err, &pgErr) && pgErr.Code == pgUniqueViolation {   // "23505"
	writeError(w, http.StatusConflict, "username or email already taken")
```

**Say (three points):**

1. `MaxBytesReader` caps the body at 1 MB so a client can't make me buffer gigabytes.
2. **`$1, $2, $3` placeholders** mean values are never concatenated into SQL. That's what prevents SQL injection.
3. **The UNIQUE constraint decides, not check-then-insert.** If I did `SELECT` then `INSERT`, two simultaneous signups could both pass the check. With the constraint, Postgres lets exactly one win and I map error `23505` to HTTP 409.

### 4.3 Login

```go
if errors.Is(err, pgx.ErrNoRows) || (err == nil && !auth.CheckPassword(hash, in.Password)) {
	writeError(w, http.StatusUnauthorized, "invalid username or password")
	return
}
```

**Say:** Same message for "no such user" and "wrong password", so the endpoint can't be used to discover which usernames exist (user enumeration).

### 4.4 JWT

```go
func IssueToken(secret string, userID int64) (string, error) {
	claims := jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(userID, 10),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),   // 24h
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

func ParseToken(secret, token string) (int64, error) {
	_, err := jwt.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) {
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	...
}
```

**Say:** The token carries the user id in `sub` and is signed with HMAC-SHA256. **Any API instance holding the secret can verify it, so there's no session store and the API scales horizontally.** On verify I **pin the algorithm** (`WithValidMethods`) and **require an expiry**; otherwise an attacker could send `alg: none` or swap algorithms.

Trade-off if asked: stateless tokens can't be revoked before expiry. The fix is short-lived access tokens plus refresh tokens, or a denylist in Redis.

### 4.5 Middleware

```go
tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
if !ok || tok == "" { 401 }
id, err := ParseToken(secret, tok)
if err != nil { 401 }
next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
```

**Say:** The middleware verifies the token, puts the user id in the request `context`, then calls the real handler. Handlers read it with `auth.UserID(ctx)`, so they never parse tokens themselves. The context key is an unexported struct type, so no other package can collide with it.

---

## Part 5. Submitting (`internal/api/submit_handlers.go`)

```go
var in submitRequest
json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&in)
if in.ProblemID <= 0 || !validLanguages[in.Language] || in.Code == "" || len(in.Code) > maxCodeBytes { 400 }

// 1. durable first
err := s.pool.QueryRow(r.Context(),
	`INSERT INTO submissions (user_id, problem_id, language, code)
	 VALUES ($1, $2, $3, $4) RETURNING id`,
	uid, in.ProblemID, in.Language, in.Code).Scan(&id)
if errors.As(err, &pgErr) && pgErr.Code == pgForeignKeyViolation { 404 "problem not found" }

// 2. then enqueue only the id
if err := s.rdb.LPush(r.Context(), JudgeQueue, id).Err(); err != nil {
	writeError(w, http.StatusServiceUnavailable, "queue unavailable, submission saved as pending")
	return
}

// 3. reply immediately
writeJSON(w, http.StatusAccepted, map[string]any{"submission_id": id, "status": "pending"})
```

**Say:**

- **Why 202 not 200?** The work isn't done, only accepted. Judging takes seconds, so doing it inside the request would tie up a connection and time out under load.
- **Why DB first, queue second?** If Redis fails after the insert, the row is still `pending` in Postgres and can be re-enqueued. If I pushed first, a worker could pop an id that doesn't exist yet. Postgres is the truth, the queue is a wake-up signal.
- **Why only the id in the queue?** The queue stays tiny, there's one copy of the code, and a worker always reads the latest row.
- **Foreign-key violation (23503)** becomes 404 so a bad `problem_id` isn't a 500.
- Code is capped at 64 KB.

Polling endpoint:

```go
`SELECT id, problem_id, language, status, verdict, time_ms, memory_mb
 FROM submissions WHERE id = $1 AND user_id = $2`
```

**Say:** The `AND user_id = $2` stops one user reading another's submission (an authorization check inside the query). `Verdict *string` is a pointer so SQL NULL becomes JSON `null`.

---

## Part 6. The judge worker (`cmd/worker/main.go`, `internal/judge/judge.go`)

### 6.1 Process and graceful shutdown

```go
ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
defer stop()
...
n := 2                                   // WORKERS env var overrides
(&judge.Worker{Pool: pool, RDB: rdb}).Run(ctx, n)
```

```go
func (w *Worker) Run(ctx context.Context, n int) {
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(id int) { defer wg.Done(); w.loop(ctx, id) }(i)
	}
	wg.Wait()
}
```

**Say:** N goroutines, each blocked on the queue, so N submissions are judged concurrently. On SIGTERM the context is cancelled, the loops stop taking new work, and `wg.Wait()` waits for in-flight jobs to finish.

### 6.2 The loop

```go
res, err := w.RDB.BRPop(ctx, 5*time.Second, queueKey).Result()
if errors.Is(err, redis.Nil) || ctx.Err() != nil { continue }
...
// Background ctx: a shutdown signal must not abort a half-judged job.
if err := w.process(context.Background(), subID); err != nil { log... }
```

**Say:** `BRPOP` blocks inside Redis until a job exists, so there's no polling or busy loop. The 5-second timeout just lets the loop re-check for shutdown. The job itself runs on `context.Background()` so a shutdown signal can't kill a half-judged submission.

### 6.3 Atomic claim

```go
tag, err := w.Pool.Exec(ctx,
	`UPDATE submissions SET status = 'running' WHERE id = $1 AND status = 'pending'`, id)
if tag.RowsAffected() == 0 { return nil }   // someone else has it
```

**Say:** A conditional `UPDATE` is atomic in Postgres. If the same id were somehow delivered twice, exactly one worker sees `RowsAffected() == 1`; the other does nothing. Delivery can be duplicated, processing can't.

### 6.4 Infrastructure failure is not the user's fault

```go
res, err := w.judge(ctx, id, problemID, lang, code, timeLimit, memMB)
if err != nil {
	_, _ = w.Pool.Exec(ctx, `UPDATE submissions SET status = 'pending' WHERE id = $1`, id)
	return err
}
```

**Say:** If Docker itself fails, that's my problem, not a Wrong Answer. I put the row back to `pending` rather than inventing a verdict. (Honest limit: nothing re-enqueues it automatically yet; see Part 12.)

### 6.5 Finishing

```go
w.Pool.Exec(ctx, `UPDATE submissions SET status = 'done', verdict = $2, time_ms = $3 WHERE id = $1`, ...)
// ZADD + PUBLISH. A failure here must not undo the verdict.
if err := leaderboard.Update(ctx, w.Pool, w.RDB, userID); err != nil { log }
```

**Say:** The verdict is committed first. The leaderboard update is best-effort, because the leaderboard can always be rebuilt from Postgres.

### 6.6 Running tests and mapping to a verdict

```go
dir, _ := os.MkdirTemp("", "codium-*")
defer os.RemoveAll(dir)
os.Chmod(dir, 0o755)                        // container runs as "nobody"
os.WriteFile(filepath.Join(dir, spec.file), []byte(code), 0o644)

if spec.compile != nil {                    // C++ and Go compile once
	r, err := dockerRun(ctx, prefix+"-c", compileArgs(...), "", 60*time.Second)
	if r.timedOut || r.exitCode != 0 { return verdictResult{verdict: "Compile Error"}, nil }
}

for i, t := range tests {
	r, err := dockerRun(ctx, name, runArgs(name, dir, spec, memMB), t.in,
		time.Duration(timeLimit)*time.Millisecond+startupGrace)
	switch {
	case r.timedOut:                      return {"Time Limit Exceeded", ms}
	case r.exitCode != 0:                 return {"Runtime Error", ms}   // includes 137 = memory kill
	case normalize(r.stdout) != normalize(t.want): return {"Wrong Answer", ms}
	}
}
return {"Accepted", worst}
```

| Condition | Verdict |
|---|---|
| Compile step fails | Compile Error |
| Killed by timeout | Time Limit Exceeded |
| Non-zero exit (137 = killed by memory cgroup) | Runtime Error |
| Output differs after normalisation | Wrong Answer |
| All tests pass | Accepted |

**It stops at the first failing test** (like real judges) and reports the worst time seen.

```go
func normalize(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	for i := range lines { lines[i] = strings.TrimRight(lines[i], " \t") }
	return strings.TrimRight(strings.Join(lines, "\n"), "\n")
}
```

**Say:** Output compare ignores trailing whitespace per line and trailing blank lines, so `"0 1"` and `"0 1\n"` both match, as on real judges.

Supported languages are a table (`langs` map in `sandbox.go`): Python 3.12, C++ (`gcc:13`, `-O2`), Go 1.22. Adding a language is one map entry.

---

## Part 7. The sandbox (`internal/judge/sandbox.go`)

This is the part interviewers love: **you're running strangers' code on your server.**

```go
func baseArgs(name string, memMB int) []string {
	return []string{"run", "--rm", "-i", "--name", name,
		"--network=none",                       // no internet, no access to our VPC/RDS
		"--cpus=1",
		fmt.Sprintf("--memory=%dm", memMB),
		fmt.Sprintf("--memory-swap=%dm", memMB), // no swap: memory limit is hard
		"--pids-limit=64",                       // fork-bomb protection
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
	}
}

func runArgs(name, dir string, spec langSpec, memMB int) []string {
	a := baseArgs(name, memMB)
	a = append(a, "--read-only", "--tmpfs", "/tmp:rw,size=16m",
		"--user", "65534:65534", "-v", dir+":/work:ro")
	...
}
```

| Flag | Attack it stops |
|---|---|
| `--network=none` | Calling out to the internet, or reaching RDS/Redis inside the VPC |
| `--cpus=1` | One submission hogging all cores |
| `--memory` + `--memory-swap` equal | Memory bombs. Setting swap equal to memory means no swap, so the limit is hard (kernel OOM kills it, exit 137) |
| `--pids-limit=64` | Fork bombs |
| `--cap-drop=ALL` | Linux capabilities (no mounting, raw sockets, etc.) |
| `no-new-privileges` | Privilege escalation through setuid binaries |
| `--read-only` + small `--tmpfs /tmp` | Writing to the container filesystem or filling the disk |
| `--user 65534:65534` | Running as root inside the container (runs as `nobody`) |
| `-v dir:/work:ro` | Code directory is mounted read-only |
| `--rm` | Containers don't accumulate |

The compile step is different: `/work` is mounted read-write so the compiler can write the binary, and `/tmp` is `exec`-enabled. The *run* step is the strict one.

### Timeouts

```go
ctx, cancel := context.WithTimeout(ctx, timeout)
cmd := exec.CommandContext(ctx, "docker", args...)
...
if ctx.Err() == context.DeadlineExceeded {
	res.timedOut = true
	// Killing the docker CLI does NOT stop the container; remove it by name.
	_ = exec.Command("docker", "rm", "-f", name).Run()
	return res, nil
}
```

**Say:** Cancelling the context kills the `docker` CLI process, but **the container keeps running**. So I give every container a unique name (`codium-<id>-<testIndex>`) and `docker rm -f` it by name. Without this, an infinite loop would leak a container forever.

### Output cap

```go
type limitedBuffer struct{ bytes.Buffer }
func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > maxOutputBytes { p = p[:max(0, maxOutputBytes-b.Len())] }
	b.Buffer.Write(p)
	return len(p), nil   // pretend success so the child isn't blocked by a broken pipe
}
```

**Say:** A program printing infinite output would fill my memory. The buffer caps stored output at 1 MB but still reports success, so the child process isn't blocked and the timeout handles it.

### Distinguishing verdicts from infrastructure errors

```go
if ee, ok := err.(*exec.ExitError); ok { res.exitCode = ee.ExitCode(); return res, nil }
return res, err   // docker itself could not run: infrastructure error, not a verdict
```

A non-zero exit is the user's program failing (a verdict). A failure to even run `docker` is returned as an error, and the worker requeues instead.

### What a real production judge would add

gVisor, Firecracker or `isolate` for stronger isolation than shared-kernel containers, seccomp profiles, disk quotas, and cgroup accounting to measure real memory and CPU time rather than wall-clock.

---

## Part 8. Leaderboard (`internal/leaderboard/leaderboard.go`)

### Scoring

```go
const penaltyPerTry = 20
const solvedWeight  = 1_000_000

score := float64(st.Solved*solvedWeight - st.Penalty)
rdb.ZAdd(ctx, Key, redis.Z{Score: score, Member: st.Username})
msg, _ := json.Marshal(st)
rdb.Publish(ctx, Channel, msg)
```

**Rule (ICPC style):** more problems solved wins; ties are broken by lower penalty; each judged wrong try before the first Accepted on a solved problem adds 20.

**Why `solved*1,000,000 − penalty`?** It packs two sort keys into one number so a single sorted set orders correctly. One extra solve is worth 1,000,000, far more than any plausible penalty, so solved count always dominates.

### Recompute, don't increment

```sql
WITH first_ac AS (
	SELECT problem_id, min(created_at) AS t
	FROM submissions WHERE user_id = $1 AND verdict = 'Accepted'
	GROUP BY problem_id)
SELECT (SELECT username FROM users WHERE id = $1),
       count(*),
       coalesce(sum($2 * (SELECT count(*) FROM submissions s
          WHERE s.user_id = $1 AND s.problem_id = f.problem_id
            AND s.status = 'done' AND s.created_at < f.t)), 0)
FROM first_ac f
```

**Say:** After each verdict I **recompute that user's standing from Postgres** and `ZADD` the result. `ZADD` with the same member just overwrites the score, so it's **idempotent**: retrying it, or running it twice, is harmless. `ZINCRBY` would double-count on a retry. And if Redis is wiped, the board can be rebuilt from Postgres.

### Why a sorted set

`ZADD` is O(log n). `ZREVRANGE 0 49` returns the top 50 already ordered. No `ORDER BY` over all submissions on every page load.

### Reading the board

```go
members, err := rdb.ZRevRangeWithScores(ctx, Key, 0, n-1).Result()
...
solved := (score + solvedWeight - 1) / solvedWeight    // decode solved count from the score
Penalty: solved*solvedWeight - score
...
fillCells(ctx, pool, out)    // per-problem grid in ONE query for all listed users
```

**Say:** Ranking lives in Redis; the per-problem grid (solved? how many tries?) comes from Postgres in a single `= ANY($1)` query, which avoids N+1 queries. The two stores each do what they're good at.

---

## Part 9. WebSocket hub and Pub/Sub (`internal/ws/hub.go`)

### Why Pub/Sub?

If I run two API servers behind a load balancer, a browser is connected to only one. The worker is a *different process* that doesn't know any sockets. So the worker `PUBLISH`es once to Redis; **every API instance subscribes and pushes to its own browsers.**

```go
// Run subscribes to Redis and fans every message out to local clients.
// One subscription per API instance, not one per browser.
sub := rdb.Subscribe(ctx, leaderboard.Channel)
for msg := range sub.Channel() { h.broadcast([]byte(msg.Payload)) }
```

### Slow clients can't stall everyone

```go
func (h *Hub) broadcast(msg []byte) {
	h.mu.Lock(); defer h.mu.Unlock()
	for c := range h.clients {
		select {
		case c.send <- msg:
		default:
			// Buffer full: this client is too slow. Drop it.
			delete(h.clients, c)
			close(c.send)
		}
	}
}
```

**Say:** Each client has a bounded channel (`sendBuffer = 16`). If it fills, the client is dropped instead of blocking the broadcast loop. One bad connection must never delay the others. The mutex protects the `clients` map, and `select` with `default` makes the send non-blocking.

### One reader, one writer per connection

```go
go h.writePump(c)   // the ONLY goroutine that writes (gorilla allows one concurrent writer)
h.readPump(c)       // blocks until disconnect; refreshes pong deadlines
```

`writePump` also sends a **ping every 30 s**; `readPump` expects a pong within 60 s. That detects half-dead connections (a laptop that went to sleep), which TCP alone won't notice for a long time. `remove()` deletes the client and closes its channel exactly once.

**Honest note:** `CheckOrigin` returns true, which is fine because the leaderboard is public read-only data. For private streams I'd verify the `Origin` header.

### What the frontend does with a message

The WebSocket message is only a "something changed" signal; the page refetches `/api/leaderboard`. So the truth stays in Redis + Postgres, with no duplicated client state.

---

## Part 10. The frontend (`web/`)

### 10.1 API layer (`web/src/api/http.ts`)

```ts
export const API_BASE: string =
  import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:8080' : window.location.origin)
export const WS_BASE = API_BASE.replace(/^http/, 'ws')
```

**Say:** In dev it talks to `localhost:8080` (through an SSH tunnel to EC2). In a production build it uses the page's own origin, because nginx serves the site and proxies `/api` and `/ws` there. Same origin means no CORS problem.

`call<T>()` is the one `fetch` wrapper: adds JSON headers and `Authorization: Bearer <token>`, and throws an `ApiError` carrying the server's `error` message.

### 10.2 The submit flow (`web/src/api/judge.ts`)

```ts
const { submission_id } = await call('/api/submit', { method: 'POST', token, body: {...} })
onStage(1, `202 Accepted, submission #${submission_id}...`)

while (Date.now() < deadline) {
  await Promise.race([wait(700), push.arrived])      // a push means the verdict is already stored
  const s = await call(`/api/submissions/${submission_id}`, { token, signal })
  if (s.status === 'running' && !sawRunning) onStage(2, ...)
  if (s.status === 'done' && s.verdict) { onStage(3, ...); ... }
}
```

**Say:** Submit, then poll the submission every 700 ms. In parallel the browser listens on the leaderboard WebSocket. When the push for *my* username arrives, it wakes the poll loop early. Polling alone is the correct fallback; the WebSocket is an optimisation.

### 10.3 The live pipeline diagram (`web/src/components/Pipeline.tsx`)

When you press Submit, an 8-node diagram lights up the 11 arrows from Part 1. **Every light-up is driven by an event the browser actually observed**, not a fake timer:

| Stage | Browser observes | Lights up |
|---|---|---|
| 0 | Request sent | arrow 1 |
| 1 | HTTP 202 received | arrows 2, 3, 4 (return, INSERT, LPUSH) |
| 2 | Poll shows `running` | arrows 5, 6 (BRPOP, claim) |
| 3 | Poll shows `done` + verdict | arrows 7, 8 (docker, UPDATE) |
| 4 | WebSocket push for my username | arrows 9, 10, 11 (ZADD+PUBLISH, Pub/Sub, push) |

```ts
// An edge is idle before `from`, animated while from <= stage < to, done once stage >= to.
const edgeState = (e: Edge): EState => {
  if (cur >= e.to) return 'done'
  if (pushFailed && e.from >= 3) return 'failed'
  return s >= e.from && s < e.to ? 'active' : 'idle'
}
```

Honesty point: stages 2 and 3 are accurate to the 700 ms poll interval, and the UI says so. If the push doesn't arrive within 4 s, the last edges turn **red** and the caption says so instead of pretending it worked.

**Slow motion / Replay:** a `DWELL_MS = 2200` timer walks through the *recorded* stages one at a time. It replays real recorded events slowly; it doesn't invent any.

### 10.4 Other pages

`Login` (register + login, token in `localStorage`), `Problems` (list), `Workspace` (editor, language picker, submit, verdict, "Show pipeline"), `Leaderboard` (fetch `/api/leaderboard`, refetch on WebSocket message).

---

## Part 11. AWS deployment story

```
Internet --:80--> EC2 (t3.micro, eu-north-1)
                    ├─ nginx          static React build + reverse proxy
                    ├─ codium-api     :8080 (not exposed publicly)
                    └─ codium-worker  + Docker
                          │
              ┌───────────┴───────────┐
        RDS PostgreSQL          ElastiCache (Valkey/Redis)
        (private)               (private, TLS)
```

1. **EC2** runs nginx, the API, the worker and Docker.
2. **RDS and ElastiCache are private.** No public IP. Their security groups allow traffic only *from the EC2 instance's security group* (security-group referencing), not from IP lists. Even if I leaked the DB password, the database isn't reachable from the internet.
3. **ElastiCache has in-transit encryption**, so the URL is `rediss://` (TLS).
4. **Build:** `CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build` on my Mac produces static binaries, which I `scp` to EC2. No Go toolchain on the server.
5. **Secrets** are in a `.env` file on the server and are gitignored.
6. **nginx** (`deploy/nginx.conf`):

```nginx
server {
    listen 80 default_server;
    root /var/www/codium;
    location / { try_files $uri /index.html; }            # SPA fallback
    location /api/ { proxy_pass http://127.0.0.1:8080; }
    location /ws/ {                                        # WebSocket upgrade
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
    }
    location = /healthz { proxy_pass http://127.0.0.1:8080; }
}
```

**Say:** nginx serves the built React files and reverse-proxies `/api` and `/ws` to the Go server, so the browser sees one origin. WebSockets need `HTTP/1.1` plus the `Upgrade`/`Connection` headers, and a long read timeout so idle connections aren't cut. Port 8080 is closed to the internet in the security group; only 22 (my IP only) and 80 are open.

**Debugging stories you can honestly tell** (interviewers love these):

- The new API binary didn't take effect because the old process still held the file ("text file busy") and kept answering. I had to stop the process before copying.
- The site timed out on port 80 even though nginx was healthy: the security group had no HTTP rule. Diagnosed with `curl localhost` on the box (200) versus `curl` from my Mac (timeout).
- `docker pull` failed with "no space left on device" on the small EC2 disk; fixed with `docker image prune -a`.
- ElastiCache rejected plain `redis://` until I used `rediss://`.

---

## Part 12. Honest limitations (say these before they ask)

| Limit | What you say |
|---|---|
| Docker start-up counts toward the time limit | Wall-clock includes container start (~0.3-0.5 s). I add a 1.5 s grace. A production judge would use a long-lived sandbox and measure CPU time with cgroups. |
| `memory_mb` is never measured | Memory is *limited* (exit 137 shows as Runtime Error) but not reported, so the column is NULL. |
| Worker crash mid-job leaves `status='running'` | Fix: a sweeper that requeues `running` rows older than a timeout. The partial index exists for that scan. |
| Infra failure puts the row back to `pending`, but nothing re-enqueues it | Same sweeper would also re-push `pending` rows that are older than N seconds. |
| Redis list is at-most-once | If a worker pops an id and dies, the id is gone from the queue (Postgres still knows). A Redis Stream with consumer groups gives acknowledgements and redelivery. |
| One global leaderboard, no contest timer | Real contests: a `contests` table, per-contest keys like `leaderboard:{id}`, start/end times. |
| JWT in localStorage, CORS `*`, WS `CheckOrigin` open | Acceptable for a demo. Production: httpOnly cookies, same-origin only, HTTPS, Origin checks. |
| HTTP only, no domain, no Elastic IP | Next: domain + Let's Encrypt via nginx, Elastic IP so the address survives a stop/start. |
| Problem statements are static in the frontend | The DB holds ids, limits and tests; only `two-sum` and `valid-brackets` are seeded. Next: serve statements from `/api/problems/{slug}`. |
| No rate limiting | Add per-user limits on `/api/submit` (e.g. Redis token bucket) to stop queue flooding. |
| Single instance of everything | The design allows scaling out, but I've run one API and one worker. |

---

## Part 13. Likely interview questions with answers

**1. Why a queue? Why not judge inside the request?**
Judging takes seconds and is CPU-heavy. Inside the request it would hold connections, time out under load, and couple API capacity to judge capacity. A queue decouples them: the API absorbs bursts, workers drain at their own pace, and I can scale workers independently.

**2. What happens if two workers pop the same job?**
The claim is `UPDATE ... SET status='running' WHERE id=$1 AND status='pending'`. Postgres makes that atomic, so only one gets `RowsAffected() == 1`.

**3. What if Redis dies?**
Every submission is already in Postgres as `pending`, so nothing is lost permanently; jobs just aren't being picked up. After Redis returns, re-enqueue `pending` rows. The leaderboard is rebuilt from Postgres. This is why Postgres is the source of truth.

**4. What if the worker crashes mid-judging?**
The row is stuck in `running` and the user waits. Honest answer: I haven't built the sweeper. Design: periodically requeue `running` rows older than a timeout, and make processing idempotent, which it already is because verdict writes and leaderboard recomputation are idempotent.

**5. What if the API crashes between INSERT and LPUSH?**
The row exists as `pending` but isn't queued. Same sweeper fixes it. This is the reason for ordering DB-before-queue: the failure mode is "delayed", never "queued job with no row".

**6. Could you use a transactional outbox instead?**
Yes, that's the rigorous fix for dual-write: write the job into an `outbox` table in the *same transaction* as the submission, and a relay publishes it to the queue. My `pending` status plus a sweeper is a lightweight version of that.

**7. How do you stop malicious code?**
Defence in depth: no network, CPU/memory/PID limits, no swap, read-only root filesystem with tiny tmpfs, all capabilities dropped, no-new-privileges, non-root user, read-only code mount, wall-clock timeout with forced container removal by name, and an output size cap. Remaining gap: containers share the host kernel, so for hostile production traffic I'd add gVisor or Firecracker.

**8. Why Pub/Sub for WebSockets instead of the worker talking to the API?**
The worker doesn't know which API instance holds which socket. Publishing to Redis lets every API instance receive the event and push to its own clients. It also means the worker and API need no direct connection.

**9. Redis Pub/Sub is fire-and-forget. What if a client misses a message?**
Acceptable here because a message is only an invalidate signal; on reconnect or next page load the client refetches the full board from `/api/leaderboard`. If I needed guaranteed delivery I'd use Redis Streams.

**10. Why recompute the leaderboard from Postgres instead of `ZINCRBY`?**
`ZINCRBY` isn't idempotent: a retry double-counts. Recompute + `ZADD` overwrites with the correct value, so it's safe to repeat, and it self-heals.

**11. How would you scale it?**
Workers: just run more processes (or raise `WORKERS`); they only share the queue and DB. API: stateless thanks to JWT, so add instances behind a load balancer; Pub/Sub already handles WebSocket fan-out across instances. Database: read replicas for reads, connection pooling (pgbouncer / RDS Proxy). Hot path reads come from Redis.

**12. Why JWT? What are the downsides?**
Stateless: any instance can verify with just the secret, no shared session store. Downside: can't revoke before expiry, and a token in localStorage is exposed to XSS. Mitigations: short expiry plus refresh tokens, httpOnly cookies, and a denylist if needed.

**13. Why bcrypt?**
Salted and adaptive-cost, deliberately slow, so brute-forcing a leaked hash is expensive. Cost can be raised over time.

**14. How do you prevent SQL injection?**
Parameterised queries everywhere (`$1`, `$2`); user input is never concatenated into SQL.

**15. How is a race on username signup handled?**
By the UNIQUE constraint, not by check-then-insert. The database serialises it and I translate error 23505 into a 409.

**16. Why a Redis sorted set rather than `ORDER BY` in SQL?**
O(log n) updates and O(log n + k) top-k reads, pre-sorted, no scan over all submissions on each page load. Postgres still holds the truth and can rebuild it.

**17. Why 202 Accepted?**
The request was accepted for processing, but the result isn't ready. 200 would imply completion.

**18. Why does the worker use `context.Background()` for processing?**
So a shutdown signal can't abort a half-judged job and leave inconsistent state. The loop stops taking new jobs; in-flight ones finish.

**19. How does the live diagram work, and is it real?**
Yes. Each stage is triggered by something the browser really observed (the 202, the polled status changing to `running` and `done`, and the WebSocket push for my username). If the push never comes, the diagram shows red instead of faking success. Slow-motion just replays the recorded events with delays.

**20. What would you do next?**
HTTPS and a domain, Elastic IP, a stuck-job sweeper, Redis Streams for acknowledged delivery, real CPU/memory measurement, contest timers, rate limiting on submit, metrics with Prometheus/Grafana, CI/CD, and secrets in AWS Secrets Manager.

---

## Part 14. Demo script (3 minutes)

1. Open `http://13.60.3.224` and say what it is in one sentence.
2. Register or log in (JWT is issued).
3. Open `two-sum`, submit a **wrong** solution (`print(1)`) with the pipeline overlay open. Walk the 11 arrows as they light up. Point out the verdict is *Wrong Answer*.
4. Tick **Slow motion** or press **Replay slowly** and narrate each hop with Part 1.
5. Submit a **correct** solution, get *Accepted*, and show the leaderboard update live without refreshing (WebSocket).
6. If asked about internals: `ssh` to the box, `docker ps`, worker logs showing `submission N: Accepted (Xms)`.

Correct `two-sum` in Python for the demo:

```python
n = int(input())
a = list(map(int, input().split()))
t = int(input())
seen = {}
for i, v in enumerate(a):
    if t - v in seen:
        print(seen[t - v], i)
        break
    seen[v] = i
```

Correct `valid-brackets`:

```python
s = input().strip()
pairs = {')': '(', ']': '[', '}': '{'}
st = []
ok = True
for c in s:
    if c in '([{':
        st.append(c)
    elif not st or st.pop() != pairs[c]:
        ok = False
        break
print('YES' if ok and not st else 'NO')
```

**Before the interview:** make sure the Python image is on EC2 (`docker pull python:3.12-alpine`), delete the public 8080 rule, use `http://` explicitly (there is no HTTPS, so browsers that auto-upgrade will time out), and test one full submission an hour before.

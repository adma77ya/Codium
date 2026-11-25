// Package judge is the worker side of the diagram: BRPOP -> sandbox -> verdict.
package judge

import (
	"context"
	"errors"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/adma77ya/Codium/internal/leaderboard"
)

const queueKey = "judge:queue" // must match api.JudgeQueue

type Worker struct {
	Pool *pgxpool.Pool
	RDB  *redis.Client
}

// Run starts n goroutines that each block on BRPOP. It returns after ctx is
// cancelled AND every in-flight job has finished (graceful shutdown).
func (w *Worker) Run(ctx context.Context, n int) {
	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func(id int) {
			defer wg.Done()
			w.loop(ctx, id)
		}(i)
	}
	wg.Wait()
}

func (w *Worker) loop(ctx context.Context, workerID int) {
	for ctx.Err() == nil {
		// Blocks inside Redis for up to 5s, then returns redis.Nil so we can
		// re-check for shutdown. No polling, no busy loop.
		res, err := w.RDB.BRPop(ctx, 5*time.Second, queueKey).Result()
		if errors.Is(err, redis.Nil) || ctx.Err() != nil {
			continue
		}
		if err != nil {
			log.Printf("worker %d: brpop: %v", workerID, err)
			time.Sleep(time.Second)
			continue
		}
		subID, err := strconv.ParseInt(res[1], 10, 64)
		if err != nil {
			log.Printf("worker %d: bad job %q", workerID, res[1])
			continue
		}
		// Background ctx: a shutdown signal must not abort a half-judged job.
		if err := w.process(context.Background(), subID); err != nil {
			log.Printf("worker %d: submission %d: %v", workerID, subID, err)
		}
	}
}

type verdictResult struct {
	verdict string
	timeMS  int
	message string // compiler output or runtime error, shown to the submitter
}

const maxMessageBytes = 4000

// cleanMessage makes sandbox output safe to store and show: no NUL bytes
// (Postgres TEXT rejects them), valid UTF-8, no internal paths, bounded size.
func cleanMessage(s string) string {
	s = strings.ReplaceAll(s, "\x00", "")
	s = strings.ToValidUTF8(s, "?")
	s = strings.ReplaceAll(s, "/work/", "")
	s = strings.TrimSpace(s)
	if len(s) > maxMessageBytes {
		s = strings.ToValidUTF8(s[:maxMessageBytes], "") + "\n... (truncated)"
	}
	return s
}

// exitReason explains an exit code in words a contestant understands.
func exitReason(code int) string {
	switch code {
	case 137:
		return "Killed: the program used more memory than the limit allows (exit 137)."
	case 139:
		return "Segmentation fault: invalid memory access (exit 139)."
	case 134:
		return "Aborted: the program crashed (assertion failure, uncaught exception or similar) (exit 134)."
	case 136:
		return "Arithmetic error such as division by zero (exit 136)."
	default:
		return fmt.Sprintf("The program exited with code %d.", code)
	}
}

func (w *Worker) process(ctx context.Context, id int64) error {
	// Claim the job. Only one worker can flip pending -> running, even if the
	// same id is somehow delivered twice.
	tag, err := w.Pool.Exec(ctx,
		`UPDATE submissions SET status = 'running' WHERE id = $1 AND status = 'pending'`, id)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return nil
	}

	var (
		userID, problemID int64
		lang, code        string
		timeLimit, memMB  int
	)
	err = w.Pool.QueryRow(ctx, `
		SELECT s.user_id, s.problem_id, s.language, s.code, p.time_limit_ms, p.memory_limit_mb
		FROM submissions s JOIN problems p ON p.id = s.problem_id WHERE s.id = $1`, id).
		Scan(&userID, &problemID, &lang, &code, &timeLimit, &memMB)
	if err != nil {
		return err
	}

	res, err := w.judge(ctx, id, problemID, lang, code, timeLimit, memMB)
	if err != nil {
		// Infrastructure failure (docker down), not the user's fault: put it
		// back to pending so it can be retried instead of faking a verdict.
		_, _ = w.Pool.Exec(ctx, `UPDATE submissions SET status = 'pending' WHERE id = $1`, id)
		return err
	}

	_, err = w.Pool.Exec(ctx,
		`UPDATE submissions SET status = 'done', verdict = $2, time_ms = $3, message = $4 WHERE id = $1`,
		id, res.verdict, res.timeMS, nullIfEmpty(res.message))
	if err != nil {
		return err
	}
	log.Printf("submission %d: %s (%dms)", id, res.verdict, res.timeMS)

	// ZADD + PUBLISH. A failure here must not undo the verdict, since the
	// leaderboard can always be rebuilt from Postgres.
	if err := leaderboard.Update(ctx, w.Pool, w.RDB, userID); err != nil {
		log.Printf("leaderboard update for user %d: %v", userID, err)
	}
	return nil
}

func (w *Worker) judge(ctx context.Context, subID, problemID int64, lang, code string, timeLimit, memMB int) (verdictResult, error) {
	spec, ok := langs[lang]
	if !ok {
		return verdictResult{}, fmt.Errorf("unsupported language %q", lang)
	}

	rows, err := w.Pool.Query(ctx,
		`SELECT input, expected FROM test_cases WHERE problem_id = $1 ORDER BY ordinal`, problemID)
	if err != nil {
		return verdictResult{}, err
	}
	type tc struct{ in, want string }
	var tests []tc
	for rows.Next() {
		var t tc
		if err := rows.Scan(&t.in, &t.want); err != nil {
			rows.Close()
			return verdictResult{}, err
		}
		tests = append(tests, t)
	}
	rows.Close()
	if len(tests) == 0 {
		return verdictResult{}, errors.New("problem has no test cases")
	}

	dir, err := os.MkdirTemp("", "codium-*")
	if err != nil {
		return verdictResult{}, err
	}
	defer os.RemoveAll(dir)
	// Containers run as "nobody" with all capabilities dropped, so the directory
	// must be world-writable for the compile step to create the binary. It is a
	// throwaway directory, and the run step mounts it read-only.
	if err := os.Chmod(dir, 0o777); err != nil {
		return verdictResult{}, err
	}
	if err := os.WriteFile(filepath.Join(dir, spec.file), []byte(code), 0o644); err != nil {
		return verdictResult{}, err
	}

	prefix := fmt.Sprintf("codium-%d", subID)

	if spec.compile != nil {
		r, err := dockerRun(ctx, prefix+"-c", compileArgs(prefix+"-c", dir, spec), "", 60*time.Second)
		if err != nil {
			return verdictResult{}, err
		}
		if r.timedOut {
			return verdictResult{verdict: "Compile Error", message: "Compilation took too long and was stopped."}, nil
		}
		// 125 = docker itself failed (image missing, daemon error). That is our
		// problem, not a compile error, so let the caller retry.
		if r.exitCode == 125 {
			return verdictResult{}, fmt.Errorf("docker could not start the compile container: %s", cleanMessage(r.stderr))
		}
		if r.exitCode != 0 {
			msg := cleanMessage(r.stderr)
			if msg == "" {
				msg = cleanMessage(r.stdout)
			}
			if msg == "" {
				msg = exitReason(r.exitCode)
			}
			return verdictResult{verdict: "Compile Error", message: msg}, nil
		}
	}

	var worst time.Duration
	for i, t := range tests {
		name := fmt.Sprintf("%s-%d", prefix, i)
		r, err := dockerRun(ctx, name, runArgs(name, dir, spec, memMB), t.in,
			time.Duration(timeLimit)*time.Millisecond+startupGrace)
		if err != nil {
			return verdictResult{}, err
		}
		if r.elapsed > worst {
			worst = r.elapsed
		}
		ms := int(worst.Milliseconds())
		switch {
		case r.timedOut:
			return verdictResult{"Time Limit Exceeded", ms,
				fmt.Sprintf("Test %d: no answer within the %d ms limit.", i+1, timeLimit)}, nil
		case r.exitCode != 0: // includes 137 = killed by the memory limit
			msg := fmt.Sprintf("Test %d: %s", i+1, exitReason(r.exitCode))
			if e := cleanMessage(r.stderr); e != "" {
				msg += "\n\n" + e
			}
			return verdictResult{"Runtime Error", ms, msg}, nil
		case normalize(r.stdout) != normalize(t.want):
			// Hidden tests: say which one failed, never reveal its data.
			return verdictResult{"Wrong Answer", ms,
				fmt.Sprintf("Wrong answer on test %d. Your program ran without errors but printed a different output than expected.", i+1)}, nil
		}
	}
	return verdictResult{"Accepted", int(worst.Milliseconds()), ""}, nil
}

func nullIfEmpty(s string) any {
	if s == "" {
		return nil
	}
	return s
}

// normalize ignores trailing whitespace per line and trailing blank lines.
func normalize(s string) string {
	lines := strings.Split(strings.ReplaceAll(s, "\r\n", "\n"), "\n")
	for i := range lines {
		lines[i] = strings.TrimRight(lines[i], " \t")
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n")
}

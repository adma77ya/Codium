-- Codium schema v1. Postgres is the source of truth; Redis only holds
-- derived/transient state (job queue, rankings), which can be rebuilt from here.

CREATE TABLE users (
    id            BIGSERIAL PRIMARY KEY,
    username      TEXT        NOT NULL UNIQUE,
    email         TEXT        NOT NULL UNIQUE,
    password_hash TEXT        NOT NULL,           -- bcrypt, never the raw password
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE problems (
    id              BIGSERIAL PRIMARY KEY,
    slug            TEXT    NOT NULL UNIQUE,
    title           TEXT    NOT NULL,
    statement       TEXT    NOT NULL,
    difficulty      TEXT    NOT NULL CHECK (difficulty IN ('Easy', 'Medium', 'Hard')),
    time_limit_ms   INT     NOT NULL DEFAULT 1000,
    memory_limit_mb INT     NOT NULL DEFAULT 256
);

CREATE TABLE test_cases (
    id          BIGSERIAL PRIMARY KEY,
    problem_id  BIGINT  NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
    ordinal     INT     NOT NULL,
    input       TEXT    NOT NULL,
    expected    TEXT    NOT NULL,
    UNIQUE (problem_id, ordinal)
);

CREATE TABLE submissions (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT      NOT NULL REFERENCES users(id),
    problem_id  BIGINT      NOT NULL REFERENCES problems(id),
    language    TEXT        NOT NULL CHECK (language IN ('python', 'cpp', 'go')),
    code        TEXT        NOT NULL,
    status      TEXT        NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'done')),
    verdict     TEXT        CHECK (verdict IN ('Accepted', 'Wrong Answer', 'Time Limit Exceeded', 'Runtime Error', 'Compile Error')),
    time_ms     INT,
    memory_mb   INT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "Show me my submissions for this problem, newest first" is the hot query.
CREATE INDEX submissions_user_problem_idx ON submissions (user_id, problem_id, created_at DESC);
-- The worker/leaderboard rebuild scans by status.
CREATE INDEX submissions_status_idx ON submissions (status) WHERE status <> 'done';

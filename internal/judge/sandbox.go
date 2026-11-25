package judge

import (
	"bytes"
	"context"
	"fmt"
	"os/exec"
	"strings"
	"time"
)

const (
	maxOutputBytes = 1 << 20
	startupGrace   = 1500 * time.Millisecond // docker start-up is not the user's fault
)

type langSpec struct {
	image   string
	file    string
	compile []string // nil for interpreted languages
	run     []string
	env     []string
}

var langs = map[string]langSpec{
	"python": {image: "python:3.12-alpine", file: "main.py",
		run: []string{"python", "/work/main.py"}},
	"cpp": {image: "gcc:13", file: "main.cpp",
		compile: []string{"g++", "-O2", "-o", "/work/prog", "/work/main.cpp"},
		run:     []string{"/work/prog"}},
	"go": {image: "golang:1.22-alpine", file: "main.go",
		compile: []string{"go", "build", "-o", "/work/prog", "/work/main.go"},
		run:     []string{"/work/prog"},
		env:     []string{"GOCACHE=/tmp/gocache", "HOME=/tmp", "CGO_ENABLED=0"}},
}

// limitedBuffer stops a program from making us hold unbounded output in memory.
type limitedBuffer struct{ bytes.Buffer }

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > maxOutputBytes {
		p = p[:max(0, maxOutputBytes-b.Len())]
	}
	b.Buffer.Write(p)
	return len(p), nil // pretend success so the child is not blocked by a broken pipe
}

type runResult struct {
	stdout   string
	stderr   string
	exitCode int
	elapsed  time.Duration
	timedOut bool
}

// dockerRun starts a throwaway, locked-down container and waits for it.
func dockerRun(ctx context.Context, name string, args []string, stdin string, timeout time.Duration) (runResult, error) {
	ctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Stdin = strings.NewReader(stdin)
	var out, errb limitedBuffer
	cmd.Stdout, cmd.Stderr = &out, &errb

	start := time.Now()
	err := cmd.Run()
	res := runResult{stdout: out.String(), stderr: errb.String(), elapsed: time.Since(start)}

	if ctx.Err() == context.DeadlineExceeded {
		res.timedOut = true
		// Killing the docker CLI does NOT stop the container; remove it by name.
		_ = exec.Command("docker", "rm", "-f", name).Run()
		return res, nil
	}
	if ee, ok := err.(*exec.ExitError); ok {
		res.exitCode = ee.ExitCode()
		return res, nil
	}
	return res, err // docker itself could not run: infrastructure error, not a verdict
}

func baseArgs(name string, memMB int) []string {
	return []string{"run", "--rm", "-i", "--name", name,
		"--network=none", // code cannot reach the internet or our VPC
		"--cpus=1",
		fmt.Sprintf("--memory=%dm", memMB),
		fmt.Sprintf("--memory-swap=%dm", memMB), // no swap: memory limit is hard
		"--pids-limit=64",                       // fork-bomb protection
		"--cap-drop=ALL",
		"--security-opt=no-new-privileges",
	}
}

func compileArgs(name, dir string, spec langSpec) []string {
	a := baseArgs(name, 1024)
	a = append(a, "--tmpfs", "/tmp:rw,exec,size=256m", "-v", dir+":/work")
	for _, e := range spec.env {
		a = append(a, "-e", e)
	}
	a = append(a, spec.image)
	return append(a, spec.compile...)
}

func runArgs(name, dir string, spec langSpec, memMB int) []string {
	a := baseArgs(name, memMB)
	a = append(a, "--read-only", "--tmpfs", "/tmp:rw,size=16m",
		"--user", "65534:65534", "-v", dir+":/work:ro")
	for _, e := range spec.env {
		a = append(a, "-e", e)
	}
	a = append(a, spec.image)
	return append(a, spec.run...)
}

package main

import (
	"context"
	"log"
	"os"
	"os/signal"
	"strconv"
	"syscall"

	"github.com/adma77ya/Codium/internal/config"
	"github.com/adma77ya/Codium/internal/db"
	"github.com/adma77ya/Codium/internal/judge"
	"github.com/adma77ya/Codium/internal/redisc"
)

func main() {
	cfg := config.Load()

	// Cancelled on Ctrl-C / SIGTERM; workers finish their current job first.
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()
	rdb, err := redisc.Connect(ctx, cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer rdb.Close()

	n := 2
	if v, err := strconv.Atoi(os.Getenv("WORKERS")); err == nil && v > 0 {
		n = v
	}
	log.Printf("judge worker started with %d goroutines", n)
	(&judge.Worker{Pool: pool, RDB: rdb}).Run(ctx, n)
	log.Println("judge worker stopped")
}

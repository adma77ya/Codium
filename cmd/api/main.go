package main

import (
	"context"
	"log"
	"net/http"

	"github.com/adma77ya/Codium/internal/api"
	"github.com/adma77ya/Codium/internal/config"
	"github.com/adma77ya/Codium/internal/db"
	"github.com/adma77ya/Codium/internal/redisc"
)

func main() {
	// 1. Load configuration from the environment (fails fast if required vars missing).
	cfg := config.Load()

	// 2. Connect to Postgres and prove it is reachable.
	ctx := context.Background()
	pool, err := db.Connect(ctx, cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()
	log.Println("connected to postgres")

	// 3. Connect to Redis/Valkey (redis:// locally, rediss:// = TLS on AWS).
	rdb, err := redisc.Connect(ctx, cfg.RedisURL)
	if err != nil {
		log.Fatalf("redis: %v", err)
	}
	defer rdb.Close()
	log.Println("connected to redis")

	// 4. Routes live in internal/api: /healthz, auth, and (soon) submissions.
	srv := api.New(pool, rdb, cfg.JWTSecret)
	go srv.RunHub(ctx)

	// 5. Start the server.
	addr := ":" + cfg.Port
	log.Printf("codium api listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, srv.Routes()))
}

package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

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

	// 4. Health endpoint. A real health check verifies dependencies, so we
	//    ping both stores on each call — a load balancer polls this to decide
	//    whether to send this instance traffic.
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, `{"status":"db unreachable"}`, http.StatusServiceUnavailable)
			return
		}
		if err := rdb.Ping(r.Context()).Err(); err != nil {
			http.Error(w, `{"status":"redis unreachable"}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"status":"ok","db":"up","redis":"up"}`)
	})

	// 5. Start the server.
	addr := ":" + cfg.Port
	log.Printf("codium api listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

package main

import (
	"context"
	"fmt"
	"log"
	"net/http"

	"github.com/adma77ya/Codium/internal/config"
	"github.com/adma77ya/Codium/internal/db"
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

	// 3. Health endpoint. A real health check verifies dependencies, so we
	//    ping the DB on each call — a load balancer polls this to decide
	//    whether to send this instance traffic.
	http.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := pool.Ping(r.Context()); err != nil {
			http.Error(w, `{"status":"db unreachable"}`, http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintln(w, `{"status":"ok"}`)
	})

	// 4. Start the server.
	addr := ":" + cfg.Port
	log.Printf("codium api listening on %s", addr)
	log.Fatal(http.ListenAndServe(addr, nil))
}

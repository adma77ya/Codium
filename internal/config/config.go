package config

import (
	"log"
	"os"
)

type Config struct {
	DatabaseURL string
	RedisURL    string
	JWTSecret   string
	Port        string
}

func optional(key, fallback string) string {
	value := os.Getenv(key)
	if value == "" {
		return fallback
	}
	return value
}
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

package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"p2pfault/backend/api"
	"p2pfault/backend/db"
	"p2pfault/backend/mqtt"
	"p2pfault/backend/registry"
)

func main() {
	// ── Config from environment (with sensible defaults) ──────────────
	mqttBroker1 := getEnv("MQTT_BROKER_1", "tcp://192.168.1.100:1883")
	mqttBroker2 := getEnv("MQTT_BROKER_2", "tcp://192.168.1.101:1883")
	sbcNodeID   := getEnv("SBC_NODE_ID",   "sbc-1")
	listenAddr  := getEnv("LISTEN_ADDR",   ":8080")
	dbPath      := getEnv("DB_PATH",       "./data/events.db")

	// ── Database ──────────────────────────────────────────────────────
	database, err := db.New(dbPath)
	if err != nil {
		log.Fatalf("DB init failed: %v", err)
	}
	defer database.Close()
	log.Printf("[DB] opened %s", dbPath)

	// ── SBC tracker ──────────────────────────────────────────────────
	// A node is considered offline if no heartbeat has been received for 90 s
	// (3× the 30 s publish interval gives two missed beats before flagging).
	tracker := registry.NewSBCTracker(90 * time.Second)

	// ── WebSocket hub ─────────────────────────────────────────────────
	hub := api.NewHub()
	go hub.Run()

	// ── MQTT subscriber ───────────────────────────────────────────────
	sub := mqtt.NewSubscriber([]string{mqttBroker1, mqttBroker2}, database, hub, sbcNodeID, tracker)
	if err := sub.Connect(); err != nil {
		log.Fatalf("MQTT connect failed: %v", err)
	}
	defer sub.Disconnect()
	go sub.StartHeartbeat(30 * time.Second)

	// ── HTTP server ───────────────────────────────────────────────────
	router := api.NewRouter(database, hub, tracker)
	srv := &http.Server{
		Addr:         listenAddr,
		Handler:      router,
		ReadTimeout:  15 * time.Second,
		WriteTimeout: 15 * time.Second,
		IdleTimeout:  60 * time.Second,
	}
	go func() {
		log.Printf("[HTTP] listening on %s  (node=%s)", listenAddr, sbcNodeID)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("HTTP server error: %v", err)
		}
	}()

	// ── Graceful shutdown ─────────────────────────────────────────────
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("Shutting down…")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	srv.Shutdown(ctx) //nolint:errcheck
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

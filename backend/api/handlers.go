package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gorilla/mux"
	"p2pfault/backend/db"
	"p2pfault/backend/registry"
)

type handler struct {
	db      *db.DB
	hub     *Hub
	tracker *registry.SBCTracker
}

// NewRouter wires up all HTTP routes and returns the ready-to-serve router.
func NewRouter(database *db.DB, hub *Hub, tracker *registry.SBCTracker) *mux.Router {
	h := &handler{db: database, hub: hub, tracker: tracker}

	r := mux.NewRouter()
	r.Use(corsMiddleware)

	// REST API
	api := r.PathPrefix("/api/v1").Subrouter()
	api.HandleFunc("/nodes/status",                  h.getNodesStatus).Methods("GET")
	api.HandleFunc("/alerts/history",                h.getAlertHistory).Methods("GET")
	api.HandleFunc("/nodes/{nodeId}/telemetry",      h.getNodeTelemetry).Methods("GET")
	api.HandleFunc("/nodes/{nodeId}/gas-history",    h.getGasHistory).Methods("GET")
	api.HandleFunc("/sbc/status",                    h.getSBCStatus).Methods("GET")

	// WebSocket
	r.HandleFunc("/ws/realtime", hub.ServeWS)

	// Health probe (used by load balancer / docker healthcheck)
	r.HandleFunc("/health", h.health).Methods("GET")

	return r
}

// ── Handlers ──────────────────────────────────────────────────────────

func (h *handler) getNodesStatus(w http.ResponseWriter, r *http.Request) {
	nodes, err := h.db.GetAllNodes(2 * time.Minute)
	if err != nil {
		jsonErr(w, "failed to fetch nodes", http.StatusInternalServerError)
		return
	}
	jsonOK(w, nodes)
}

func (h *handler) getAlertHistory(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	limit, _  := strconv.Atoi(q.Get("limit"))
	offset, _ := strconv.Atoi(q.Get("offset"))
	if limit <= 0 || limit > 500 {
		limit = 50
	}
	severity := strings.ToUpper(q.Get("severity")) // "WARNING" | "CRITICAL" | ""
	if severity != "WARNING" && severity != "CRITICAL" {
		severity = ""
	}
	f := db.AlertFilter{
		NodeID:   q.Get("node_id"),
		Severity: severity,
		Limit:    limit,
		Offset:   offset,
	}
	events, total, err := h.db.GetAlertHistory(f)
	if err != nil {
		jsonErr(w, "failed to fetch alerts", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]interface{}{
		"data":   events,
		"total":  total,
		"limit":  limit,
		"offset": offset,
	})
}

func (h *handler) getNodeTelemetry(w http.ResponseWriter, r *http.Request) {
	nodeID := mux.Vars(r)["nodeId"]
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	events, err := h.db.GetNodeTelemetry(nodeID, limit)
	if err != nil {
		jsonErr(w, "failed to fetch telemetry", http.StatusInternalServerError)
		return
	}
	jsonOK(w, events)
}

// getGasHistory returns time-series gas readings for a node.
// Used by the Recharts trend chart on the dashboard.
// Query params: limit (default 100, max 500)
func (h *handler) getGasHistory(w http.ResponseWriter, r *http.Request) {
	nodeID := mux.Vars(r)["nodeId"]
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	logs, err := h.db.GetGasHistory(nodeID, limit)
	if err != nil {
		jsonErr(w, "failed to fetch gas history", http.StatusInternalServerError)
		return
	}
	jsonOK(w, logs)
}

// getSBCStatus returns the live online/offline status of every SBC instance
// that has sent at least one heartbeat since this backend started.
func (h *handler) getSBCStatus(w http.ResponseWriter, _ *http.Request) {
	jsonOK(w, h.tracker.All())
}

func (h *handler) health(w http.ResponseWriter, _ *http.Request) {
	jsonOK(w, map[string]string{"status": "ok"})
}

// ── Helpers ───────────────────────────────────────────────────────────

func jsonOK(w http.ResponseWriter, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(v) //nolint:errcheck
}

func jsonErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]string{"error": msg}) //nolint:errcheck
}

func corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin",  "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

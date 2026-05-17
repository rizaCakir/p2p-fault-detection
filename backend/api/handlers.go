package api

import (
	"encoding/json"
	"net/http"
	"strconv"
	"time"

	"github.com/gorilla/mux"
	"p2pfault/backend/db"
)

type handler struct {
	db  *db.DB
	hub *Hub
}

// NewRouter wires up all HTTP routes and returns the ready-to-serve router.
func NewRouter(database *db.DB, hub *Hub) *mux.Router {
	h := &handler{db: database, hub: hub}

	r := mux.NewRouter()
	r.Use(corsMiddleware)

	// REST API
	api := r.PathPrefix("/api/v1").Subrouter()
	api.HandleFunc("/nodes/status",              h.getNodesStatus).Methods("GET")
	api.HandleFunc("/alerts/history",            h.getAlertHistory).Methods("GET")
	api.HandleFunc("/nodes/{nodeId}/telemetry",  h.getNodeTelemetry).Methods("GET")

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
	events, err := h.db.GetAlertHistory(limit, offset)
	if err != nil {
		jsonErr(w, "failed to fetch alerts", http.StatusInternalServerError)
		return
	}
	jsonOK(w, map[string]interface{}{
		"data":   events,
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

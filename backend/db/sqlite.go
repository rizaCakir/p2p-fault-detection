package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"time"

	_ "github.com/mattn/go-sqlite3"
	"p2pfault/backend/models"
)

type DB struct {
	conn *sql.DB
}

func New(path string) (*DB, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	// WAL mode for concurrent reads; busy_timeout avoids write-lock errors
	conn, err := sql.Open("sqlite3", path+"?_journal_mode=WAL&_busy_timeout=5000")
	if err != nil {
		return nil, err
	}
	d := &DB{conn: conn}
	if err := d.migrate(); err != nil {
		return nil, fmt.Errorf("migration: %w", err)
	}
	return d, nil
}

func (d *DB) Close() error { return d.conn.Close() }

func (d *DB) migrate() error {
	_, err := d.conn.Exec(`
		CREATE TABLE IF NOT EXISTS event_log (
			event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
			timestamp  DATETIME NOT NULL,
			node_id    TEXT NOT NULL,
			zone_id    TEXT NOT NULL,
			fault_type TEXT NOT NULL,
			severity   TEXT NOT NULL,
			value      INTEGER NOT NULL
		);
		CREATE INDEX IF NOT EXISTS idx_event_ts   ON event_log(timestamp DESC);
		CREATE INDEX IF NOT EXISTS idx_event_node ON event_log(node_id);

		CREATE TABLE IF NOT EXISTS node_health (
			node_id   TEXT PRIMARY KEY,
			zone_id   TEXT NOT NULL,
			last_seen DATETIME NOT NULL,
			gas_val   INTEGER  NOT NULL DEFAULT 0,
			state     TEXT     NOT NULL DEFAULT 'IDLE'
		);
	`)
	return err
}

// ── Writes ────────────────────────────────────────────────────────────

func (d *DB) InsertEvent(e *models.EventLog) error {
	_, err := d.conn.Exec(
		`INSERT INTO event_log (timestamp, node_id, zone_id, fault_type, severity, value)
		 VALUES (?, ?, ?, ?, ?, ?)`,
		e.Timestamp, e.NodeID, e.ZoneID, e.FaultType, e.Severity, e.Value,
	)
	return err
}

func (d *DB) UpsertNodeHealth(n *models.NodeHealth) error {
	_, err := d.conn.Exec(
		`INSERT INTO node_health (node_id, zone_id, last_seen, gas_val, state)
		 VALUES (?, ?, ?, ?, ?)
		 ON CONFLICT(node_id) DO UPDATE SET
		     last_seen = excluded.last_seen,
		     gas_val   = excluded.gas_val,
		     state     = excluded.state`,
		n.NodeID, n.ZoneID, n.LastSeen, n.GasVal, n.State,
	)
	return err
}

// ── Reads ─────────────────────────────────────────────────────────────

// GetAllNodes returns every known node; Online is set true if last_seen < offlineAfter ago.
func (d *DB) GetAllNodes(offlineAfter time.Duration) ([]models.NodeHealth, error) {
	rows, err := d.conn.Query(
		`SELECT node_id, zone_id, last_seen, gas_val, state
		 FROM node_health ORDER BY node_id`,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	cutoff := time.Now().Add(-offlineAfter)
	nodes := make([]models.NodeHealth, 0)
	for rows.Next() {
		var n models.NodeHealth
		if err := rows.Scan(&n.NodeID, &n.ZoneID, &n.LastSeen, &n.GasVal, &n.State); err != nil {
			return nil, err
		}
		n.Online = n.LastSeen.After(cutoff)
		nodes = append(nodes, n)
	}
	return nodes, rows.Err()
}

func (d *DB) GetAlertHistory(limit, offset int) ([]models.EventLog, error) {
	rows, err := d.conn.Query(
		`SELECT event_id, timestamp, node_id, zone_id, fault_type, severity, value
		 FROM event_log ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
		limit, offset,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEvents(rows)
}

func (d *DB) GetNodeTelemetry(nodeID string, limit int) ([]models.EventLog, error) {
	rows, err := d.conn.Query(
		`SELECT event_id, timestamp, node_id, zone_id, fault_type, severity, value
		 FROM event_log WHERE node_id = ? ORDER BY timestamp DESC LIMIT ?`,
		nodeID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanEvents(rows)
}

func scanEvents(rows *sql.Rows) ([]models.EventLog, error) {
	events := make([]models.EventLog, 0)
	for rows.Next() {
		var e models.EventLog
		if err := rows.Scan(&e.EventID, &e.Timestamp, &e.NodeID, &e.ZoneID, &e.FaultType, &e.Severity, &e.Value); err != nil {
			return nil, err
		}
		events = append(events, e)
	}
	return events, rows.Err()
}

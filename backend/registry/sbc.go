package registry

import (
	"sort"
	"sync"
	"time"
)

// SBCStatus is the runtime health of a single backend SBC instance.
type SBCStatus struct {
	NodeID   string    `json:"node_id"`
	LastSeen time.Time `json:"last_seen"`
	Online   bool      `json:"online"`
}

// SBCTracker is a thread-safe in-memory registry of SBC heartbeat timestamps.
// Each backend instance publishes a heartbeat every ~30 s; the tracker records
// the last-seen time and derives an online/offline status from it.
type SBCTracker struct {
	mu      sync.RWMutex
	sbcs    map[string]time.Time
	offline time.Duration // a node is "offline" when last-seen exceeds this
}

func NewSBCTracker(offlineAfter time.Duration) *SBCTracker {
	return &SBCTracker{
		sbcs:    make(map[string]time.Time),
		offline: offlineAfter,
	}
}

// Heartbeat records that nodeID is alive right now.
func (t *SBCTracker) Heartbeat(nodeID string) {
	t.mu.Lock()
	t.sbcs[nodeID] = time.Now()
	t.mu.Unlock()
}

// All returns a snapshot of every known SBC with its computed online status,
// sorted by node ID for deterministic output.
func (t *SBCTracker) All() []SBCStatus {
	t.mu.RLock()
	defer t.mu.RUnlock()
	cutoff := time.Now().Add(-t.offline)
	result := make([]SBCStatus, 0, len(t.sbcs))
	for id, ts := range t.sbcs {
		result = append(result, SBCStatus{
			NodeID:   id,
			LastSeen: ts,
			Online:   ts.After(cutoff),
		})
	}
	sort.Slice(result, func(i, j int) bool { return result[i].NodeID < result[j].NodeID })
	return result
}

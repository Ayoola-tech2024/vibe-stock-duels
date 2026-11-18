package main

import (
	"encoding/json"
	"flag"
	"log"
	"net/http"
	"os"
	"path/filepath"
)

func main() {
	defaultAddr := ":8080"
	if p := os.Getenv("PORT"); p != "" {
		defaultAddr = ":" + p
	}
	addr := flag.String("addr", defaultAddr, "HTTP listen address")
	dbPath := flag.String("db", "vibe.db", "SQLite database path")
	staticDir := flag.String("static", "..", "Static web root directory")
	flag.Parse()

	if err := initDB(*dbPath); err != nil {
		log.Fatalf("failed to init sqlite db: %v", err)
	}

	mux := http.NewServeMux()

	// Health check
	mux.HandleFunc("/api/health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]any{"ok": true, "privyAppId": privyAppID})
	})

	// Phase 1: Player profile & server-side $VCT balance
	mux.HandleFunc("/api/me", func(w http.ResponseWriter, r *http.Request) {
		uid, isPrivy := resolveRequestIdentity(r)
		wallet := r.Header.Get("X-Wallet-Address")
		nick := r.Header.Get("X-Nickname")
		p, err := upsertPlayer(uid, wallet, nick)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]any{"player": p, "verifiedPrivy": isPrivy})
	})

	mux.HandleFunc("/api/faucet", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		uid, _ := resolveRequestIdentity(r)
		p, err := upsertPlayer(uid, r.Header.Get("X-Wallet-Address"), r.Header.Get("X-Nickname"))
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if p.Balance >= 1500 {
			w.Header().Set("Content-Type", "application/json")
			writeJSON(w, map[string]any{"credited": false, "player": p})
			return
		}
		p, err = adjustPlayerBalance(uid, 2500, nil, 0)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]any{"credited": true, "player": p})
	})

	// Phase 1: Global Match Telemetry & "Who Played & When" Analytics
	mux.HandleFunc("/api/matches", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		uid, _ := resolveRequestIdentity(r)
		var body struct {
			Player      string `json:"player"`
			Wallet      string `json:"wallet"`
			AssetA      string `json:"assetA"`
			AssetB      string `json:"assetB"`
			WinnerAsset string `json:"winnerAsset"`
			LoserAsset  string `json:"loserAsset"`
			WinReason   string `json:"winReason"`
			Wager       int64  `json:"wager"`
			Payout      int64  `json:"payout"`
			PlayerWon   bool   `json:"playerWon"`
			Weapon      string `json:"weapon"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			http.Error(w, "invalid json", http.StatusBadRequest)
			return
		}
		_, _ = upsertPlayer(uid, body.Wallet, body.Player)
		delta := -body.Wager
		streak := 0
		xpGain := 15
		if body.PlayerWon {
			delta = body.Payout - body.Wager
			streak = 1
			xpGain = 45
		}
		updated, _ := adjustPlayerBalance(uid, delta, &streak, xpGain)
		_ = insertMatch(MatchRecord{
			Mode:        "solo",
			PlayerADID:  uid,
			PlayerName:  body.Player,
			AssetA:      body.AssetA,
			AssetB:      body.AssetB,
			WinnerAsset: body.WinnerAsset,
			LoserAsset:  body.LoserAsset,
			WinReason:   body.WinReason,
			Wager:       body.Wager,
			Payout:      body.Payout,
			PlayerWon:   body.PlayerWon,
			Weapon:      body.Weapon,
		})
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, map[string]any{"ok": true, "player": updated})
	})

	mux.HandleFunc("/api/analytics", func(w http.ResponseWriter, r *http.Request) {
		summary, err := getAnalyticsSummary()
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		writeJSON(w, summary)
	})

	// Phase 2: Authoritative WebSocket Multiplayer Rooms
	mux.HandleFunc("/api/rooms", createRoomHandler)
	mux.HandleFunc("/ws/rooms/{otp}", roomWSHandler)

	// Static file server
	absStatic, _ := filepath.Abs(*staticDir)
	mux.Handle("/", http.FileServer(http.Dir(absStatic)))

	log.Printf("Vibe Stock Duels server listening on %s (static=%s, db=%s)", *addr, absStatic, *dbPath)
	log.Fatal(http.ListenAndServe(*addr, withCORS(mux)))
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin == "https://ayoola-tech2024.github.io" || origin == "http://localhost:8080" || origin == "https://vibe-stock-duels.onrender.com" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Guest-Id, X-Nickname, X-Wallet-Address")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

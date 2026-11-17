package main

import (
	"database/sql"
	"encoding/json"
	"log"
	"time"

	_ "modernc.org/sqlite"
)

type Player struct {
	ID            string `json:"id"`
	WalletAddress string `json:"walletAddress"`
	Nickname      string `json:"nickname"`
	Balance       int64  `json:"balance"`
	WinStreak     int    `json:"winStreak"`
	XP            int    `json:"xp"`
	CreatedAt     int64  `json:"createdAt"`
	LastSeenAt    int64  `json:"lastSeenAt"`
}

type MatchRecord struct {
	ID          int64  `json:"id"`
	Mode        string `json:"mode"`
	PlayerADID  string `json:"playerADid"`
	PlayerBDID  string `json:"playerBDid"`
	PlayerName  string `json:"player"`
	AssetA      string `json:"assetA"`
	AssetB      string `json:"assetB"`
	WinnerAsset string `json:"winnerAsset"`
	LoserAsset  string `json:"loserAsset"`
	WinReason   string `json:"winReason"`
	Wager       int64  `json:"wager"`
	Payout      int64  `json:"payout"`
	PlayerWon   bool   `json:"playerWon"`
	Weapon      string `json:"weapon"`
	PlayedAt    int64  `json:"playedAt"`
}

type AnalyticsSummary struct {
	TotalMatches  int64            `json:"totalMatches"`
	TotalPlayers  int64            `json:"totalPlayers"`
	TotalVolume   int64            `json:"totalVolume"`
	TotalBurned   int64            `json:"totalBurned"`
	AssetPicks    map[string]int64 `json:"assetPicks"`
	RecentMatches []MatchRecord    `json:"recentMatches"`
	RecentPlayers []Player         `json:"recentPlayers"`
}

var db *sql.DB

func initDB(path string) error {
	var err error
	db, err = sql.Open("sqlite", path)
	if err != nil {
		return err
	}
	db.SetMaxOpenConns(1) // SQLite single-writer safety

	schema := `
	CREATE TABLE IF NOT EXISTS players (
		id TEXT PRIMARY KEY,
		wallet_address TEXT DEFAULT '',
		nickname TEXT DEFAULT 'Raider',
		vct_balance INTEGER NOT NULL DEFAULT 2500,
		win_streak INTEGER NOT NULL DEFAULT 0,
		xp INTEGER NOT NULL DEFAULT 120,
		created_at INTEGER NOT NULL,
		last_seen_at INTEGER NOT NULL
	);

	CREATE TABLE IF NOT EXISTS matches (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		mode TEXT NOT NULL DEFAULT 'solo',
		player_a_did TEXT NOT NULL,
		player_b_did TEXT DEFAULT '',
		player_name TEXT NOT NULL,
		asset_a TEXT NOT NULL,
		asset_b TEXT NOT NULL,
		winner_asset TEXT NOT NULL,
		loser_asset TEXT NOT NULL,
		win_reason TEXT NOT NULL DEFAULT 'HP Decision',
		wager INTEGER NOT NULL,
		payout INTEGER NOT NULL,
		player_won INTEGER NOT NULL,
		weapon TEXT NOT NULL DEFAULT 'broadsword',
		played_at INTEGER NOT NULL
	);

	CREATE INDEX IF NOT EXISTS idx_matches_played_at ON matches(played_at DESC);
	CREATE INDEX IF NOT EXISTS idx_players_last_seen ON players(last_seen_at DESC);
	`
	_, err = db.Exec(schema)
	return err
}

func upsertPlayer(id, wallet, nickname string) (Player, error) {
	now := time.Now().UnixMilli()
	if nickname == "" {
		nickname = "Raider"
	}
	_, err := db.Exec(`
		INSERT INTO players (id, wallet_address, nickname, vct_balance, win_streak, xp, created_at, last_seen_at)
		VALUES (?, ?, ?, 2500, 0, 120, ?, ?)
		ON CONFLICT(id) DO UPDATE SET
			wallet_address = CASE WHEN excluded.wallet_address != '' THEN excluded.wallet_address ELSE players.wallet_address END,
			nickname = CASE WHEN excluded.nickname != 'Raider' AND excluded.nickname != '' THEN excluded.nickname ELSE players.nickname END,
			last_seen_at = excluded.last_seen_at
	`, id, wallet, nickname, now, now)
	if err != nil {
		return Player{}, err
	}
	return getPlayer(id)
}

func getPlayer(id string) (Player, error) {
	var p Player
	err := db.QueryRow(`
		SELECT id, wallet_address, nickname, vct_balance, win_streak, xp, created_at, last_seen_at
		FROM players WHERE id = ?
	`, id).Scan(&p.ID, &p.WalletAddress, &p.Nickname, &p.Balance, &p.WinStreak, &p.XP, &p.CreatedAt, &p.LastSeenAt)
	return p, err
}

func adjustPlayerBalance(id string, delta int64, streakDelta *int, xpGain int) (Player, error) {
	tx, err := db.Begin()
	if err != nil {
		return Player{}, err
	}
	defer tx.Rollback()

	var bal int64
	var streak, xp int
	err = tx.QueryRow(`SELECT vct_balance, win_streak, xp FROM players WHERE id = ?`, id).Scan(&bal, &streak, &xp)
	if err != nil {
		return Player{}, err
	}
	newBal := bal + delta
	if newBal < 0 {
		newBal = 0
	}
	newStreak := streak
	if streakDelta != nil {
		if *streakDelta == 0 {
			newStreak = 0
		} else {
			newStreak += *streakDelta
		}
	}
	newXP := xp + xpGain

	_, err = tx.Exec(`
		UPDATE players SET vct_balance = ?, win_streak = ?, xp = ?, last_seen_at = ? WHERE id = ?
	`, newBal, newStreak, newXP, time.Now().UnixMilli(), id)
	if err != nil {
		return Player{}, err
	}
	if err := tx.Commit(); err != nil {
		return Player{}, err
	}
	return getPlayer(id)
}

func insertMatch(m MatchRecord) error {
	wonInt := 0
	if m.PlayerWon {
		wonInt = 1
	}
	if m.PlayedAt == 0 {
		m.PlayedAt = time.Now().UnixMilli()
	}
	_, err := db.Exec(`
		INSERT INTO matches (mode, player_a_did, player_b_did, player_name, asset_a, asset_b, winner_asset, loser_asset, win_reason, wager, payout, player_won, weapon, played_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
	`, m.Mode, m.PlayerADID, m.PlayerBDID, m.PlayerName, m.AssetA, m.AssetB, m.WinnerAsset, m.LoserAsset, m.WinReason, m.Wager, m.Payout, wonInt, m.Weapon, m.PlayedAt)
	return err
}

func getAnalyticsSummary() (AnalyticsSummary, error) {
	out := AnalyticsSummary{
		AssetPicks:    make(map[string]int64),
		RecentMatches: []MatchRecord{},
		RecentPlayers: []Player{},
	}

	err := db.QueryRow(`SELECT COUNT(*), COALESCE(SUM(wager), 0) FROM matches`).Scan(&out.TotalMatches, &out.TotalVolume)
	if err != nil {
		return out, err
	}
	out.TotalBurned = out.TotalVolume / 20

	_ = db.QueryRow(`SELECT COUNT(*) FROM players`).Scan(&out.TotalPlayers)

	rows, err := db.Query(`
		SELECT asset_a, asset_b FROM matches ORDER BY id DESC LIMIT 500
	`)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var a, b string
			if err := rows.Scan(&a, &b); err == nil {
				out.AssetPicks[a]++
				out.AssetPicks[b]++
			}
		}
	}

	mRows, err := db.Query(`
		SELECT id, mode, player_a_did, player_b_did, player_name, asset_a, asset_b, winner_asset, loser_asset, win_reason, wager, payout, player_won, weapon, played_at
		FROM matches ORDER BY played_at DESC LIMIT 25
	`)
	if err == nil {
		defer mRows.Close()
		for mRows.Next() {
			var m MatchRecord
			var wonInt int
			if err := mRows.Scan(&m.ID, &m.Mode, &m.PlayerADID, &m.PlayerBDID, &m.PlayerName, &m.AssetA, &m.AssetB, &m.WinnerAsset, &m.LoserAsset, &m.WinReason, &m.Wager, &m.Payout, &wonInt, &m.Weapon, &m.PlayedAt); err == nil {
				m.PlayerWon = wonInt == 1
				out.RecentMatches = append(out.RecentMatches, m)
			}
		}
	}

	pRows, err := db.Query(`
		SELECT id, wallet_address, nickname, vct_balance, win_streak, xp, created_at, last_seen_at
		FROM players ORDER BY last_seen_at DESC LIMIT 25
	`)
	if err == nil {
		defer pRows.Close()
		for pRows.Next() {
			var p Player
			if err := pRows.Scan(&p.ID, &p.WalletAddress, &p.Nickname, &p.Balance, &p.WinStreak, &p.XP, &p.CreatedAt, &p.LastSeenAt); err == nil {
				out.RecentPlayers = append(out.RecentPlayers, p)
			}
		}
	}

	return out, nil
}

func writeJSON(w interface{ Write([]byte) (int, error) }, v any) {
	b, err := json.Marshal(v)
	if err != nil {
		log.Println("json marshal error:", err)
		return
	}
	_, _ = w.Write(b)
}

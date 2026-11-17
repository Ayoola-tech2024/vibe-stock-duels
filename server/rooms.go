package main

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"math/big"
	"net/http"
	"sync"
	"time"

	"github.com/coder/websocket"
)

type PlayerSlot struct {
	UserID        string
	Nickname      string
	Side          string // "A" or "B"
	Asset         string
	Weapon        string
	Wager         int64
	Locked        bool
	Connected     bool
	LastSeen      time.Time
	LastJabAt     time.Time
	ComboCount    int
	Rage          float64
	ShieldTicks   int
	LeverageTicks int
	Conn          *websocket.Conn
}

type Room struct {
	OTP        string
	Duration   int
	Timer      int
	TickCount  int
	Active     bool
	Finished   bool
	StartPriceA float64
	StartPriceB float64
	PriceA     float64
	PriceB     float64
	PrevPriceA float64
	PrevPriceB float64
	HPA        float64
	HPB        float64
	PlayerA    *PlayerSlot
	PlayerB    *PlayerSlot
	mu         sync.Mutex
	stopCh     chan struct{}
}

type WSMessage struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload,omitempty"`
}

var (
	roomsMu sync.RWMutex
	rooms   = map[string]*Room{}
)

func generateOTP() string {
	n, _ := rand.Int(rand.Reader, big.NewInt(900000))
	return fmt.Sprintf("%06d", n.Int64()+100000)
}

func createRoomHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	otp := generateOTP()
	room := &Room{
		OTP:      otp,
		Duration: 60,
		Timer:    60,
		HPA:      100,
		HPB:      100,
		stopCh:   make(chan struct{}),
	}
	roomsMu.Lock()
	rooms[otp] = room
	roomsMu.Unlock()

	w.Header().Set("Content-Type", "application/json")
	writeJSON(w, map[string]string{"otp": otp})
}

func roomWSHandler(w http.ResponseWriter, r *http.Request) {
	otp := r.PathValue("otp")
	roomsMu.RLock()
	room, ok := rooms[otp]
	roomsMu.RUnlock()
	if !ok {
		http.Error(w, "room not found", http.StatusNotFound)
		return
	}

	userID, _ := resolveRequestIdentity(r)
	nickname := r.URL.Query().Get("name")
	if nickname == "" {
		nickname = "Raider"
	}
	_, _ = upsertPlayer(userID, "", nickname)

	conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
	})
	if err != nil {
		log.Println("ws accept error:", err)
		return
	}
	defer conn.Close(websocket.StatusNormalClosure, "bye")

	slot := room.attachPlayer(userID, nickname, conn)
	if slot == nil {
		_ = sendWS(conn, "ERROR", map[string]string{"message": "Room is full"})
		return
	}
	room.broadcastRoomState()

	defer func() {
		room.handleDisconnect(slot)
	}()

	ctx := r.Context()
	for {
		_, data, err := conn.Read(ctx)
		if err != nil {
			return
		}
		var msg WSMessage
		if err := json.Unmarshal(data, &msg); err != nil {
			continue
		}
		room.handleIntent(slot, msg)
	}
}

func (rm *Room) attachPlayer(userID, nickname string, conn *websocket.Conn) *PlayerSlot {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	// Reconnect existing slot within grace period
	if rm.PlayerA != nil && rm.PlayerA.UserID == userID {
		rm.PlayerA.Conn = conn
		rm.PlayerA.Connected = true
		rm.PlayerA.LastSeen = time.Now()
		return rm.PlayerA
	}
	if rm.PlayerB != nil && rm.PlayerB.UserID == userID {
		rm.PlayerB.Conn = conn
		rm.PlayerB.Connected = true
		rm.PlayerB.LastSeen = time.Now()
		return rm.PlayerB
	}

	if rm.PlayerA == nil {
		rm.PlayerA = &PlayerSlot{
			UserID:    userID,
			Nickname:  nickname,
			Side:      "A",
			Asset:     "BTC",
			Weapon:    "broadsword",
			Connected: true,
			LastSeen:  time.Now(),
			Rage:      25,
			Conn:      conn,
		}
		return rm.PlayerA
	}
	if rm.PlayerB == nil {
		rm.PlayerB = &PlayerSlot{
			UserID:    userID,
			Nickname:  nickname,
			Side:      "B",
			Asset:     "SOL",
			Weapon:    "katana",
			Connected: true,
			LastSeen:  time.Now(),
			Rage:      25,
			Conn:      conn,
		}
		return rm.PlayerB
	}
	return nil
}

func (rm *Room) handleDisconnect(slot *PlayerSlot) {
	rm.mu.Lock()
	slot.Connected = false
	slot.LastSeen = time.Now()
	active := rm.Active && !rm.Finished
	rm.mu.Unlock()

	rm.broadcastRoomState()

	if !active {
		return
	}

	// 15s reconnect grace period before forfeit
	go func() {
		time.Sleep(15 * time.Second)
		rm.mu.Lock()
		defer rm.mu.Unlock()
		if rm.Finished || !rm.Active || slot.Connected {
			return
		}
		winner := "A"
		if slot.Side == "A" {
			winner = "B"
		}
		rm.resolveLocked(winner, "Opponent Disconnect Forfeit")
	}()
}

func (rm *Room) handleIntent(slot *PlayerSlot, msg WSMessage) {
	rm.mu.Lock()
	defer rm.mu.Unlock()

	switch msg.Type {
	case "SELECT_ASSET":
		if rm.Active {
			return
		}
		var p struct {
			Asset string `json:"asset"`
		}
		if json.Unmarshal(msg.Payload, &p) == nil && p.Asset != "" {
			slot.Asset = p.Asset
		}
		rm.broadcastRoomStateLocked()

	case "SELECT_WEAPON":
		if rm.Active {
			return
		}
		var p struct {
			Weapon string `json:"weapon"`
		}
		if json.Unmarshal(msg.Payload, &p) == nil && p.Weapon != "" {
			slot.Weapon = p.Weapon
		}
		rm.broadcastRoomStateLocked()

	case "LOCK_WAGER":
		if rm.Active {
			return
		}
		var p struct {
			Amount int64 `json:"amount"`
		}
		if json.Unmarshal(msg.Payload, &p) != nil || p.Amount <= 0 {
			return
		}
		player, err := getPlayer(slot.UserID)
		if err != nil || player.Balance < p.Amount {
			_ = sendWS(slot.Conn, "ERROR", map[string]string{"message": "Insufficient $VCT balance"})
			return
		}
		slot.Wager = p.Amount
		slot.Locked = true
		rm.broadcastRoomStateLocked()

		if rm.PlayerA != nil && rm.PlayerB != nil && rm.PlayerA.Locked && rm.PlayerB.Locked {
			rm.startMatchLocked()
		}

	case "USE_SKILL":
		if !rm.Active || rm.Finished {
			return
		}
		var p struct {
			Skill string `json:"skill"`
		}
		if json.Unmarshal(msg.Payload, &p) != nil {
			return
		}
		rm.applySkillLocked(slot, p.Skill)

	case "EMOTE":
		var p struct {
			Text string `json:"text"`
		}
		if json.Unmarshal(msg.Payload, &p) == nil && p.Text != "" {
			rm.broadcastLocked("SKILL_EFFECT", map[string]any{
				"side":  slot.Side,
				"skill": "EMOTE",
				"text":  p.Text,
			})
		}
	}
}

func (rm *Room) startMatchLocked() {
	// Escrow wagers
	_, _ = adjustPlayerBalance(rm.PlayerA.UserID, -rm.PlayerA.Wager, nil, 0)
	_, _ = adjustPlayerBalance(rm.PlayerB.UserID, -rm.PlayerB.Wager, nil, 0)

	rm.Active = true
	rm.Finished = false
	rm.Timer = rm.Duration
	rm.TickCount = 0
	rm.HPA = 100
	rm.HPB = 100
	rm.PlayerA.Rage = 25
	rm.PlayerB.Rage = 25
	if rm.PlayerA.Asset == "ETH" {
		rm.PlayerA.Rage = 40
	}
	if rm.PlayerB.Asset == "ETH" {
		rm.PlayerB.Rage = 40
	}

	rm.StartPriceA = fetchAssetPrice(rm.PlayerA.Asset)
	rm.StartPriceB = fetchAssetPrice(rm.PlayerB.Asset)
	rm.PriceA = rm.StartPriceA
	rm.PriceB = rm.StartPriceB
	rm.PrevPriceA = rm.StartPriceA
	rm.PrevPriceB = rm.StartPriceB

	rm.broadcastLocked("MATCH_START", map[string]any{
		"assetA":      rm.PlayerA.Asset,
		"assetB":      rm.PlayerB.Asset,
		"weaponA":     rm.PlayerA.Weapon,
		"weaponB":     rm.PlayerB.Weapon,
		"startPriceA": rm.StartPriceA,
		"startPriceB": rm.StartPriceB,
		"duration":    rm.Duration,
	})

	go rm.runMatchLoop()
}

func (rm *Room) runMatchLoop() {
	secTicker := time.NewTicker(1 * time.Second)
	oracleTicker := time.NewTicker(1500 * time.Millisecond)
	defer secTicker.Stop()
	defer oracleTicker.Stop()

	for {
		select {
		case <-rm.stopCh:
			return
		case <-secTicker.C:
			rm.mu.Lock()
			if !rm.Active || rm.Finished {
				rm.mu.Unlock()
				return
			}
			rm.Timer--
			if rm.Timer <= 0 {
				rm.resolveByRulesLocked()
				rm.mu.Unlock()
				return
			}
			rm.mu.Unlock()

		case <-oracleTicker.C:
			rm.mu.Lock()
			if !rm.Active || rm.Finished {
				rm.mu.Unlock()
				return
			}
			rm.processTickLocked()
			if rm.HPA <= 0 || rm.HPB <= 0 {
				rm.resolveByRulesLocked()
				rm.mu.Unlock()
				return
			}
			rm.mu.Unlock()
		}
	}
}

func (rm *Room) processTickLocked() {
	rm.PrevPriceA = rm.PriceA
	rm.PrevPriceB = rm.PriceB
	rm.PriceA = fetchAssetPrice(rm.PlayerA.Asset)
	rm.PriceB = fetchAssetPrice(rm.PlayerB.Asset)
	rm.TickCount++

	cumA := ((rm.PriceA - rm.StartPriceA) / rm.StartPriceA) * 100
	cumB := ((rm.PriceB - rm.StartPriceB) / rm.StartPriceB) * 100
	stepA := ((rm.PriceA - rm.PrevPriceA) / rm.PrevPriceA) * 100
	stepB := ((rm.PriceB - rm.PrevPriceB) / rm.PrevPriceB) * 100

	attackerSide := "A"
	if stepB > stepA {
		attackerSide = "B"
	}

	rm.PlayerA.Rage = math.Min(100, rm.PlayerA.Rage+14)
	rm.PlayerB.Rage = math.Min(100, rm.PlayerB.Rage+14)

	stepDiff := math.Abs(stepA - stepB)
	cumDiff := math.Abs(cumA - cumB)
	climaxMult := 1.0
	if rm.Timer <= 12 {
		climaxMult = 1.65
	}
	rawDmg := math.Min(2.35, math.Max(0.95, stepDiff*2.2+cumDiff*0.55)) * climaxMult
	isCrit := stepDiff >= 0.50 || cumDiff >= 1.35
	if isCrit {
		rawDmg *= 1.30
	}

	minFloor := 0.0
	if rm.Timer > 12 {
		minFloor = 8.0
	}

	finalDmg := rawDmg
	if attackerSide == "A" {
		if rm.PlayerA.LeverageTicks > 0 {
			finalDmg *= 1.75
		}
		if rm.PlayerB.ShieldTicks > 0 {
			finalDmg *= 0.20
		}
		rm.HPB = math.Max(minFloor, rm.HPB-finalDmg)
	} else {
		if rm.PlayerB.LeverageTicks > 0 {
			finalDmg *= 1.75
		}
		if rm.PlayerA.ShieldTicks > 0 {
			finalDmg *= 0.20
		}
		rm.HPA = math.Max(minFloor, rm.HPA-finalDmg)
	}

	if rm.PlayerA.ShieldTicks > 0 {
		rm.PlayerA.ShieldTicks--
	}
	if rm.PlayerB.ShieldTicks > 0 {
		rm.PlayerB.ShieldTicks--
	}
	if rm.PlayerA.LeverageTicks > 0 {
		rm.PlayerA.LeverageTicks--
	}
	if rm.PlayerB.LeverageTicks > 0 {
		rm.PlayerB.LeverageTicks--
	}

	rm.broadcastLocked("COMBAT_TICK", map[string]any{
		"tickCount":    rm.TickCount,
		"timer":        rm.Timer,
		"priceA":       rm.PriceA,
		"priceB":       rm.PriceB,
		"cumChangeA":   cumA,
		"cumChangeB":   cumB,
		"hpA":          rm.HPA,
		"hpB":          rm.HPB,
		"rageA":        rm.PlayerA.Rage,
		"rageB":        rm.PlayerB.Rage,
		"attackerSide": attackerSide,
		"dmg":          finalDmg,
		"isCrit":       isCrit,
	})
}

func (rm *Room) applySkillLocked(slot *PlayerSlot, skill string) {
	now := time.Now()
	minFloor := 0.0
	if rm.Timer > 12 {
		minFloor = 8.0
	}

	switch skill {
	case "JAB":
		if now.Sub(slot.LastJabAt) < 220*time.Millisecond {
			return // Server anti-macro throttle
		}
		if now.Sub(slot.LastJabAt) < 2200*time.Millisecond {
			slot.ComboCount++
		} else {
			slot.ComboCount = 1
		}
		slot.LastJabAt = now
		slot.Rage = math.Min(100, slot.Rage+7)
		chip := 0.75
		if slot.ComboCount >= 5 {
			chip = 1.15
		}
		if slot.LeverageTicks > 0 {
			chip *= 1.75
		}
		if slot.Side == "A" {
			rm.HPB = math.Max(minFloor, rm.HPB-chip)
		} else {
			rm.HPA = math.Max(minFloor, rm.HPA-chip)
		}
		rm.broadcastLocked("SKILL_EFFECT", map[string]any{
			"side":   slot.Side,
			"skill":  "JAB",
			"chip":   chip,
			"combo":  slot.ComboCount,
			"hpA":    rm.HPA,
			"hpB":    rm.HPB,
			"rageA":  rm.PlayerA.Rage,
			"rageB":  rm.PlayerB.Rage,
		})

	case "SHIELD":
		if slot.Rage < 40 {
			return
		}
		slot.Rage -= 40
		slot.ShieldTicks = 3
		if slot.Side == "A" {
			rm.HPA = math.Min(100, rm.HPA+4)
		} else {
			rm.HPB = math.Min(100, rm.HPB+4)
		}
		rm.broadcastLocked("SKILL_EFFECT", map[string]any{
			"side":  slot.Side,
			"skill": "SHIELD",
			"hpA":   rm.HPA,
			"hpB":   rm.HPB,
			"rageA": rm.PlayerA.Rage,
			"rageB": rm.PlayerB.Rage,
		})

	case "LEVERAGE":
		if slot.Rage < 65 {
			return
		}
		slot.Rage -= 65
		slot.LeverageTicks = 4
		rm.broadcastLocked("SKILL_EFFECT", map[string]any{
			"side":  slot.Side,
			"skill": "LEVERAGE",
			"rageA": rm.PlayerA.Rage,
			"rageB": rm.PlayerB.Rage,
		})

	case "ULTIMATE":
		if slot.Rage < 95 {
			return
		}
		slot.Rage = 0
		if slot.Side == "A" {
			rm.HPB = math.Max(minFloor, rm.HPB-14)
		} else {
			rm.HPA = math.Max(minFloor, rm.HPA-14)
		}
		rm.broadcastLocked("SKILL_EFFECT", map[string]any{
			"side":  slot.Side,
			"skill": "ULTIMATE",
			"hpA":   rm.HPA,
			"hpB":   rm.HPB,
			"rageA": rm.PlayerA.Rage,
			"rageB": rm.PlayerB.Rage,
		})
		if rm.HPA <= 0 || rm.HPB <= 0 {
			rm.resolveByRulesLocked()
		}
	}
}

func (rm *Room) resolveByRulesLocked() {
	cumA := ((rm.PriceA - rm.StartPriceA) / rm.StartPriceA) * 100
	cumB := ((rm.PriceB - rm.StartPriceB) / rm.StartPriceB) * 100

	winner := "A"
	reason := "Oracle Tiebreak"
	if rm.HPA <= 0 && rm.HPB > 0 {
		winner = "B"
		reason = "3D Voxel KO"
	} else if rm.HPB <= 0 && rm.HPA > 0 {
		winner = "A"
		reason = "3D Voxel KO"
	} else if math.Abs(rm.HPA-rm.HPB) >= 0.05 {
		if rm.HPB > rm.HPA {
			winner = "B"
		}
		reason = fmt.Sprintf("HP Decision (%d vs %d HP)", int(math.Round(rm.HPA)), int(math.Round(rm.HPB)))
	} else if cumB > cumA {
		winner = "B"
	}
	rm.resolveLocked(winner, reason)
}

func (rm *Room) resolveLocked(winnerSide, reason string) {
	if rm.Finished {
		return
	}
	rm.Finished = true
	rm.Active = false
	select {
	case <-rm.stopCh:
	default:
		close(rm.stopCh)
	}

	pot := rm.PlayerA.Wager + rm.PlayerB.Wager
	payout := int64(float64(pot) * 0.95)
	winSlot := rm.PlayerA
	loseSlot := rm.PlayerB
	if winnerSide == "B" {
		winSlot = rm.PlayerB
		loseSlot = rm.PlayerA
	}

	one := 1
	zero := 0
	_, _ = adjustPlayerBalance(winSlot.UserID, payout, &one, 45)
	_, _ = adjustPlayerBalance(loseSlot.UserID, 0, &zero, 15)

	_ = insertMatch(MatchRecord{
		Mode:        "pvp_ws",
		PlayerADID:  rm.PlayerA.UserID,
		PlayerBDID:  rm.PlayerB.UserID,
		PlayerName:  winSlot.Nickname,
		AssetA:      rm.PlayerA.Asset,
		AssetB:      rm.PlayerB.Asset,
		WinnerAsset: winSlot.Asset,
		LoserAsset:  loseSlot.Asset,
		WinReason:   reason,
		Wager:       pot,
		Payout:      payout,
		PlayerWon:   true,
		Weapon:      winSlot.Weapon,
	})

	rm.broadcastLocked("MATCH_END", map[string]any{
		"winner":    winnerSide,
		"winReason": reason,
		"priceA":    rm.PriceA,
		"priceB":    rm.PriceB,
		"hpA":       rm.HPA,
		"hpB":       rm.HPB,
		"payout":    payout,
	})
}

func (rm *Room) broadcastRoomState() {
	rm.mu.Lock()
	defer rm.mu.Unlock()
	rm.broadcastRoomStateLocked()
}

func (rm *Room) broadcastRoomStateLocked() {
	rm.broadcastLocked("ROOM_STATE", map[string]any{
		"otp":     rm.OTP,
		"active":  rm.Active,
		"playerA": slotSummary(rm.PlayerA),
		"playerB": slotSummary(rm.PlayerB),
	})
}

func slotSummary(s *PlayerSlot) map[string]any {
	if s == nil {
		return nil
	}
	return map[string]any{
		"nickname":  s.Nickname,
		"asset":     s.Asset,
		"weapon":    s.Weapon,
		"wager":     s.Wager,
		"locked":    s.Locked,
		"connected": s.Connected,
	}
}

func (rm *Room) broadcastLocked(msgType string, payload any) {
	if rm.PlayerA != nil && rm.PlayerA.Conn != nil && rm.PlayerA.Connected {
		_ = sendWS(rm.PlayerA.Conn, msgType, payload)
	}
	if rm.PlayerB != nil && rm.PlayerB.Conn != nil && rm.PlayerB.Connected {
		_ = sendWS(rm.PlayerB.Conn, msgType, payload)
	}
}

func sendWS(conn *websocket.Conn, msgType string, payload any) error {
	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	packet, err := json.Marshal(WSMessage{Type: msgType, Payload: raw})
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	return conn.Write(ctx, websocket.MessageText, packet)
}

package main

import (
	"encoding/json"
	"math/rand"
	"net/http"
	"sync"
	"time"
)

var basePrices = map[string]float64{
	"BTC":     85420.0,
	"ETH":     3180.0,
	"SOL":     184.5,
	"BNB":     612.0,
	"DOGE":    0.342,
	"NVDA":    142.8,
	"TSLA":    328.5,
	"AAPL":    229.0,
	"MSFT":    422.0,
	"AMZN":    208.0,
	"OPENAI":  185.0,
	"SPACEX":  240.0,
	"STRIPE":  96.0,
	"ANDURIL": 78.0,
	"DANGOTE": 41.5,
}

var binanceSymbols = map[string]string{
	"BTC":  "BTCUSDT",
	"ETH":  "ETHUSDT",
	"SOL":  "SOLUSDT",
	"BNB":  "BNBUSDT",
	"DOGE": "DOGEUSDT",
}

type cachedPrice struct {
	price     float64
	fetchedAt time.Time
}

var (
	priceMu    sync.Mutex
	priceCache = map[string]cachedPrice{}
	rng        = rand.New(rand.NewSource(time.Now().UnixNano()))
)

func fetchAssetPrice(asset string) float64 {
	priceMu.Lock()
	if cp, ok := priceCache[asset]; ok && time.Since(cp.fetchedAt) < 1200*time.Millisecond {
		priceMu.Unlock()
		return cp.price
	}
	priceMu.Unlock()

	base := basePrices[asset]
	if base == 0 {
		base = 100.0
	}

	if sym, isCrypto := binanceSymbols[asset]; isCrypto {
		client := &http.Client{Timeout: 1400 * time.Millisecond}
		resp, err := client.Get("https://api.binance.com/api/v3/ticker/price?symbol=" + sym)
		if err == nil {
			defer resp.Body.Close()
			var res struct {
				Price string `json:"price"`
			}
			if json.NewDecoder(resp.Body).Decode(&res) == nil && res.Price != "" {
				var parsed float64
				if _, err := parseFloat(res.Price, &parsed); err == nil && parsed > 0 {
					priceMu.Lock()
					priceCache[asset] = cachedPrice{price: parsed, fetchedAt: time.Now()}
					priceMu.Unlock()
					return parsed
				}
			}
		}
	}

	// Micro-walk fallback (used for non-Binance assets or if offline)
	priceMu.Lock()
	defer priceMu.Unlock()
	prev := base
	if cp, ok := priceCache[asset]; ok {
		prev = cp.price
	}
	drift := (rng.Float64() - 0.495) * 0.0045
	next := prev * (1.0 + drift)
	priceCache[asset] = cachedPrice{price: next, fetchedAt: time.Now()}
	return next
}

func parseFloat(s string, out *float64) (bool, error) {
	var v float64
	err := json.Unmarshal([]byte(s), &v)
	if err != nil {
		return false, err
	}
	*out = v
	return true, nil
}

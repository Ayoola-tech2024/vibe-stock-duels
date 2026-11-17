package main

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

const privyAppID = "cmwl1e3nz00ma0hjv6ane856f"
const privyJWKSURL = "https://auth.privy.io/api/v1/apps/" + privyAppID + "/jwks.json"

type jwkKey struct {
	Kty string `json:"kty"`
	Kid string `json:"kid"`
	Alg string `json:"alg"`
	Crv string `json:"crv"`
	X   string `json:"x"`
	Y   string `json:"y"`
	N   string `json:"n"`
	E   string `json:"e"`
}

type jwksResponse struct {
	Keys []jwkKey `json:"keys"`
}

var (
	jwksMu        sync.RWMutex
	jwksCache     = map[string]any{}
	jwksFetchedAt time.Time
)

func fetchPrivyJWKS() error {
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Get(privyJWKSURL)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	var data jwksResponse
	if err := json.NewDecoder(resp.Body).Decode(&data); err != nil {
		return err
	}

	parsed := make(map[string]any)
	for _, k := range data.Keys {
		switch k.Kty {
		case "EC":
			xBytes, err1 := base64.RawURLEncoding.DecodeString(k.X)
			yBytes, err2 := base64.RawURLEncoding.DecodeString(k.Y)
			if err1 == nil && err2 == nil {
				var curve elliptic.Curve
				switch k.Crv {
				case "P-256":
					curve = elliptic.P256()
				case "P-384":
					curve = elliptic.P384()
				}
				if curve != nil {
					parsed[k.Kid] = &ecdsa.PublicKey{
						Curve: curve,
						X:     new(big.Int).SetBytes(xBytes),
						Y:     new(big.Int).SetBytes(yBytes),
					}
				}
			}
		case "RSA":
			nBytes, err1 := base64.RawURLEncoding.DecodeString(k.N)
			eBytes, err2 := base64.RawURLEncoding.DecodeString(k.E)
			if err1 == nil && err2 == nil {
				eInt := int(new(big.Int).SetBytes(eBytes).Int64())
				parsed[k.Kid] = &rsa.PublicKey{
					N: new(big.Int).SetBytes(nBytes),
					E: eInt,
				}
			}
		}
	}

	jwksMu.Lock()
	jwksCache = parsed
	jwksFetchedAt = time.Now()
	jwksMu.Unlock()
	return nil
}

func getKeyByKid(kid string) (any, error) {
	jwksMu.RLock()
	k, ok := jwksCache[kid]
	expired := time.Since(jwksFetchedAt) > 15*time.Minute
	jwksMu.RUnlock()

	if ok && !expired {
		return k, nil
	}
	if err := fetchPrivyJWKS(); err != nil {
		if ok {
			return k, nil
		}
		return nil, err
	}
	jwksMu.RLock()
	k, ok = jwksCache[kid]
	jwksMu.RUnlock()
	if !ok {
		return nil, fmt.Errorf("privy jwk kid %q not found", kid)
	}
	return k, nil
}

func verifyPrivyJWT(tokenStr string) (string, error) {
	if tokenStr == "" {
		return "", errors.New("empty token")
	}
	token, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		kid, _ := t.Header["kid"].(string)
		if kid == "" {
			return nil, errors.New("missing kid header")
		}
		return getKeyByKid(kid)
	}, jwt.WithAudience(privyAppID), jwt.WithIssuer("privy.io"))
	if err != nil {
		return "", err
	}
	sub, err := token.Claims.GetSubject()
	if err != nil || sub == "" {
		return "", errors.New("missing subject in privy jwt")
	}
	return sub, nil
}

// resolveRequestIdentity extracts a verified Privy DID from Bearer token,
// or falls back to X-Guest-Id for unauthenticated casual play.
func resolveRequestIdentity(r *http.Request) (userID string, isPrivy bool) {
	auth := r.Header.Get("Authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		tok := strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
		if did, err := verifyPrivyJWT(tok); err == nil {
			return did, true
		}
	}
	if qTok := r.URL.Query().Get("token"); qTok != "" {
		if did, err := verifyPrivyJWT(qTok); err == nil {
			return did, true
		}
	}
	guest := strings.TrimSpace(r.Header.Get("X-Guest-Id"))
	if guest == "" {
		guest = strings.TrimSpace(r.URL.Query().Get("guest"))
	}
	if guest == "" {
		guest = "guest-anon"
	}
	return "guest:" + guest, false
}

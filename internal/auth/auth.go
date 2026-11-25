// Package auth holds password hashing and JWT logic. It knows nothing about
// HTTP routes or the database, which keeps it small and easy to test.
package auth

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const tokenTTL = 24 * time.Hour

// bcrypt silently ignores bytes past 72, so callers must reject longer passwords.
const MaxPasswordBytes = 72

// HashPassword returns a salted, deliberately slow bcrypt hash. The salt and
// cost are stored inside the hash string itself.
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}

func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// IssueToken signs a JWT whose subject is the user id. The API stays stateless:
// any instance with the secret can verify the token, with no session store.
func IssueToken(secret string, userID int64) (string, error) {
	now := time.Now()
	claims := jwt.RegisteredClaims{
		Subject:   strconv.FormatInt(userID, 10),
		IssuedAt:  jwt.NewNumericDate(now),
		ExpiresAt: jwt.NewNumericDate(now.Add(tokenTTL)),
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// ParseToken verifies the signature and expiry and returns the user id.
// Pinning the algorithm blocks the classic "alg: none" / algorithm-swap attacks.
func ParseToken(secret, token string) (int64, error) {
	var claims jwt.RegisteredClaims
	_, err := jwt.ParseWithClaims(token, &claims, func(*jwt.Token) (any, error) {
		return []byte(secret), nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithExpirationRequired())
	if err != nil {
		return 0, err
	}
	return strconv.ParseInt(claims.Subject, 10, 64)
}

type ctxKey struct{}

// UserID returns the authenticated user id placed in the context by Middleware.
func UserID(ctx context.Context) (int64, bool) {
	id, ok := ctx.Value(ctxKey{}).(int64)
	return id, ok
}

var errNoToken = errors.New("missing bearer token")

// Middleware rejects requests without a valid "Authorization: Bearer <jwt>".
func Middleware(secret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			tok, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
			if !ok || tok == "" {
				http.Error(w, `{"error":"`+errNoToken.Error()+`"}`, http.StatusUnauthorized)
				return
			}
			id, err := ParseToken(secret, tok)
			if err != nil {
				http.Error(w, `{"error":"invalid or expired token"}`, http.StatusUnauthorized)
				return
			}
			next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxKey{}, id)))
		})
	}
}

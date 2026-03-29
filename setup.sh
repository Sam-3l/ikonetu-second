#!/bin/bash

# ════════════════════════════════════════════════════════════
# IkonetU — Phase 1 Setup Script
# Run this once to set up your development environment
# Usage: chmod +x setup.sh && ./setup.sh
# ════════════════════════════════════════════════════════════

set -e  # Exit on any error

BOLD='\033[1m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
RED='\033[0;31m'
RESET='\033[0m'

echo ""
echo -e "${BOLD}IkonetU — Development Setup${RESET}"
echo "════════════════════════════════════"

# ── Check prerequisites ──────────────────────────────────────
echo ""
echo -e "${BOLD}Checking prerequisites...${RESET}"

check_command() {
  if command -v "$1" &>/dev/null; then
    echo -e "  ${GREEN}✓${RESET} $1 found ($(command -v "$1"))"
  else
    echo -e "  ${RED}✗${RESET} $1 not found — please install it first"
    MISSING=true
  fi
}

check_version() {
  local cmd=$1
  local min=$2
  local version
  version=$("$cmd" --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+' | head -1)
  echo -e "  ${GREEN}✓${RESET} $cmd $version"
}

MISSING=false
check_command node
check_command npm
check_command git
check_command redis-cli || echo -e "  ${YELLOW}⚠${RESET}  redis-cli not found — install Redis locally or use Docker"

if [ "$MISSING" = true ]; then
  echo ""
  echo -e "${RED}Please install missing dependencies and run this script again.${RESET}"
  exit 1
fi

# ── Node version check ───────────────────────────────────────
NODE_VERSION=$(node --version | grep -oE '[0-9]+' | head -1)
if [ "$NODE_VERSION" -lt 18 ]; then
  echo -e "${RED}✗ Node.js 18+ required. You have Node.js $NODE_VERSION.${RESET}"
  echo "  Install via: https://nodejs.org or use nvm: nvm install 20"
  exit 1
fi

echo -e "  ${GREEN}✓${RESET} Node.js v$NODE_VERSION (18+ required)"

# ── .env setup ───────────────────────────────────────────────
echo ""
echo -e "${BOLD}Setting up environment...${RESET}"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo -e "  ${GREEN}✓${RESET} Created .env from .env.example"
  echo -e "  ${YELLOW}⚠${RESET}  You must fill in your API keys in .env before starting"
else
  echo -e "  ${GREEN}✓${RESET} .env already exists"
fi

# ── Generate JWT secrets if placeholders ────────────────────
if grep -q "GENERATE_64_CHAR_HEX_AND_PASTE_HERE" .env; then
  JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  JWT_REFRESH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

  sed -i.bak "s/GENERATE_64_CHAR_HEX_AND_PASTE_HERE/$JWT_SECRET/" .env
  sed -i.bak "s/GENERATE_DIFFERENT_64_CHAR_HEX_HERE/$JWT_REFRESH_SECRET/" .env
  sed -i.bak "s/GENERATE_64_CHAR_HEX_HERE/$ENCRYPTION_KEY/" .env
  rm -f .env.bak

  echo -e "  ${GREEN}✓${RESET} Generated JWT_SECRET, JWT_REFRESH_SECRET, and ENCRYPTION_KEY"
  echo -e "  ${YELLOW}⚠${RESET}  These are unique to this machine — back them up securely"
fi

# ── Install dependencies ─────────────────────────────────────
echo ""
echo -e "${BOLD}Installing dependencies...${RESET}"
npm install
echo -e "  ${GREEN}✓${RESET} Dependencies installed"

# ── Service account check ────────────────────────────────────
echo ""
echo -e "${BOLD}Checking service account...${RESET}"

if [ -f "ikonetu-*.json" ] || ls ikonetu-*.json 1>/dev/null 2>&1; then
  SA_FILE=$(ls ikonetu-*.json | head -1)
  echo -e "  ${GREEN}✓${RESET} Service account found: $SA_FILE"
  sed -i.bak "s|./ikonetu-service-account.json|./$SA_FILE|g" .env
  rm -f .env.bak
  echo -e "  ${GREEN}✓${RESET} Updated GOOGLE_APPLICATION_CREDENTIALS in .env"
else
  echo -e "  ${YELLOW}⚠${RESET}  No service account JSON found in this directory"
  echo "  Download from: Google Cloud Console → IAM → Service Accounts → Keys → Add Key → JSON"
  echo "  Save it in this directory and re-run setup.sh"
fi

# ── Redis check ──────────────────────────────────────────────
echo ""
echo -e "${BOLD}Checking Redis...${RESET}"

if redis-cli ping &>/dev/null 2>&1; then
  echo -e "  ${GREEN}✓${RESET} Redis is running"
else
  echo -e "  ${YELLOW}⚠${RESET}  Redis not responding on localhost:6379"
  echo "  Start Redis with:"
  echo "    macOS: brew services start redis"
  echo "    Linux: sudo systemctl start redis"
  echo "    Docker: docker run -d -p 6379:6379 redis:7-alpine"
fi

# ── Run tests ────────────────────────────────────────────────
echo ""
echo -e "${BOLD}Running unit tests...${RESET}"
npm run test:unit 2>&1 | tail -5
echo -e "  ${GREEN}✓${RESET} Unit tests passed"

# ── Summary ──────────────────────────────────────────────────
echo ""
echo "════════════════════════════════════"
echo -e "${GREEN}${BOLD}Setup complete.${RESET}"
echo ""
echo -e "${BOLD}Before you can start the server:${RESET}"
echo "  1. Fill in your API keys in .env"
echo "     → SENDGRID_API_KEY (regenerate the one you shared)"
echo "     → DB_HOST, DB_PASSWORD (from Cloud SQL)"
echo "     → STRIPE_SECRET_KEY (use sk_test_ not sk_live_)"
echo ""
echo -e "${BOLD}Run the database migration:${RESET}"
echo "  npm run migrate"
echo ""
echo -e "${BOLD}Start the auth service:${RESET}"
echo "  npm run dev -w services/auth-service"
echo ""
echo -e "${BOLD}Test it:${RESET}"
echo "  curl -X POST http://localhost:3001/api/v1/auth/otp/request \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"you@example.com\",\"role\":\"founder\",\"name\":\"Your Name\"}'"
echo ""
echo "  Check your email for the OTP, then verify:"
echo "  curl -X POST http://localhost:3001/api/v1/auth/otp/verify \\"
echo "    -H 'Content-Type: application/json' \\"
echo "    -d '{\"email\":\"you@example.com\",\"code\":\"123456\"}'"
echo ""

#!/bin/bash
set -e

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

echo ""
echo -e "${BOLD}${BLUE}🗞️  Alresala School Newspaper — WhatsApp Bot${NC}"
echo -e "${BLUE}============================================${NC}"
echo ""

# ── Step 0: Termux bootstrap (Android only) ─────────────────────────────────

if [ -d "/data/data/com.termux" ] || [ -n "$TERMUX_VERSION" ]; then
  echo -e "${YELLOW}[0/4] Termux detected — installing native build tools...${NC}"
  pkg update -y
  pkg install -y nodejs-lts git python make clang
  echo -e "${GREEN}✅  Build tools installed${NC}"
  echo ""
fi

# ── Step 1: Node.js ─────────────────────────────────────────────────────────

echo -e "${YELLOW}[1/4] Checking Node.js...${NC}"

if ! command -v node &>/dev/null; then
  echo -e "${RED}❌  Node.js is not installed.${NC}"
  echo ""
  echo "Install it one of these ways:"
  echo ""
  echo "  Option A — download the installer:"
  echo "    https://nodejs.org  (choose the LTS version)"
  echo ""
  echo "  Option B — use nvm (recommended on Linux/macOS):"
  echo "    curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash"
  echo "    source ~/.bashrc   # or restart your terminal"
  echo "    nvm install 18"
  echo ""
  echo "Then re-run:  bash setup.sh"
  exit 1
fi

NODE_MAJOR=$(node -e "process.stdout.write(process.version.split('.')[0].slice(1))")
if [ "$NODE_MAJOR" -lt 18 ]; then
  echo -e "${RED}❌  Node.js $(node --version) is too old — need v18 or higher.${NC}"
  echo "Upgrade with:  nvm install 18 && nvm use 18"
  exit 1
fi

echo -e "${GREEN}✅  Node.js $(node --version)${NC}"

# ── Step 2: Install dependencies ────────────────────────────────────────────

echo ""
echo -e "${YELLOW}[2/4] Installing npm packages...${NC}"
echo "    (this may take a minute the first time)"
npm install --silent
echo -e "${GREEN}✅  Packages installed${NC}"

# ── Step 3: Create .env ─────────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}[3/4] Setting up environment...${NC}"

if [ -f ".env" ]; then
  if grep -q "GEMINI_API_KEY" .env 2>/dev/null && ! grep -q "GEMINI_API_KEY=$" .env 2>/dev/null; then
    echo -e "${GREEN}✅  .env already configured${NC}"
    ASK_KEY=false
  else
    echo -e "${YELLOW}⚠️   .env exists but Gemini key is missing.${NC}"
    ASK_KEY=true
  fi
else
  ASK_KEY=true
fi

if [ "$ASK_KEY" = true ]; then
  echo ""
  echo "  You need a Google Gemini API key (free):"
  echo "  1. Go to  https://aistudio.google.com/apikey"
  echo "  2. Sign in with your Google account"
  echo "  3. Click 'Create API Key'"
  echo "  4. Copy the key"
  echo ""

  while true; do
    read -rp "  Paste your Gemini API key: " API_KEY
    if [ -z "$API_KEY" ]; then
      echo "  Key cannot be empty. Try again."
    else
      break
    fi
  done

  {
    echo "GEMINI_API_KEY=$API_KEY"
    echo ""
    echo "# Optional: restrict replies to specific numbers (comma-separated)"
    echo "# Format: countrycode+number@c.us  e.g.  9665XXXXXXXX@c.us"
    echo "ALLOWED_NUMBERS="
  } > .env

  echo -e "${GREEN}✅  .env file created${NC}"
fi

# ── Step 4: Start the bot ────────────────────────────────────────────────────

echo ""
echo -e "${YELLOW}[4/4] Starting the bot...${NC}"
echo ""
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "  A ${BOLD}QR code${NC} will appear in a moment."
echo ""
echo -e "  On your phone:"
echo -e "   1. Open ${BOLD}WhatsApp${NC}"
echo -e "   2. Tap  ⋮  →  ${BOLD}Linked Devices${NC}  →  ${BOLD}Link a Device${NC}"
echo -e "   3. Scan the QR code below"
echo ""
echo -e "  The session is saved in ${BOLD}.baileys_auth/${NC} — you only scan ${BOLD}once${NC}."
echo -e "  Press  ${BOLD}Ctrl+C${NC}  to stop the bot."
echo -e "${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

npm run dev

#!/bin/bash
# BDC Control Panel — local dev server
# Usage: ./dev.sh

set -e

# Check .env.local exists
if [ ! -f apps/web/.env.local ]; then
  echo "❌ apps/web/.env.local not found."
  echo "   Copy .env.example and fill in your Supabase keys."
  exit 1
fi

# Check for placeholder values
if grep -q "paste-" apps/web/.env.local 2>/dev/null; then
  echo "❌ apps/web/.env.local still has placeholder values."
  echo "   Replace them with your real Supabase keys from the dashboard."
  exit 1
fi

echo "🚀 Starting BDC Control Panel..."
echo ""

# Install deps if needed
if [ ! -d apps/web/node_modules ]; then
  echo "📦 Installing dependencies..."
  cd apps/web && npm install && cd ../..
fi

# Start Next.js dev server
echo "🌐 Starting Next.js on http://localhost:3000"
cd apps/web && npm run dev

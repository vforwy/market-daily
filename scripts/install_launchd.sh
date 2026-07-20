#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LABEL="com.vforwy.market-daily"
SOURCE="$ROOT/scripts/$LABEL.plist"
DEST_DIR="$HOME/Library/LaunchAgents"
TARGET="$DEST_DIR/$LABEL.plist"
DOMAIN="gui/$(id -u)"

mkdir -p "$DEST_DIR" "$ROOT/logs"
cp "$SOURCE" "$TARGET"
sed -i '' "s|__MARKET_DAILY_ROOT__|$ROOT|g" "$TARGET"
plutil -lint "$TARGET"

if launchctl print "$DOMAIN/$LABEL" >/dev/null 2>&1; then
  launchctl bootout "$DOMAIN" "$TARGET"
fi
launchctl bootstrap "$DOMAIN" "$TARGET"
launchctl enable "$DOMAIN/$LABEL"

echo "loaded $LABEL"
echo "schedule: weekdays at 15:05"
echo "status: launchctl print $DOMAIN/$LABEL"

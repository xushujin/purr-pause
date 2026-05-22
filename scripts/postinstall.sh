#!/bin/sh
# Post-install: enable autostart for the user who installed the deb with sudo.

APP_EXEC="/opt/purr-pause/purr-pause"
TARGET_USER=""
TARGET_HOME=""
TARGET_GROUP=""

if [ -n "$SUDO_USER" ] && [ "$SUDO_USER" != "root" ]; then
  TARGET_USER="$SUDO_USER"
elif [ -n "$PKEXEC_UID" ]; then
  TARGET_USER="$(getent passwd "$PKEXEC_UID" | cut -d: -f1)"
fi

if [ -n "$TARGET_USER" ]; then
  TARGET_HOME="$(getent passwd "$TARGET_USER" | cut -d: -f6)"
  TARGET_GROUP="$(getent passwd "$TARGET_USER" | cut -d: -f4)"
fi

if [ -z "$TARGET_HOME" ] || [ ! -d "$TARGET_HOME" ]; then
  echo "胖猫暂停一下（PurrPause） autostart not created: target desktop user could not be detected."
  exit 0
fi

AUTOSTART_DIR="$TARGET_HOME/.config/autostart"
AUTOSTART_FILE="$AUTOSTART_DIR/purr-pause.desktop"

mkdir -p "$AUTOSTART_DIR"

cat > "$AUTOSTART_FILE" << EOF
[Desktop Entry]
Type=Application
Name=胖猫暂停一下（PurrPause）
Comment=胖猫暂停一下 - 屏幕休息提醒
Exec=$APP_EXEC
Icon=purr-pause
Terminal=false
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
Categories=Utility;
EOF

chown "$TARGET_USER:$TARGET_GROUP" "$TARGET_HOME/.config" "$AUTOSTART_DIR" "$AUTOSTART_FILE" 2>/dev/null || true
chmod 644 "$AUTOSTART_FILE"

echo "胖猫暂停一下（PurrPause） autostart entry created for $TARGET_USER."

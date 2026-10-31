#!/bin/zsh
# Swaps a verified, unpacked Storage.app into place and relaunches it.
# usage: apply-update.sh APP_PID SERVER_PID NEW_APP TARGET_APP [RELAUNCH=1]
set -u
APP_PID=${1:-0}; SERVER_PID=${2:-0}; NEW=${3:?}; TARGET=${4:?}; RELAUNCH=${5:-1}
sleep 1
(( APP_PID > 1 )) && kill -TERM "$APP_PID" 2>/dev/null
(( SERVER_PID > 1 )) && kill -TERM "$SERVER_PID" 2>/dev/null
for i in {1..50}; do kill -0 "$APP_PID" 2>/dev/null || break; sleep 0.2; done
BACKUP="${TARGET}.old-$$"
if mv "$TARGET" "$BACKUP"; then
  if mv "$NEW" "$TARGET"; then xattr -cr "$TARGET" 2>/dev/null; rm -rf "$BACKUP"
  else mv "$BACKUP" "$TARGET"; echo "update failed: could not move new app into place" >&2; exit 1; fi
else echo "update failed: could not move old app aside" >&2; exit 1; fi
[[ "$RELAUNCH" == 1 ]] && open "$TARGET"
exit 0

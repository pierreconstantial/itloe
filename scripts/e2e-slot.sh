#!/bin/sh
# Run one e2e command in one of E2E_SLOTS shared slots (default 3), waiting for a free one. The e2e
# runner (npm run e2e, scripts/e2e-run.mts) runs every suite through it, so suites from several sessions
# run side by side without overloading the machine. Slot 1 is /tmp/itloe-e2e.lock, the single lock used before.
#   scripts/e2e-slot.sh env PORT=3199 node scripts/e2e-quiz.mts
#   scripts/e2e-slot.sh sh -c 'CH=$(mktemp -d); google-chrome --headless=new --remote-debugging-port=9222 \
#     --user-data-dir=$CH >/dev/null 2>&1 & C=$!; sleep 3; PORT=3199 CDP=9222 node scripts/e2e-tv.mts; R=$?
#     kill $C; wait $C; rm -rf $CH; exit $R'      (wait: Chrome writes to its profile until it has exited)
# Each command picks its own free PORT (and CDP for browser suites): slots don't hand out ports.
n=${E2E_SLOTS:-3}
while :; do
  i=1
  while [ "$i" -le "$n" ]; do
    if [ "$i" -eq 1 ]; then lock=/tmp/itloe-e2e.lock; else lock="/tmp/itloe-e2e.slot$i.lock"; fi
    flock -n -E 75 "$lock" "$@"
    rc=$?
    [ "$rc" -ne 75 ] && exit "$rc"
    i=$((i + 1))
  done
  sleep 2
done

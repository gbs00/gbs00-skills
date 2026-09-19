#!/bin/zsh
set -euo pipefail

probe_only=false
resume=false
ledger_file=""
typeset -A saved_status
if [ "${1:-}" = "--probe" ]; then
  probe_only=true
  shift
fi
if [ "${1:-}" = "--resume" ]; then
  [ "$#" -eq 2 ] || { echo "Usage: $0 --resume <ledger-file>" >&2; exit 2; }
  resume=true
  ledger_file="$2"
fi

browser=""
folder=""
window_id=""
window_ref="window 1"
targets=()
if [ "$resume" = true ]; then
  [ -f "$ledger_file" ] && [ -r "$ledger_file" ] && [ -w "$ledger_file" ] || exit 2
  while IFS=$'\t' read -r kind value extra; do
    case "$kind" in
      BROWSER) browser="$value" ;;
      FOLDER) folder="$value" ;;
      WINDOW) window_id="$value" ;;
      TARGET) targets+=("$value"$'\t'"$extra") ;;
      RESULT) saved_status[$value]="${extra%%$'\t'*}" ;;
    esac
  done < "$ledger_file"
  [ -n "$window_id" ] || { echo "Ledger has no window identity." >&2; exit 2; }
  start_index=1
  end_index=${#targets}
else
  if [ "$#" -lt 4 ] || [ "$#" -gt 5 ]; then
    echo "Usage: $0 [--probe] <browser> <start-index> <end-index> <folder> [window-id]" >&2
    exit 2
  fi
  browser="$1"
  start_index="$2"
  end_index="$3"
  folder="$4"
  window_id="${5:-}"
fi
if [[ "$folder" == *$'\t'* || "$folder" == *$'\n'* || "$folder" == *$'\r'* ]]; then
  echo "Destination path must be a single TSV-safe line." >&2
  exit 2
fi

case "$browser" in
  "Google Chrome"|"Microsoft Edge") ;;
  *) echo "Supported browsers: Google Chrome, Microsoft Edge" >&2; exit 2 ;;
esac
if ! [[ "$start_index" =~ '^[0-9]+$' && "$end_index" =~ '^[0-9]+$' ]]; then
  echo "Tab indexes must be positive integers." >&2
  exit 2
fi
start_index=$((10#$start_index))
end_index=$((10#$end_index))
if [ "$start_index" -lt 1 ] || [ "$start_index" -gt "$end_index" ]; then
  echo "Require 1 <= start index <= end index." >&2
  exit 2
fi
if [ -n "$window_id" ]; then
  if ! [[ "$window_id" =~ '^[0-9]+$' ]] || [ "$window_id" -lt 1 ]; then
    echo "Window ID must be a positive integer." >&2
    exit 2
  fi
  window_id=$((10#$window_id))
  window_ref="(first window whose id is $window_id)"
fi
if [ ! -d "$folder" ] || [ ! -r "$folder" ] || [ ! -x "$folder" ]; then
  echo "Destination folder is missing or unreadable: $folder" >&2
  exit 2
fi
command -v rg >/dev/null && command -v osascript >/dev/null || exit 2

# Snapshot stable identities once; resume never discovers new index occupants.
if [ "$resume" = false ]; then
snapshot=$(osascript <<APPLESCRIPT
-- CLIP_SNAPSHOT
tell application "$browser"
  set w to $window_ref
  if (count of tabs of w) < $end_index then error "Tab range no longer exists"
  set resultText to (id of w as text)
  repeat with i from $end_index to $start_index by -1
    set t to tab i of w
    set pageURL to URL of t as text
    if pageURL contains linefeed or pageURL contains (ASCII character 9) or pageURL contains return then error "Invalid tab URL"
    set resultText to resultText & linefeed & (id of t as text) & (ASCII character 9) & pageURL
  end repeat
  return resultText
end tell
APPLESCRIPT
) || { echo "CLIP_ABORT: could not snapshot target window" >&2; exit 30; }
window_id=${snapshot%%$'\n'*}
if ! [[ "$window_id" =~ '^[0-9]+$' ]]; then
  echo "CLIP_ABORT: invalid window snapshot" >&2
  exit 30
fi
window_ref="(first window whose id is $window_id)"
targets=("${(@f)${snapshot#*$'\n'}}")
fi
if [ "${#targets}" -ne "$((end_index - start_index + 1))" ]; then
  echo "CLIP_ABORT: incomplete target snapshot" >&2
  exit 30
fi
typeset -A seen_ids
for target in "${targets[@]}"; do
  tab_id=${target%%$'\t'*}
  if ! [[ "$tab_id" =~ '^[0-9]+$' ]] || [[ "$target" != *$'\t'* ]]; then
    echo "CLIP_ABORT: invalid tab snapshot" >&2
    exit 30
  fi
  if [ -n "${seen_ids[$tab_id]:-}" ]; then
    echo "CLIP_ABORT: duplicate tab identity in ledger" >&2
    exit 30
  fi
  seen_ids[$tab_id]=1
done
if [ "$resume" = false ]; then
  umask 077
  ledger_dir="${CLIP_LEDGER_DIR:-$HOME/.local/state/obsidian-auto-clip}"
  mkdir -p "$ledger_dir"
  ledger_file=$(mktemp "$ledger_dir/run-XXXXXXXX")
  printf 'BROWSER\t%s\nFOLDER\t%s\nWINDOW\t%s\n' "$browser" "$folder" "$window_id" > "$ledger_file"
  printf 'TARGET\t%s\n' "${targets[@]}" >> "$ledger_file"
fi
printf 'CLIP_LEDGER\t%s\n' "$ledger_file"
checkpoint() {
  printf 'RESULT\t%s\t%s\t%s\n' "$1" "$2" "${3:-}" >> "$ledger_file"
}
total=${#targets}
processed=0
verified=0
closed=0
failed=0
consecutive_timeouts=0
trap 'printf "CLIP_SUMMARY\tselected=%s\tprocessed=%s\tverified=%s\tclosed=%s\tfailed_or_review=%s\tnot_attempted=%s\n" "$total" "$processed" "$verified" "$closed" "$failed" "$((total - processed))"' EXIT
printf 'CLIP_WINDOW\t%s\n' "$window_id"
printf 'CLIP_TARGET\t%s\n' "${targets[@]}"

tab_action() {
  local action="$1" tab_id="$2" expected_url="$3"
  osascript - "$action" "$expected_url" <<APPLESCRIPT
-- CLIP_ACTION $action $tab_id $window_id
on locateTarget(expectedURL)
  set expectedTabID to "$tab_id"
  tell application "$browser"
    if not (exists $window_ref) then error "Target window disappeared"
    set w to $window_ref
    repeat with i from 1 to (count of tabs of w)
      set t to tab i of w
      if (id of t as text) is expectedTabID then
        if (URL of t as text) is not expectedURL then return -1
        return i as integer
      end if
    end repeat
    return 0
  end tell
end locateTarget

on assertFocused(expectedURL)
  set expectedWindowID to "$window_id"
  set expectedTabID to "$tab_id"
  tell application "System Events"
    if not (frontmost of process "$browser") then error "Browser lost foreground focus"
  end tell
  tell application "$browser"
    if ((id of window 1) as text) is not expectedWindowID then error "Target window lost foreground focus"
    if ((id of active tab of $window_ref) as text) is not expectedTabID then error "Target tab lost focus"
    if (URL of active tab of $window_ref as text) is not expectedURL then error "Target URL changed during keyboard operation"
  end tell
end assertFocused

on run argv
  set actionName to item 1 of argv
  set expectedURL to item 2 of argv
  set targetIndex to my locateTarget(expectedURL)
  if targetIndex is 0 then return "SKIP" & (ASCII character 9) & "TAB_MISSING"
  if targetIndex is -1 then return "SKIP" & (ASCII character 9) & "URL_CHANGED"
  tell application "$browser"
    set w to $window_ref
    if actionName is "check" then return "OK"
    if actionName is "loaded" then
      if loading of tab targetIndex of w then return "WAIT"
      return "OK"
    end if
    if actionName is "close" then
      set t to tab targetIndex of w
      if (URL of t as text) is not expectedURL then return "SKIP" & (ASCII character 9) & "URL_CHANGED"
      close t
      return "OK"
    end if
    activate
    set index of w to 1
    set targetIndex to my locateTarget(expectedURL)
    if targetIndex < 1 then return "SKIP" & (ASCII character 9) & "TARGET_CHANGED"
    set active tab index of w to targetIndex
  end tell
  delay 0.8
  tell application "System Events"
    set frontmost of process "$browser" to true
  end tell
  delay 0.5
  my assertFocused(expectedURL)
  if actionName is "clip" then
    tell application "System Events" to keystroke "o" using {option down, shift down}
  else if actionName is "scroll" then
    tell application "System Events" to key code 115
    delay 0.4
    repeat 80 times
      my assertFocused(expectedURL)
      tell application "System Events" to key code 121
      delay 0.3
    end repeat
    delay 1.5
    my assertFocused(expectedURL)
    tell application "System Events" to key code 115
  else
    error "Unknown tab action"
  end if
  return "OK"
end run
APPLESCRIPT
}

find_note() {
  local url="$1" matches="" rc=0 candidate="" bytes=0
  found=""
  # Exact source property avoids matching another article's URL prefix or body link.
  matches=$(rg -l -0 --glob '*.md' --fixed-strings --line-regexp \
    -e "source: $url" -e "source: \"$url\"" -e "source: '$url'" -- "$folder") || rc=$?
  if [ "$rc" -gt 1 ]; then
    echo "CLIP_ABORT: cannot search destination" >&2
    return 30
  fi
  for candidate in "${(@0)matches}"; do
    [ -n "$candidate" ] || continue
    rc=0
    CLIP_SOURCE_URL="$url" awk '
      NR == 1 { if ($0 != "---") exit; next }
      $0 == "---" { exit }
      { expected = ENVIRON["CLIP_SOURCE_URL"]
        if ($0 == "source: " expected || $0 == "source: \"" expected "\"" ||
            $0 == "source: \047" expected "\047") matched = 1 }
      END { exit !matched }
    ' "$candidate" || rc=$?
    if [ "$rc" -gt 1 ]; then return 30; fi
    if [ "$rc" -eq 1 ]; then continue; fi
    bytes=$(wc -c < "$candidate") || return 30
    [ -n "$found" ] || found="$candidate"
    if [ "$bytes" -ge 800 ]; then
      found="$candidate"
      return 0
    fi
  done
  return 0
}

process_target() {
  local tab_id="$1" url="$2" reply="" found="" bytes=0 loaded=false
  if [[ "$url" != https://* && "$url" != http://* ]]; then
    printf 'CLIP_SKIP\t%s\tUNSUPPORTED_URL\n' "$tab_id" >&2
    return 20
  fi
  reply=$(tab_action check "$tab_id" "$url") || return 30
  if [ "$reply" != "OK" ]; then
    printf 'CLIP_SKIP\t%s\t%s\n' "$tab_id" "$reply" >&2
    return 20
  fi
  find_note "$url" || return 30
  if [ -z "$found" ]; then
    if [[ "$url" == https://mp.weixin.qq.com/s* ]]; then
      for _ in {1..30}; do
        reply=$(tab_action loaded "$tab_id" "$url") || return 30
        if [ "$reply" = "OK" ]; then loaded=true; break; fi
        if [ "$reply" != "WAIT" ]; then
          printf 'CLIP_SKIP\t%s\t%s\n' "$tab_id" "$reply" >&2
          return 20
        fi
        sleep 0.5
      done
      if [ "$loaded" != true ]; then
        printf 'CLIP_FAIL\t%s\tLOAD_TIMEOUT\n' "$tab_id" >&2
        return 20
      fi
      reply=$(tab_action scroll "$tab_id" "$url") || return 30
      if [ "$reply" != "OK" ]; then
        printf 'CLIP_SKIP\t%s\t%s\n' "$tab_id" "$reply" >&2
        return 20
      fi
    fi
    reply=$(tab_action clip "$tab_id" "$url") || return 30
    if [ "$reply" != "OK" ]; then
      printf 'CLIP_SKIP\t%s\t%s\n' "$tab_id" "$reply" >&2
      return 20
    fi
    for attempt in {1..24}; do
      sleep 1
      find_note "$url" || return 30
      [ -z "$found" ] || break
    done
  fi
  if [ -z "$found" ]; then
    consecutive_timeouts=$((consecutive_timeouts + 1))
    printf 'CLIP_FAIL\t%s\tNO_NOTE\t%s\n' "$tab_id" "$url" >&2
    if [ "$consecutive_timeouts" -ge 2 ]; then
      echo "CLIP_ABORT: repeated timeouts; inspect shared clipper/path dependencies before resuming" >&2
      return 30
    fi
    return 20
  fi
  consecutive_timeouts=0
  checkpoint "$tab_id" NOTE_FOUND "$found"
  bytes=$(wc -c < "$found") || return 30
  if [ "$bytes" -lt 800 ]; then
    printf 'CLIP_TOO_SMALL\t%s\t%s\t%s\n' "$tab_id" "$bytes" "$found" >&2
    return 20
  fi
  if [[ "$url" == https://mp.weixin.qq.com/s* ]]; then
    checkpoint "$tab_id" REVIEW_IMAGES "$found"
    printf 'CLIP_REVIEW_IMAGES\t%s\t%s\n' "$tab_id" "$found"
    return 20
  fi
  verified=$((verified + 1))
  checkpoint "$tab_id" VERIFIED "$found"
  reply=$(tab_action close "$tab_id" "$url") || return 30
  if [ "$reply" != "OK" ]; then
    printf 'CLIP_SKIP\t%s\t%s\n' "$tab_id" "$reply" >&2
    return 20
  fi
  closed=$((closed + 1))
  checkpoint "$tab_id" CLOSED "$found"
  printf 'CLIP_DONE\t%s\t%s\t%s\n' "$tab_id" "$bytes" "$found"
  sleep 0.7
}

for target in "${targets[@]}"; do
  tab_id=${target%%$'\t'*}
  url=${target#*$'\t'}
  if [ "${saved_status[$tab_id]:-}" = CLOSED ]; then
    found=""
    find_note "$url" || exit 30
    processed=$((processed + 1))
    if [ -n "$found" ] && [ "$(wc -c < "$found")" -ge 800 ]; then
      verified=$((verified + 1))
      closed=$((closed + 1))
      printf 'CLIP_RESTORED\t%s\t%s\n' "$tab_id" "$found"
    else
      failed=$((failed + 1))
      printf 'CLIP_CHECKPOINT_MISMATCH\t%s\n' "$tab_id" >&2
    fi
    continue
  fi
  printf 'CLIP_START\t%s\t%s\n' "$tab_id" "$url"
  rc=0
  process_target "$tab_id" "$url" || rc=$?
  processed=$((processed + 1))
  if [ "$rc" -ne 0 ]; then
    failed=$((failed + 1))
    if [ "$rc" -ne 20 ]; then
      checkpoint "$tab_id" STOPPED
      echo "CLIP_ABORT: shared dependency or focus failure; remaining tabs were not processed" >&2
      exit 30
    fi
  fi
  if [ "$probe_only" = true ]; then
    printf 'CLIP_PROBE\tresult=%s\tresume=%s\n' "$rc" "$ledger_file"
    break
  fi
done
[ "$failed" -eq 0 ] && [ "$processed" -eq "$total" ] || exit 20

#!/bin/zsh
set -euo pipefail

if [ "$#" -ne 4 ]; then
  echo "Usage: $0 <browser-app-name> <start-index> <end-index> <destination-folder>" >&2
  exit 2
fi

browser="$1"
start_index="$2"
end_index="$3"
folder="$4"

if ! [[ "$start_index" =~ '^[0-9]+$' && "$end_index" =~ '^[0-9]+$' ]]; then
  echo "Tab indexes must be positive integers." >&2
  exit 2
fi

if [ ! -d "$folder" ]; then
  echo "Destination folder does not exist: $folder" >&2
  exit 2
fi

if [ "$start_index" -gt "$end_index" ]; then
  echo "Start index must be <= end index." >&2
  exit 2
fi

wait_for_tab_loaded() {
  local idx="$1"
  local loaded="false"

  for _ in $(seq 1 30); do
    loaded=$(osascript <<APPLESCRIPT
tell application "$browser"
  try
    return not (loading of tab $idx of window 1)
  on error
    return false
  end try
end tell
APPLESCRIPT
)
    if [ "$loaded" = "true" ]; then
      return 0
    fi
    sleep 0.5
  done
}

preload_wechat_article() {
  local idx="$1"
  local url="$2"

  if [[ "$url" != https://mp.weixin.qq.com/s* ]]; then
    return 0
  fi

  echo "PRELOAD_WECHAT_START\t$idx"
  wait_for_tab_loaded "$idx"

  local js_result=""
  js_result=$(osascript <<APPLESCRIPT 2>/dev/null || true
tell application "$browser"
  activate
  set active tab index of window 1 to $idx
  set t to tab $idx of window 1
  execute t javascript "(async () => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const doc = document.scrollingElement || document.documentElement || document.body;
    const imageInfo = () => Array.from(document.images || []).map((img) => ({
      src: img.currentSrc || img.src || img.getAttribute('data-src') || '',
      complete: img.complete,
      width: img.naturalWidth || 0,
      height: img.naturalHeight || 0
    }));

    window.scrollTo(0, 0);
    await sleep(500);

    let lastHeight = 0;
    let stableRounds = 0;
    for (let round = 0; round < 80 && stableRounds < 3; round++) {
      window.scrollBy(0, Math.max(500, Math.floor(window.innerHeight * 0.85)));
      await sleep(650);
      const height = Math.max(doc.scrollHeight || 0, document.body.scrollHeight || 0);
      stableRounds = height === lastHeight ? stableRounds + 1 : 0;
      lastHeight = height;
    }

    window.dispatchEvent(new Event('scroll'));
    document.dispatchEvent(new Event('scroll'));

    for (let attempt = 0; attempt < 20; attempt++) {
      const imgs = imageInfo();
      const pending = imgs.filter((img) => img.src && (!img.complete || img.width === 0));
      if (pending.length === 0) break;
      await sleep(500);
    }

    const imgs = imageInfo();
    window.scrollTo(0, 0);
    await sleep(350);
    return JSON.stringify({
      images: imgs.length,
      loaded: imgs.filter((img) => img.src && img.complete && img.width > 0).length,
      pending: imgs.filter((img) => img.src && (!img.complete || img.width === 0)).length,
      height: Math.max(doc.scrollHeight || 0, document.body.scrollHeight || 0)
    });
  })();"
end tell
APPLESCRIPT
)

  if [ -n "$js_result" ]; then
    echo "PRELOAD_WECHAT_DONE\t$idx\t$js_result"
    return 0
  fi

  osascript <<APPLESCRIPT
tell application "$browser"
  activate
  set active tab index of window 1 to $idx
end tell
delay 0.5
tell application "System Events"
  key code 115
  delay 0.4
  repeat 80 times
    key code 121
    delay 0.3
  end repeat
  delay 1.5
  key code 115
end tell
APPLESCRIPT
  echo "PRELOAD_WECHAT_DONE\t$idx\tkeyboard-scroll-fallback"
}

for idx in $(seq "$end_index" -1 "$start_index"); do
  info=$(osascript <<APPLESCRIPT
tell application "$browser"
  set t to tab $idx of window 1
  return (name of t as text) & linefeed & (URL of t as text)
end tell
APPLESCRIPT
)
  title=${info%%$'\n'*}
  url=${info#*$'\n'}
  echo "CLIP_START\t$idx\t$title"

  found=$(rg -l --fixed-strings -- "$url" "$folder" 2>/dev/null | head -1 || true)
  if [ -z "$found" ]; then
    osascript <<APPLESCRIPT
tell application "$browser"
  activate
  set active tab index of window 1 to $idx
end tell
APPLESCRIPT

    preload_wechat_article "$idx" "$url"

    osascript <<APPLESCRIPT
tell application "$browser"
  activate
  set active tab index of window 1 to $idx
end tell
delay 0.5
tell application "System Events"
  keystroke "o" using {option down, shift down}
end tell
APPLESCRIPT

    found=""
    for attempt in $(seq 1 24); do
      sleep 1
      found=$(rg -l --fixed-strings -- "$url" "$folder" 2>/dev/null | head -1 || true)
      if [ -n "$found" ]; then
        break
      fi
    done
  fi

  if [ -z "$found" ]; then
    echo "CLIP_FAIL\t$idx\t$title\t$url" >&2
    exit 20
  fi

  bytes=$(wc -c < "$found" | tr -d ' ')
  if [ "$bytes" -lt 800 ]; then
    echo "CLIP_TOO_SMALL\t$idx\t$bytes\t$found" >&2
    exit 21
  fi

  osascript <<APPLESCRIPT
tell application "$browser"
  close tab $idx of window 1
end tell
APPLESCRIPT
  echo "CLIP_DONE\t$idx\t$bytes\t$found"
  sleep 0.7
done

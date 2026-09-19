---
name: obsidian-auto-clip
description: Use when the user wants to batch clip browser tabs into Obsidian with Obsidian Web Clipper, especially when they provide a target browser and a rule for which tabs to clip and close.
---

# Obsidian自动化剪存

## Purpose

Automate the proven workflow for clipping browser tabs into Obsidian with Obsidian Web Clipper, verifying each note by source URL, and closing only tabs that were successfully clipped.

## Inputs To Ask For Or Infer

- Target browser app name: e.g. `Microsoft Edge`, `Google Chrome`.
- Tab selection rule: e.g. "from the tab titled X through the bottom tab", "all tabs below the current tab", "tabs whose URL starts with mp.weixin.qq.com".
- Destination folder: default to the Web Clipper configured folder. For this user's known setup, verify against `/Users/gbs00/Documents/Obsidian/Obsidian Vault/00-收集箱Inbox/Clippings`.

If the tab rule is ambiguous and cannot be resolved from open browser tabs, ask one concise question before clipping.

## Core Workflow

1. List browser tabs and resolve the user's rule into a target window ID and a snapshot of tab IDs plus original URLs. Indexes are only for selecting the initial range. Persist that batch identity and per-item results before moving to another item. For a changed browser/extension or a new run with unclipped pages, validate one real clip before expanding; an already-existing note does not prove the extension currently works.
2. Work from bottom to top, re-resolving each original tab by ID. Recheck its original URL before acting and immediately before closing; never substitute a new tab at an old index.
3. For each tab:
   - Activate the tab.
   - Trigger Obsidian Web Clipper quick clip with `Option+Shift+O`.
   - Wait for a Markdown file in the destination folder containing the tab's source URL.
   - Check the file is not a tiny title-only shell.
   - Close the tab only after verification succeeds.
4. A single-page failure leaves that tab open. Record it, retry at most once after diagnosis if useful, and continue independent original targets after identity checks. Stop the affected batch for shared failures (lost window, focus/permission failure, unreadable destination, or repeated no-output timeouts); diagnose before resuming from the original ID/URL ledger.
5. Report verified and closed counts, failures/review items, and any targets not attempted. Partial execution is not complete success. Never close an unverified tab.

## Fast Path For Chromium Browsers

Use this fast path only when the user authorized closing verified tabs. For clip-only requests, use the core workflow without closing. Resolve `SKILL_DIR` to this SKILL.md's directory; do not assume a `.codex/skills` copy exists. After resolving a contiguous range in `Microsoft Edge` or `Google Chrome`, run:

```bash
"$SKILL_DIR/scripts/clip_chromium_tabs.zsh" \
  "Microsoft Edge" \
  169 \
  223 \
  "/Users/gbs00/Documents/Obsidian/Obsidian Vault/00-收集箱Inbox/Clippings"
```

Arguments are:

1. Browser application name.
2. Start tab index.
3. End tab index.
4. Destination folder.
5. Optional target window ID. If omitted, the script snapshots window 1's ID once; it does not follow whichever window later becomes frontmost.

The script prints `CLIP_LEDGER` with a persistent TSV path under `~/.local/state/obsidian-auto-clip` (override with `CLIP_LEDGER_DIR`), plus `CLIP_WINDOW`/`CLIP_TARGET`, and processes those original tabs. The ledger records browser, destination, window ID, original tab IDs/URLs, and `NOTE_FOUND`, `VERIFIED`, `REVIEW_IMAGES`, `CLOSED` or `STOPPED` checkpoints. Treat it as data; never source it as shell code. It requires an exact `source:` property and at least 800 bytes for automatic closure; other source formats and short notes need separate inspection, not blind closure. WeChat articles are scrolled before clipping but remain open as `CLIP_REVIEW_IMAGES` until the agent verifies content/images and rechecks the tab ID/URL. This review does not itself require another user approval.

Use `--probe` before the usual arguments to snapshot the whole batch but process only its first item. Inspect the actual note and any image-review result, then continue the same batch with:

```bash
"$SKILL_DIR/scripts/clip_chromium_tabs.zsh" --resume "<CLIP_LEDGER path>"
```

`--probe --resume "<CLIP_LEDGER path>"` checks only the next unfinished item. A successful one-item probe can still exit `20` because original targets remain unattempted. Resume reuses only the saved identities, rechecks their URLs and notes, and does not rediscover an index range. Previously closed items are checked against their archived source without touching new browser tabs. If the browser was restarted or target identity cannot be recovered, report unresolved items; do not silently retarget them by title or index.

After separate WeChat image verification and authorized closure, append a `RESULT` row with tab ID, `CLOSED`, and the verified note path to this ledger; do not mark image-review items closed merely because a note exists. Summaries distinguish verified notes, confirmed closures, failures/review and unattempted original items.

Exit codes: `0` all selected tabs verified and closed; `20` partial result or review required; `30` shared failure/batch stopped; `2` invalid inputs or missing prerequisites. Two consecutive no-note timeouts stop the batch for diagnosis rather than endlessly retrying an unavailable clipper. Read `CLIP_SUMMARY`; do not equate script exit with completion.

## Browser Notes

- Do not rely on Computer Use for `chrome-extension://...` pages; extension pages may be blocked. Use keyboard shortcuts and file verification instead.
- If quick clip does not work, inspect the extension manifest for the `quick_clip` command. Obsidian Web Clipper normally uses `Alt+Shift+O` / macOS `Option+Shift+O`.
- If a site cannot expose full content to Web Clipper, keep the best available clip and note the limitation. Feishu/Lark docs commonly expose limited printable content.
- If a file already exists and contains the source URL, treat it as clipped and close the tab only if the user asked to close completed tabs.

## Verification

Use source URL matching, not filename matching, because Web Clipper may normalize or truncate filenames.

Useful checks:

```bash
rg -l --fixed-strings -- "$url" "$folder"
find "$folder" -maxdepth 1 -type f -newermt "YYYY-MM-DD HH:MM:SS" -print | wc -l
find "$folder" -maxdepth 1 -type f -newermt "YYYY-MM-DD HH:MM:SS" -print0 | xargs -0 wc -c | awk '$1 < 1200 {print}'
```

Small files are not always failures. Validate them manually when the source is Feishu/Lark, login-gated, or a short social post.

For script maintenance, run `zsh -n scripts/clip_chromium_tabs.zsh` and `node --test tests/clip.test.mjs` from this skill directory. Tests mock browser actions and never clip or close real tabs; a passing mock test is not live UI verification.

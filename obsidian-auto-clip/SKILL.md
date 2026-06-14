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

1. List browser tabs with AppleScript and resolve the user's rule into exact tab indexes and URLs.
2. Work from bottom to top so closing tabs does not shift unprocessed indexes.
3. For each tab:
   - Activate the tab.
   - Trigger Obsidian Web Clipper quick clip with `Option+Shift+O`.
   - Wait for a Markdown file in the destination folder containing the tab's source URL.
   - Check the file is not a tiny title-only shell.
   - Close the tab only after verification succeeds.
4. Stop on failure. Do not close a tab that has not been verified.
5. At the end, report clipped count, closed count, and any exceptions.

## Fast Path For Chromium Browsers

After resolving a contiguous tab range in `Microsoft Edge` or `Google Chrome`, run:

```bash
/Users/gbs00/.codex/skills/obsidian-auto-clip/scripts/clip_chromium_tabs.zsh \
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

The script clips descending from end to start and closes each tab only after finding the source URL in a note.

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

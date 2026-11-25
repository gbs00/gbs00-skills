# 微信剪存：弹窗流程与故障手册

本文件记录 2026-11-07 一次 38 篇微信文章剪存中验证过的流程和故障模式。默认按这里的顺序执行。

## 单篇时间线

1. 按 `tabId + originalUrl` 激活标签，点击正文区域取得网页焦点。
2. `Home` 后逐屏 `PageDown` 到实际底部，再按 `End`；等待图片懒加载，**等 5 秒**。
3. 按 `Command+Shift+O` 打开 Obsidian Web Clipper 弹窗。
4. **等 5 秒**，确认弹窗已显示标题、来源、正文预览和目标目录。
5. 运行 `obsidian-auto-clip/scripts/clip_popup_save.js`，只有返回 `{"found":true,...}` 才表示点击了保存。
6. 等 20–30 秒，按 frontmatter `source` 复检笔记。
7. 确认没有笔记后，才允许补触发一次；仍失败保留标签并报告。

## 为什么不能连按两次

`Option+Shift+O` / `Command+Shift+O` 的每次触发都是一次独立保存请求，不是“第一次打开、第二次才保存”。第一次已经成功时，第二次会生成同源 ` 1.md` 副本；实测两篇内容可达到字节级相同。

规则：

- 默认只触发一次。
- 没看到笔记先等待并复检，不要用第二次按键“碰运气”。
- 确实没有笔记时才补一次；补之前重新激活标签并校验 URL。
- 同源副本只报告，不自动删除。

## 故障对照

| 现象 | 原因 | 处理 |
|---|---|---|
| 出现 `标题 1.md`，与 `标题.md` 同源同内容 | 保存被触发两次 | 停止双触发；保留证据并报告；后续改单次 |
| 出现 70 字节 `Untitled*.md`，frontmatter 全空 | 快速剪存在扩展抓取正文前执行，或焦点已到 Obsidian | 改用弹窗流程；确认空壳后可移入废纸篓并记录 |
| 弹窗有标题/正文，点击后长时间无笔记 | 大文章延迟落盘 | 等 30 秒再复检；不要重复点击 |
| OCR 返回 `found:true` 但仍无笔记 | 点击落在按钮边缘 | 点击点纵向上移 12px；重试前先确认弹窗仍打开 |
| 快捷键后 Obsidian 新建空白笔记 | Obsidian 抢到前台，按键落到错误应用 | 激活标签和按键放同一 AppleScript；按键前校验 frontmost、tabId、URL |
| `find` 说没有重复，但目录里有副本 | `clip_note.rb find` 只输出第一条 | 用 `scripts/audit_sources.rb` 扫描全部 Markdown |
| 共享链接找不到笔记 | 链接重定向到最终站点，笔记 source 是最终 URL | 按最终笔记 source 和内容核对，不按原始短链判缺 |
| 源标签消失 | 用户关闭、浏览器回收或批次变化 | 只报告观察；有记录 URL 且用户授权时可重新打开补剪，不按标题猜 |
| `osascript 不允许辅助访问` | macOS 未授权辅助功能 | 授权后重启 System Events 再重试；不要绕过权限 |
| OCR helper 报错或无截图 | 缺少屏幕录制权限或窗口 ID 错误 | 检查权限和 windowId；helper 需要屏幕录制 + 辅助功能 |

## 批量命令

```bash
SKILL_DIR=/Users/gbs00/.agents/skills/obsidian-auto-clip
"$SKILL_DIR/scripts/clip_chromium_tabs.zsh" --probe --popup \
  "Microsoft Edge" <start-index> <end-index> \
  "/Users/gbs00/Documents/Obsidian/Obsidian Vault/00-收集箱Inbox/Clippings" <window-id>
```

- `--popup` 已写入 ledger；`--resume` 会沿用。
- 先用 `--probe` 跑一篇，读回笔记确认 `found:true`、正文非空、来源正确，再继续。
- 弹窗模式本身已有 5 秒抓取等待；如果 Obsidian 抢焦点明显，篇间再留 10 秒。
- 源标签默认保留；不要用关闭标签来“清理”批次。

## 完成后审计

```bash
ruby "$SKILL_DIR/scripts/audit_sources.rb" "<clippings-folder>" <urls.txt>
```

输出每行 `数量 / 来源身份 / 原始 URL / 笔记路径`。`duplicate_sources>0` 时逐条核对，不直接删除。

同时检查：

- 所有来源 `count >= 1`；`count > 1` 记同源重复。
- 正文小于 800 字节的笔记要确认是否为视频/短讯，而不是截空。
- 图片数为 0 不必然是缺图；但没有 DOM 图清单时，图片完整性只能记“待核验”。
- 根目录或目标目录中的 `Untitled*.md` 是否为本次失败尝试留下；只清理确认全空的文件。

## 2026-11-07 实测结果

- 38 个来源全部保存，38 篇笔记，0 缺失，0 同源重复。
- 1 篇视频文章正文 642 字节（视频嵌入 + 制作名单），属正常。
- 2 个 70 字节空 `Untitled` 由失败的快速剪存产生，确认空 frontmatter 后移入废纸篓。
- 第 3 篇源标签在批次中消失，按记录 URL 重新打开后保存；未推断关闭者。
- 图片完整性未做全量断言，因为浏览器未开放 Apple Events JavaScript。

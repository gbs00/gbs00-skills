---
name: boss-zhipin-lark-base
description: Process menu-confirmed pinned conversations in the user's logged-in BOSS 直聘 / zhipin.com Chrome session, extract complete chat and job-detail data, create and verify one Lark/Feishu Base record per conversation, and safely unpin only after read-back verification. Use for BOSS pinned-chat logging, interrupted-run recovery, or BOSS-to-Lark Base automations.
---

# BOSS 直聘到飞书 Base

## Core Invariants

- Treat each pinned conversation as one independent application/contact record. Repeated companies, jobs, recruiters, and dates are valid; do not deduplicate them.
- Never send a recruiter message, delete a conversation, or click `不感兴趣`, `黑名单`, or `删除`.
- Never type into the message composer or press Enter. If it gains focus, dismiss UI with a safe mouse click outside the composer.
- Unpin only after the matching Lark record has been created and verified with `+record-get`.
- Keep the BOSS chat tab open throughout the run. Open job details in separate tabs and return by selecting the persistent BOSS tab.

## Preflight

Complete preflight before processing any conversation:

1. For recurring runs, read `/Users/gbs00/.codex/automations/boss/memory.md` and build a run ledger of previously verified record IDs and pending unpin actions.
2. Read and follow `lark-shared` and `lark-base`.
3. Run `lark-cli auth status`. If the token is invalid or Keychain access is blocked, stop and ask the user to reauthorize from macOS Terminal.
4. For a wiki URL, resolve the wiki node and use the real Base token, never the `/wiki/` token.
5. Confirm the target table and run `+field-list` once per run. Verify all nine required fields are writable and the select options used below exist.
6. Open `https://www.zhipin.com/web/geek/chat` in the user's authenticated browser and confirm the contact list is populated. A redirect to `/web/user/`, login UI, or `30天内暂无联系人` when contacts are expected is a login blocker.

## Browser Control

- Prefer `computer-use` for an existing Chrome login when BOSS depends on the user's cookies. If the user specifies Chrome, target `com.google.Chrome` and do not use Edge.
- Do not attach a second browser controller to the same BOSS tab after Computer Use is stable; switching controllers can reinitialize the chat SPA.
- After every click, menu open, tab switch, page load, or unpin, fetch a fresh app state and derive new element indexes. Accessibility indexes become stale after list reorder or navigation.
- Select the conversation row first; then fetch fresh state to reveal its operation icon. Open the menu and act on exact menu text, not nearby coordinates.
- Never infer page state from a screenshot alone when fresh accessibility text is available.

### SPA Recovery

If the chat alternates between a populated list, `加载中`, and an empty pane:

1. Stop clicking and capture fresh app state.
2. If a Chrome/browser extension controller is attached, switch to Computer Use on the same logged-in Chrome session.
3. Wait for one stable state and reselect the conversation from fresh indexes.
4. Do not repeatedly reload. Use at most one explicit reload only when the page is already stuck and the session is still authenticated.
5. If the page redirects to login, the detail remains unreadable, or the loop continues, stop without unpinning.

## Pin Detection And Ordering

The conversation menu is the source of truth:

- `取消置顶`: pinned; process it.
- `置顶`: not pinned or already processed; skip it.

The top accessibility `内容列表` and teal corner marks are only candidate hints. Confirm every candidate through its menu.

At run start, snapshot the visible pinned candidates in top-to-bottom order. Process the first remaining candidate each time. After a successful unpin, BOSS normally moves that row below the remaining pins and may replace its preview date with the current time; never use that reordered preview time as `沟通日期`.

After unpinning, reselect the same conversation, reopen the operation menu, and verify exact text `置顶`. At completion, confirm the pinned candidate block is absent and spot-check the first visible row's menu. If structural hints and menu text disagree, menu text wins.

## Per-Conversation Transaction

Track each conversation through these states:

`discovered -> extracted -> created(record_id) -> verified -> unpinned -> unpin_verified`

1. Open the menu and confirm `取消置顶`.
2. Open the conversation and capture the earliest communication timestamp from the full chat, not the list preview.
3. Capture recruiter name/role, chat evidence, displayed job title, company, and salary.
4. Open `查看职位` or the job title in a new tab and capture structured requirements plus the complete `职位描述` section.
5. Create a new Lark record with `+record-upsert` without `--record-id`.
6. Capture the returned record ID and verify it with `+record-get`. Confirm all nine required fields and the full description are present.
7. For an automation, checkpoint the exact conversation identity, record ID, and `verified` state in memory before changing the pin.
8. Return to the persistent BOSS tab, reselect the exact conversation, confirm its menu still says `取消置顶`, click that exact item, and verify the menu now says `置顶`.

### Interrupted Runs

Do not perform generic duplicate searches. On resume, only reuse a record when automation memory contains a verified record ID for the exact pending conversation from the interrupted transaction. Re-run `+record-get`; if it is complete, continue from unpinning instead of creating a second record. If verification fails, stop and report the checkpoint inconsistency.

## Extraction Rules

### Communication Time

- Use the earliest timestamp shown in the full conversation.
- Normalize to `YYYY-MM-DD HH:mm:ss` in the page's local timezone.
- When BOSS omits the year, infer it from the current calendar context only when unambiguous. Put uncertainty in `备注`.

### Job Detail Priority

Use this priority for structured fields:

1. Job-detail header: job title, display company, salary, experience, education.
2. Chat job card only when the detail header is unavailable.
3. Do not substitute the legal company name from `工商信息` for the displayed hiring company unless no display name exists.

If the detail header conflicts with the description body, use the header value for `工作经验` or `学历` and record both values in `备注`. If chat and detail differ, use detail-page data and note the discrepancy.

For `岗位概述`, copy the complete visible `职位描述` section only, including `岗位职责`, `任职要求`, `加分项`, and list structure. Normalize broken layout whitespace when necessary, but do not summarize, omit clauses, or append benefits, company introduction, addresses, or recommended jobs.

If a job is closed, record all still-visible data and note closure. If a required value or the complete description is unavailable and the table has no valid unknown option, stop without unpinning.

## Lark Fields

Write all fields:

- `沟通日期`: first communication time
- `投递岗位`: detail-page job title
- `公司名称`: detail-page display company
- `薪资水平`: detail-page salary
- `工作经验`: structured detail-page requirement
- `学历`: structured detail-page requirement
- `岗位概述`: complete job description
- `流程状态`: allowed status option
- `备注`: recruiter, evidence, special context, closure, outsourcing/third-party, mismatch, discrepancy, or uncertainty

Create and verify with the atomic commands:

```bash
lark-cli base +record-upsert --base-token <base-token> --table-id <table-id> --json '<nine-field-object>'
lark-cli base +record-get --base-token <base-token> --table-id <table-id> --record-id <record-id>
```

Select values may be returned as arrays by `+record-get`; this is valid. Empty or absent required fields are verification failures.

## Status Rules

Use the latest explicit outcome; otherwise use the highest confirmed stage:

- `仅沟通`: candidate greeting/application plus delivered/read/system events, with no substantive recruiter reply
- `有交换`: substantive recruiter reply, resume request, or two-way discussion, without rejection or confirmed interview
- `不合适`: explicit mismatch, rejection, unsuitable experience, temporary rejection, or closed position
- `1面` / `2面` / `3面` / `4面`: corresponding interview round explicitly arranged or reached
- `Offered`: offer explicitly received
- `主动中止`: candidate explicitly withdraws or ends the process

Do not treat read receipts, attachment delivery, or automated consent cards alone as substantive exchange.

## Blockers

Stop before any pending unpin and report the exact completed state when any of these occurs:

- BOSS or Lark login expiration
- Keychain/scopes/authorization failure
- browser policy denial or persistent SPA reload loop
- missing table, field, or required select option
- unreadable job detail or missing required data
- failed Lark write or failed `+record-get` verification
- inability to reconfirm the same conversation before unpinning

Already completed and verified conversations may remain unpinned. Do not roll them back.

## Final Verification And Report

Before completion, verify:

- every processed conversation has a recorded and re-readable Lark record ID
- every record contains all nine fields and a complete job description
- every processed conversation menu now shows `置顶`
- no pinned candidate block remains and no visible candidate menu shows `取消置顶`
- no message was sent and no conversation was deleted

Report the processed count and, for each record: date, company, job, salary, experience, education, status, Lark result, and unpin result. List discrepancies, uncertainty, closed jobs, and any stopped actions.

---
name: boss-zhipin-lark-base
description: Use when processing BOSS 直聘 / zhipin.com pinned chat conversations, extracting job and chat details, and writing each conversation as a record into a Lark/Feishu Base table.
---

# BOSS 直聘到飞书 Base

## Core Rule

Treat each pinned BOSS conversation as one independent application/contact record. Do not deduplicate by company, job title, recruiter, or date; repeated jobs are valid and must be recorded separately.

## Required Skills And Tools

- Use `computer-use` or a user-authenticated browser session when BOSS requires the user's cookies. Browser-only sessions may fail on `zhipin.com`.
- Use `lark-shared` and `lark-base` before Lark CLI work. For wiki URLs, resolve the wiki node first and use the real Base token, not the `/wiki/` token.
- Read the automation memory first when this is a recurring automation: `/Users/gbs00/.codex/automations/boss/memory.md`.

## Safety Gates

- Never send messages to recruiters.
- Never delete conversations.
- Do not click `不感兴趣`, `黑名单`, or `删除`.
- If the message input is focused, avoid Enter or typing. Use mouse actions and `Escape` only when needed.
- Only cancel pinning after the Lark record has been created and verified with `+record-get`.
- On any blocker, notify the user immediately with what succeeded, what failed, and why; stop before any unpin action.

Blockers include login expiration, browser policy denial, page load failure, missing Lark scopes, missing fields, failed write, failed read-back verification, or unreadable job detail.

## Pinned Conversation Detection

Do not infer pin state from sort order or dates. Open the conversation's `更多` menu:

- Menu shows `取消置顶`: this conversation is pinned and should be processed.
- Menu shows `置顶`: this conversation is not pinned or has already been unpinned.

After unpinning, verify by reopening `更多` and confirming the menu now shows `置顶`.

## Workflow

1. Open `https://www.zhipin.com/web/geek/chat` in the user's logged-in browser.
2. From top to bottom, process only conversations whose `更多` menu shows `取消置顶`.
3. For each pinned conversation, record:
   - first communication time, normalized to `YYYY-MM-DD HH:mm:ss`
   - recruiter name and role
   - job title, company, salary
   - chat evidence for process status
4. Open job detail from the job title or `查看职位`.
5. Prefer job detail page data over chat page data. If different, write detail-page data and note the discrepancy.
6. Capture work experience, education, and the complete job description. Preserve original structure such as 岗位职责, 任职要求, 加分项.
7. Create a new Lark Base record. Do not perform duplicate checks.
8. Verify the record with `lark-cli base +record-get` and confirm all required fields are present.
9. Return to BOSS and cancel pinning. Verify the menu now shows `置顶`.
10. Repeat until no visible top-to-bottom conversation menu shows `取消置顶`.

## Lark Fields

Write these fields:

- `沟通日期`: first communication time, `YYYY-MM-DD HH:mm:ss`
- `投递岗位`: job title
- `公司名称`: company
- `薪资水平`: salary
- `工作经验`: requirement from job detail
- `学历`: requirement from job detail
- `岗位概述`: full job description, not a summary
- `流程状态`: one of the allowed status options
- `备注`: recruiter, special context, closed job, outsourcing/third-party, mismatch, discrepancy, or uncertainty

Use `+field-list` before writing to confirm writable fields and select options. Use `+record-upsert` without `--record-id` to create a new record.

## Status Rules

- `仅沟通`: only application, greeting, delivered/read status, or no substantive recruiter reply
- `有交换`: substantive two-way communication with no rejection or interview arrangement
- `不合适`: not suitable, mismatch, experience mismatch, temporarily unsuitable, closed position, or equivalent wording
- `1面` / `2面` / `3面` / `4面`: corresponding interview round arranged or reached
- `Offered`: offer received
- `主动中止`: candidate intentionally stops the process

## Verification Before Completion

Before reporting completion, verify:

- Every processed conversation has a verified Lark record.
- Every verified record contains all required fields.
- `岗位概述` is complete enough to preserve the original job description structure.
- Every processed BOSS conversation has been unpinned and verified by menu state.
- No message was sent and no conversation was deleted.
- The BOSS message page has no remaining pinned conversations according to the `更多` menu test.

## Report

Return a brief report with:

- processed pinned conversation count
- each record's date, company, job, salary, experience, education, status, Lark write result, and BOSS unpin result
- exceptions, uncertainty, and stopped actions

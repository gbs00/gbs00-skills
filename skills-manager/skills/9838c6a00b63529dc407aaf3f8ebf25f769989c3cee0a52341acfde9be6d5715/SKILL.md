---
name: grilling
description: Run an interactive critical interview about a plan, decision, or idea when the user wants to be grilled or explicitly wants a question-and-answer stress test. Do not use for ordinary reviews, audits, or requests to implement an already agreed plan.
---

Interview the user to resolve material decisions about goals, scope, cost, constraints, or irreversible consequences. Map these as a **design tree** without expanding every minor implementation detail into a question. Use documented, reversible defaults for nonessential details and state relevant assumptions.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled — the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask a small, prioritized set of material questions from the frontier in each round, with your recommended answers; do not overwhelm the user with every branch. Then wait for their answers before the next round.

Each question should be formatted like so:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Each round the user answers reshapes the tree — settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding facts is your job. Look up environment facts yourself with available tools; delegate only if subagents are available and delegation is authorized. Missing subagents do not block the interview. Ask the user only for material decisions or information unavailable through safe inspection. Independent questions can proceed while a fact is being checked.

Finish when the material decisions are resolved or the user asks to stop. Summarize the agreed plan, explicit assumptions, and unresolved risks without requiring every possible branch to be visited. Do not implement the plan until the user confirms the shared understanding and asks to proceed; ending the interview alone is not implementation approval.

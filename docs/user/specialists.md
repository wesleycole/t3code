# Specialists

Give your agent named specialists for focused reviews, research, or implementation.
Each specialist uses its own model and conversation, while working in the same
checkout as the parent. Its answer returns to the parent as a tool result.

## Create a specialist

Add a Markdown file under your project's `.agents/specialists/` directory:

```markdown
---
name: reviewer
description: Review current changes for concrete correctness bugs before shipping.
providerInstance: codex
model: gpt-5.6-sol
reasoningEffort: high
---

You are an independent correctness reviewer. Read the relevant diff and requirements,
then test the strongest plausible counterexample. Treat the parent's diagnosis as a
hypothesis. Prioritize observable bugs over style. Do not edit files.

Return the verdict, exact file/line evidence, an input that distinguishes the bug from
correct behavior, and the smallest correction. Report checks you actually ran and
anything you could not verify.
```

Use the ID of an existing provider instance and a model available to that account.
The default instance IDs are `codex` and `claudeAgent`; custom instances use their
configured IDs, not their display names. Specialist targets currently support Codex
and Claude. `reasoningEffort` is optional and must be supported by the selected model.

Add as many files as you need. Names must be unique, start with a letter or number,
and contain only letters, numbers, hyphens, or underscores (at most 53 characters).
`result`, `follow_up`, and `configuration` are reserved names.

Start a new provider session after adding or changing definitions. Definitions are
loaded from the thread's checkout when its tools are first requested; existing
specialist conversations retain their original role instructions.

## Use a specialist

Ask your agent: “Use the reviewer specialist to review these changes.” It receives
a `specialist_reviewer` tool and instructions for writing a self-contained assignment:
the outcome, evidence and file references, constraints, edit authorization, ownership
of concurrent work, and the expected answer. The specialist does not see the parent
conversation automatically. Its role instructions and the assignment stay separate.

Long tasks return a running conversation ID. The agent retrieves the answer with
`specialist_result` or continues the same conversation with `specialist_follow_up`.
Open a specialist from its parent conversation to inspect its work, then use the
parent link to return. Stopping the parent also stops its active specialists.

Specialists share live files, not a snapshot or an isolated worktree. Coordinate edit
ownership when both agents work concurrently. “Do not edit” is a prompt instruction,
not an enforced sandbox; children inherit the parent's permission mode. Specialists
cannot call T3's specialist tools recursively.

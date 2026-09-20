# Specialists

Give your agent named specialists for focused reviews, research, or implementation.
Each specialist uses its own model and conversation, while working in the same
checkout as the parent. Its answer returns to the parent as a tool result.

## Starter specialists

This fork includes three project-local definitions in
[`.agents/specialists/`](../../.agents/specialists/):

| Specialist | Use it for                                                                          | Default model                  |
| ---------- | ----------------------------------------------------------------------------------- | ------------------------------ |
| Oracle     | Architecture decisions, difficult debugging, and uncertain invariants               | GPT-5.6-Sol, high reasoning    |
| Librarian  | Understanding existing code and researching dependencies from authoritative sources | GPT-5.6-Luna, medium reasoning |
| Critic     | Reviewing a specific diff for concrete bugs and regressions                         | GPT-5.6-Sol, high reasoning    |

All three use the default Codex instance and are read-only by instruction. Change
their frontmatter to use models available to your account. To use them in another
project, copy the definitions into that project's `.agents/specialists/` directory;
they are not automatically installed into every project.

## Create a specialist

Add a Markdown file under your project's `.agents/specialists/` directory:

```markdown
---
name: critic
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

## Choose models by effort

In **Settings → General → Effort presets**, expand the specialists for an effort
level and choose each specialist's provider, model, and reasoning options. For
example, High can use Astra for the primary agent and Fable for Oracle and Critic.
Use **Custom specialist** to configure another name from your project definitions.

Overrides are saved with the conversation on its first send, including conversations
started from mobile. Later settings changes affect new conversations only. A specialist
without an override uses its Markdown definition's model; resetting its override
restores that behavior. Follow-ups keep the specialist conversation's original model.
If an overridden model is unavailable, that specialist reports an error rather than
silently using a different model. The primary conversation can still run.

## Use a specialist

Ask your agent: “Use Critic to review these changes.” It receives
a `specialist_critic` tool and instructions for writing a self-contained assignment:
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

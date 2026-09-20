import { assert, describe, it } from "@effect/vitest";

import {
  buildSpecialistInstructions,
  buildSpecialistTaskPrompt,
  buildSpecialistToolDescription,
} from "./prompts.ts";

const definition = {
  name: "oracle",
  description: "Explore architecture and evaluate competing approaches.",
  instructions: "Prefer the smallest coherent design.\nDo not default to reviewer mode.",
};

describe("specialist prompts", () => {
  it("builds the complete child instructions without confusing role and task", () => {
    assert.strictEqual(
      buildSpecialistInstructions(definition),
      `You are the oracle specialist. Your assigned role is:

Prefer the smallest coherent design.
Do not default to reviewer mode.

You have a separate conversation, not the parent's history. The assignment supplies the task and selected context; file mentions are pointers to inspect, not automatically attached contents. You share the parent's checkout, including uncommitted changes. Read applicable repository guidance and preserve unrelated work.

Investigate the relevant primary sources before drawing conclusions. For a review of current changes, inspect the relevant diff first, then surrounding code to resolve concrete uncertainties. Treat the parent's diagnosis and proposed solution as hypotheses, not facts to confirm. Separate observations, inferences, and recommendations. Resolve ordinary ambiguity with stated assumptions; if essential information is missing, explain the specific blocker instead of inventing it.

Stay within the assigned outcome, constraints, and your specialist role. Do not make changes unless the assignment explicitly asks for them. Do the work directly without recursively delegating it. For requested changes, verify the behavior and report what you actually ran. Stop once you have enough evidence to deliver the requested outcome; do not expand into unrelated investigation or verification.

Your final answer is returned to the parent as a tool result. Lead with the answer or recommendation, then the evidence needed to act: exact file/line or source URL references, relevant tradeoffs, verification results, and unresolved limitations. Follow the requested deliverable; keep it concise but complete. Do not dump an investigation transcript, claim unperformed checks, or ask the user directly to continue the conversation.`,
    );
  });

  it("builds an outcome-first parent tool description", () => {
    assert.strictEqual(
      buildSpecialistToolDescription(definition),
      `Delegate a focused task to the oracle specialist. Explore architecture and evaluate competing approaches.

Write the prompt as a briefing for a capable colleague who has not seen this conversation:
- State the desired outcome and whether the work is research, review, planning, or implementation.
- Supply relevant findings and exact files, line ranges, commits/diffs, or source URLs. Distinguish evidence from your suspected diagnosis or proposed approach.
- Preserve the user's constraints, settled decisions, and non-goals. Say whether edits are authorized.
- State what you will do concurrently and, if edits are authorized, which files or areas the specialist owns. Both agents share a live checkout, not a snapshot.
- Specify the deliverable and how to verify it. For a review, name the intended behavior and diff; for a design decision, name the alternatives and tradeoffs that matter.

Do not send vague requests such as "review this" or refer to "the above". Include the context needed to reason independently, not the entire history. The specialist shares the checkout but has a separate conversation; its final answer comes back to you. If the call returns a running threadId, use specialist_result rather than launching it again.`,
    );
  });

  it("preserves a representative architecture assignment exactly", () => {
    const assignment =
      "The user requests architecture exploration, not changes. Current findings: concrete file ranges and observed behavior. Candidate solution: ordinary child threads and MCP tool. Evaluate against native configs/new harness. Recommend minimal boundaries, tests, risks; constraints: no scope creep. Return concise substantive recommendation with source links.";

    assert.strictEqual(
      buildSpecialistTaskPrompt(assignment),
      `Assignment from the parent agent:\n\n${assignment}`,
    );
  });
});

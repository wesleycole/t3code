import {
  CommandId,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ModelSelection,
  type OrchestrationCommand,
  type OrchestrationReadModel,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const NOW = "2026-01-01T00:00:00.000Z";
const threadId = ThreadId.make("preset-thread");
const presetSelection: ModelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5-codex",
  options: [
    { id: "reasoningEffort", value: "high" },
    { id: "webSearch", value: false },
  ],
  effortPreset: "high",
  specialistModels: {
    oracle: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "fable" },
  },
};
const { effortPreset: _presetMarker, ...selectionWithoutPreset } = presetSelection;
const readModel: OrchestrationReadModel = {
  snapshotSequence: 1,
  updatedAt: NOW,
  projects: [],
  threads: [
    {
      id: threadId,
      projectId: ProjectId.make("preset-project"),
      title: "Preset thread",
      modelSelection: presetSelection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: null,
      worktreePath: null,
      pullRequests: [],
      latestTurn: null,
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
      settledOverride: null,
      settledAt: null,
      snoozedUntil: null,
      snoozedAt: null,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    },
  ],
};

const turnCommand = (
  modelSelection: ModelSelection,
): Extract<OrchestrationCommand, { type: "thread.turn.start" }> => ({
  type: "thread.turn.start",
  commandId: CommandId.make("preset-turn"),
  threadId,
  message: {
    messageId: MessageId.make("preset-message"),
    role: "user",
    text: "continue",
    attachments: [],
  },
  modelSelection,
  runtimeMode: "full-access",
  interactionMode: "default",
  createdAt: NOW,
});

it.layer(NodeServices.layer)("effort preset conversation invariants", (it) => {
  it.effect("allows the immutable snapshot with reordered options", () =>
    decideOrchestrationCommand({
      readModel,
      command: turnCommand({
        ...presetSelection,
        options: [...(presetSelection.options ?? [])].reverse(),
      }),
    }).pipe(Effect.asVoid),
  );

  it.effect.each([
    { name: "changes preset", selection: { ...presetSelection, effortPreset: "ultra" as const } },
    { name: "changes model", selection: { ...presetSelection, model: "gpt-5.4" } },
    {
      name: "changes an option",
      selection: { ...presetSelection, options: [{ id: "reasoningEffort", value: "low" }] },
    },
    { name: "removes the preset marker", selection: selectionWithoutPreset },
    {
      name: "removes specialist overrides",
      selection: { ...presetSelection, specialistModels: {} },
    },
    {
      name: "changes only a specialist model",
      selection: {
        ...presetSelection,
        specialistModels: {
          oracle: { instanceId: ProviderInstanceId.make("claudeAgent"), model: "opus" },
        },
      },
    },
  ])("rejects a turn that $name", ({ selection }) =>
    Effect.gen(function* () {
      const result = yield* Effect.result(
        decideOrchestrationCommand({ readModel, command: turnCommand(selection) }),
      );
      expect(result._tag).toBe("Failure");
      if (
        result._tag === "Failure" &&
        result.failure._tag === "OrchestrationCommandInvariantError"
      ) {
        expect(result.failure.detail).toContain("cannot change its model selection");
      }
    }),
  );

  it.effect("applies the same lock to metadata updates while leaving permissions independent", () =>
    Effect.gen(function* () {
      const changed = yield* Effect.result(
        decideOrchestrationCommand({
          readModel,
          command: {
            type: "thread.meta.update",
            commandId: CommandId.make("preset-meta-change"),
            threadId,
            modelSelection: { ...presetSelection, effortPreset: "ultra" },
          },
        }),
      );
      expect(changed._tag).toBe("Failure");

      const independent = yield* decideOrchestrationCommand({
        readModel,
        command: {
          ...turnCommand(presetSelection),
          commandId: CommandId.make("preset-turn-permissions"),
          runtimeMode: "approval-required",
          interactionMode: "plan",
        },
      });
      const independentEvents = Array.isArray(independent) ? independent : [independent];
      expect(independentEvents.length).toBeGreaterThan(0);
    }),
  );
});

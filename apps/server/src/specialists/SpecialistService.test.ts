import {
  CheckpointRef,
  CommandId,
  MessageId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type ModelSelection,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { TestClock } from "effect/testing";

import { ServerConfig } from "../config.ts";
import { OrchestrationCommandReceiptRepositoryLive } from "../persistence/Layers/OrchestrationCommandReceipts.ts";
import { OrchestrationEventStoreLive } from "../persistence/Layers/OrchestrationEventStore.ts";
import { SqlitePersistenceMemory } from "../persistence/Layers/Sqlite.ts";
import * as RepositoryIdentityResolver from "../project/RepositoryIdentityResolver.ts";
import { OrchestrationEngineLive } from "../orchestration/Layers/OrchestrationEngine.ts";
import { OrchestrationProjectionPipelineLive } from "../orchestration/Layers/ProjectionPipeline.ts";
import { OrchestrationProjectionSnapshotQueryLive } from "../orchestration/Layers/ProjectionSnapshotQuery.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as ThreadBackgroundLiveness from "../orchestration/ThreadBackgroundLiveness.ts";
import * as ThreadPlanProgress from "../orchestration/ThreadPlanProgress.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import { ProviderRegistry } from "../provider/Services/ProviderRegistry.ts";
import { buildSpecialistInstructions, buildSpecialistTaskPrompt } from "./prompts.ts";
import { SpecialistService } from "./SpecialistService.ts";

const now = "2026-09-20T12:00:00.000Z";
const parentId = ThreadId.make("parent");
const otherParentId = ThreadId.make("other-parent");
const parentInstance = ProviderInstanceId.make("parent-provider");
const specialistInstance = ProviderInstanceId.make("specialist-provider");
const overrideInstance = ProviderInstanceId.make("claude-override");
const overrideSelection = {
  instanceId: overrideInstance,
  model: "fable",
  options: [{ id: "effort", value: "high" }],
};
const definition = {
  name: "reviewer",
  description: "Reviews lifecycle behavior.",
  instructions: "Inspect the implementation and report exact evidence.",
  modelSelection: { instanceId: specialistInstance, model: "specialist-model" },
};

const providerLayer = (driverKind: "codex" | "claudeAgent" | "cursor" = "codex") =>
  Layer.mock(ProviderService)({
    getInstanceInfo: (instanceId) => {
      const driver = instanceId === overrideInstance ? "claudeAgent" : driverKind;
      return Effect.succeed({
        instanceId,
        driverKind: ProviderDriverKind.make(driver),
        displayName: undefined,
        enabled: true,
        continuationIdentity: {
          driverKind: ProviderDriverKind.make(driver),
          continuationKey: `${driver}:${instanceId}`,
        },
      });
    },
  });

const orchestrationLayer = Layer.mergeAll(
  OrchestrationEngineLive.pipe(
    Layer.provide(OrchestrationProjectionSnapshotQueryLive),
    Layer.provide(OrchestrationProjectionPipelineLive),
  ),
  OrchestrationProjectionSnapshotQueryLive,
).pipe(
  Layer.provideMerge(ThreadBackgroundLiveness.layer),
  Layer.provide(ThreadPlanProgress.layer),
  Layer.provide(OrchestrationEventStoreLive),
  Layer.provideMerge(OrchestrationCommandReceiptRepositoryLive),
  Layer.provide(RepositoryIdentityResolver.layer),
  Layer.provideMerge(SqlitePersistenceMemory),
  Layer.provideMerge(
    ServerConfig.layerTest(process.cwd(), { prefix: "t3-specialist-service-test-" }),
  ),
  Layer.provideMerge(NodeServices.layer),
);

const testLayer = (driverKind?: "codex" | "claudeAgent" | "cursor") =>
  SpecialistService.layer.pipe(
    Layer.provideMerge(orchestrationLayer),
    Layer.provide(providerLayer(driverKind)),
    Layer.provide(
      Layer.mock(ProviderRegistry)({
        getProviders: Effect.succeed([
          {
            instanceId: overrideInstance,
            driver: ProviderDriverKind.make("claudeAgent"),
            enabled: true,
            installed: true,
            status: "ready",
            version: null,
            auth: { status: "authenticated" },
            checkedAt: now,
            models: [
              {
                slug: "fable",
                name: "Fable",
                isCustom: false,
                capabilities: {
                  optionDescriptors: [
                    {
                      id: "effort",
                      label: "Effort",
                      type: "select",
                      options: [
                        { id: "high", label: "High" },
                        { id: "low", label: "Low" },
                      ],
                    },
                  ],
                },
              },
            ],
            slashCommands: [],
            skills: [],
          },
        ]),
      }),
    ),
  );

const seed = Effect.fnUntraced(function* (
  selection: ModelSelection = { instanceId: parentInstance, model: "parent-model" },
) {
  const engine = yield* OrchestrationEngineService;
  yield* engine.dispatch({
    type: "project.create",
    commandId: CommandId.make("create-project"),
    projectId: ProjectId.make("project"),
    title: "Project",
    workspaceRoot: "/tmp/specialist-project",
    defaultModelSelection: { instanceId: parentInstance, model: "parent-model" },
    createdAt: now,
  });
  for (const threadId of [parentId, otherParentId]) {
    yield* engine.dispatch({
      type: "thread.create",
      commandId: CommandId.make(`create-${threadId}`),
      threadId,
      projectId: ProjectId.make("project"),
      title: String(threadId),
      modelSelection: selection,
      runtimeMode: "full-access",
      interactionMode: "default",
      branch: "main",
      worktreePath: "/tmp/specialist-project",
      createdAt: now,
    });
  }
});

const startRun = Effect.fnUntraced(function* (prompt: string) {
  const engine = yield* OrchestrationEngineService;
  const service = yield* SpecialistService;
  const events = yield* engine.subscribeDomainEvents;
  const fiber = yield* Effect.forkChild(service.run(parentId, definition, prompt));
  const turnRequested = yield* events.pipe(
    Stream.filter((event) => event.type === "thread.turn-start-requested"),
    Stream.runHead,
  );
  return { fiber, childId: Option.getOrThrow(turnRequested).aggregateId as ThreadId };
});

const completeTurn = Effect.fnUntraced(function* (
  childId: ThreadId,
  suffix: string,
  answer: string,
) {
  const engine = yield* OrchestrationEngineService;
  const turnId = TurnId.make(`turn-${suffix}`);
  const messageId = MessageId.make(`answer-${suffix}`);
  yield* engine.dispatch({
    type: "thread.session.set",
    commandId: CommandId.make(`running-${suffix}`),
    threadId: childId,
    session: {
      threadId: childId,
      status: "running",
      providerName: "codex",
      providerInstanceId: specialistInstance,
      runtimeMode: "full-access",
      activeTurnId: turnId,
      lastError: null,
      updatedAt: now,
    },
    createdAt: now,
  });
  yield* engine.dispatch({
    type: "thread.message.reasoning.delta",
    commandId: CommandId.make(`commentary-${suffix}`),
    threadId: childId,
    messageId: MessageId.make(`commentary-${suffix}`),
    delta: "intermediate commentary",
    turnId,
    createdAt: now,
  });
  yield* engine.dispatch({
    type: "thread.message.reasoning.complete",
    commandId: CommandId.make(`commentary-complete-${suffix}`),
    threadId: childId,
    messageId: MessageId.make(`commentary-${suffix}`),
    turnId,
    createdAt: now,
  });
  yield* engine.dispatch({
    type: "thread.message.assistant.delta",
    commandId: CommandId.make(`answer-delta-${suffix}`),
    threadId: childId,
    messageId,
    delta: answer,
    turnId,
    createdAt: now,
  });
  yield* engine.dispatch({
    type: "thread.message.assistant.complete",
    commandId: CommandId.make(`answer-complete-${suffix}`),
    threadId: childId,
    messageId,
    turnId,
    createdAt: now,
  });
  yield* engine.dispatch({
    type: "thread.turn.diff.complete",
    commandId: CommandId.make(`diff-${suffix}`),
    threadId: childId,
    turnId,
    completedAt: now,
    checkpointRef: CheckpointRef.make(`refs/t3/checkpoints/${childId}/${suffix}`),
    status: "ready",
    files: [],
    assistantMessageId: messageId,
    checkpointTurnCount: 1,
    createdAt: now,
  });
  yield* engine.dispatch({
    type: "thread.session.set",
    commandId: CommandId.make(`ready-${suffix}`),
    threadId: childId,
    session: {
      threadId: childId,
      status: "ready",
      providerName: "codex",
      providerInstanceId: specialistInstance,
      runtimeMode: "full-access",
      activeTurnId: null,
      lastError: null,
      updatedAt: now,
    },
    createdAt: now,
  });
});

it.layer(Layer.fresh(testLayer()))("SpecialistService integration", (it) => {
  it.effect("uses the parent's specialist snapshot across providers and follow-ups", () =>
    Effect.gen(function* () {
      yield* seed({
        instanceId: parentInstance,
        model: "astra",
        effortPreset: "high",
        specialistModels: {
          reviewer: overrideSelection,
          librarian: { instanceId: specialistInstance, model: "luna" },
        },
      });
      const snapshots = yield* ProjectionSnapshotQuery;
      const engine = yield* OrchestrationEngineService;
      const service = yield* SpecialistService;
      const { fiber, childId } = yield* startRun("Review with the High effort specialist");
      const child = Option.getOrThrow(yield* snapshots.getThreadDetailById(childId));
      assert.deepEqual(child.modelSelection, {
        instanceId: overrideInstance,
        model: "fable",
        options: [{ id: "effort", value: "high" }],
      });
      assert.strictEqual(child.specialist?.instructions, buildSpecialistInstructions(definition));
      yield* completeTurn(childId, "preset", "review answer");
      yield* Fiber.join(fiber);

      const events = yield* engine.subscribeDomainEvents;
      const followUp = yield* Effect.forkChild(service.followUp(parentId, childId, "Check again"));
      const requested = Option.getOrThrow(
        yield* events.pipe(
          Stream.filter((event) => event.type === "thread.turn-start-requested"),
          Stream.runHead,
        ),
      );
      if (requested.type !== "thread.turn-start-requested") return;
      assert.deepEqual(requested.payload.modelSelection, child.modelSelection);
      yield* completeTurn(childId, "preset-followup", "confirmed");
      assert.strictEqual((yield* Fiber.join(followUp)).text, "confirmed");
    }).pipe(Effect.scoped, Effect.provide(Layer.fresh(testLayer()))),
  );

  it.effect("reports an unavailable override instead of falling back to the definition", () =>
    Effect.gen(function* () {
      yield* seed({
        instanceId: parentInstance,
        model: "astra",
        effortPreset: "high",
        specialistModels: { reviewer: { ...overrideSelection, model: "missing-model" } },
      });
      const service = yield* SpecialistService;
      const snapshots = yield* ProjectionSnapshotQuery;
      const error = yield* Effect.flip(service.run(parentId, definition, "Review"));
      assert.include(error.message, "missing-model is unavailable");
      assert.isFalse(
        (yield* snapshots.getShellSnapshot()).threads.some((thread) => thread.specialist),
      );
    }).pipe(Effect.scoped, Effect.provide(Layer.fresh(testLayer()))),
  );

  it.effect(
    "creates an independent configured child and returns only its persisted terminal answer",
    () =>
      Effect.gen(function* () {
        yield* seed();
        const snapshots = yield* ProjectionSnapshotQuery;
        const { fiber, childId } = yield* startRun("  Preserve this task faithfully.  ");
        const child = Option.getOrThrow(yield* snapshots.getThreadDetailById(childId));
        assert.deepEqual(child.modelSelection, definition.modelSelection);
        assert.strictEqual(child.specialist?.parentThreadId, parentId);
        assert.strictEqual(child.specialist?.instructions, buildSpecialistInstructions(definition));
        assert.notStrictEqual(child.id, parentId);
        assert.strictEqual(
          child.messages[0]?.text,
          buildSpecialistTaskPrompt("  Preserve this task faithfully.  "),
        );

        yield* completeTurn(childId, "first", "persisted final answer");
        assert.deepEqual(yield* Fiber.join(fiber), {
          threadId: childId,
          status: "completed",
          text: "persisted final answer",
        });
      }),
  );

  it.effect("returns the existing running handle on timeout without creating a duplicate", () =>
    Effect.gen(function* () {
      yield* seed();
      const snapshots = yield* ProjectionSnapshotQuery;
      const before = (yield* snapshots.getShellSnapshot()).threads.filter(
        (thread) => thread.specialist?.parentThreadId === parentId,
      ).length;
      const { fiber, childId } = yield* startRun("long task");
      yield* TestClock.adjust("40 seconds");
      assert.deepEqual(yield* Fiber.join(fiber), {
        threadId: childId,
        status: "running",
        text: "Specialist is still working. Use specialist_result to retrieve its answer.",
      });
      const shell = yield* snapshots.getShellSnapshot();
      assert.strictEqual(
        shell.threads.filter((thread) => thread.specialist?.parentThreadId === parentId).length,
        before + 1,
      );
    }),
  );

  it.effect("waits for the follow-up turn instead of returning the previous answer", () =>
    Effect.gen(function* () {
      yield* seed();
      const service = yield* SpecialistService;
      const engine = yield* OrchestrationEngineService;
      const first = yield* startRun("first task");
      yield* completeTurn(first.childId, "initial", "first answer");
      yield* Fiber.join(first.fiber);

      const events = yield* engine.subscribeDomainEvents;
      const followUp = yield* Effect.forkChild(
        service.followUp(parentId, first.childId, "second task"),
      );
      yield* events.pipe(
        Stream.filter(
          (event) =>
            event.aggregateId === first.childId && event.type === "thread.turn-start-requested",
        ),
        Stream.runHead,
      );
      assert.isUndefined(followUp.pollUnsafe());
      yield* completeTurn(first.childId, "follow-up", "second answer");
      assert.strictEqual((yield* Fiber.join(followUp)).text, "second answer");
    }),
  );

  it.effect("rejects access from another parent", () =>
    Effect.gen(function* () {
      yield* seed();
      const service = yield* SpecialistService;
      const { fiber, childId } = yield* startRun("private task");
      const error = yield* Effect.flip(service.result(otherParentId, childId));
      assert.strictEqual(error.message, "This specialist conversation belongs to another parent.");
      yield* TestClock.adjust("40 seconds");
      yield* Fiber.join(fiber);
    }),
  );

  for (const state of ["active", "queued"] as const) {
    it.effect(`stops an ${state} child when its parent is cancelled`, () =>
      Effect.gen(function* () {
        yield* seed();
        const engine = yield* OrchestrationEngineService;
        const { fiber, childId } = yield* startRun("cancel me");
        if (state === "active") {
          yield* engine.dispatch({
            type: "thread.session.set",
            commandId: CommandId.make("child-running-for-cancel"),
            threadId: childId,
            session: {
              threadId: childId,
              status: "running",
              providerName: "codex",
              providerInstanceId: specialistInstance,
              runtimeMode: "full-access",
              activeTurnId: TurnId.make("child-turn"),
              lastError: null,
              updatedAt: now,
            },
            createdAt: now,
          });
        }
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make(`parent-running-${state}`),
          threadId: parentId,
          session: {
            threadId: parentId,
            status: "running",
            providerName: "codex",
            providerInstanceId: parentInstance,
            runtimeMode: "full-access",
            activeTurnId: TurnId.make("parent-turn"),
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });
        const events = yield* engine.subscribeDomainEvents;
        yield* engine.dispatch({
          type: "thread.turn.interrupt",
          commandId: CommandId.make(`interrupt-parent-${state}`),
          threadId: parentId,
          turnId: TurnId.make("parent-turn"),
          createdAt: now,
        });
        const stopped = yield* events.pipe(
          Stream.filter(
            (event) =>
              event.aggregateId === childId && event.type === "thread.session-stop-requested",
          ),
          Stream.runHead,
        );
        assert.isTrue(Option.isSome(stopped));
        yield* TestClock.adjust("40 seconds");
        yield* Fiber.join(fiber);
      }),
    );
  }

  it.effect("waits for a retry instead of returning the previous failure", () =>
    Effect.gen(function* () {
      yield* seed();
      const engine = yield* OrchestrationEngineService;
      const service = yield* SpecialistService;
      const first = yield* startRun("failing task");
      yield* engine.dispatch({
        type: "thread.session.set",
        commandId: CommandId.make("failed-child"),
        threadId: first.childId,
        session: {
          threadId: first.childId,
          status: "error",
          providerName: "codex",
          providerInstanceId: specialistInstance,
          runtimeMode: "full-access",
          activeTurnId: null,
          lastError: "original failure",
          updatedAt: now,
        },
        createdAt: now,
      });
      assert.strictEqual((yield* Fiber.join(first.fiber)).status, "error");
      const events = yield* engine.subscribeDomainEvents;
      const retry = yield* Effect.forkChild(
        service.followUp(parentId, first.childId, "retry task"),
      );
      yield* events.pipe(
        Stream.filter(
          (event) =>
            event.aggregateId === first.childId && event.type === "thread.turn-start-requested",
        ),
        Stream.runHead,
      );
      assert.isUndefined(retry.pollUnsafe());
      yield* completeTurn(first.childId, "retry", "recovered answer");
      assert.strictEqual((yield* Fiber.join(retry)).text, "recovered answer");
    }),
  );

  it.effect("returns a terminal diagnostic when the provider completed without text", () =>
    Effect.gen(function* () {
      yield* seed();
      const engine = yield* OrchestrationEngineService;
      const { fiber, childId } = yield* startRun("textless task");
      for (const status of ["running", "ready"] as const) {
        yield* engine.dispatch({
          type: "thread.session.set",
          commandId: CommandId.make(`textless-${status}`),
          threadId: childId,
          session: {
            threadId: childId,
            status,
            providerName: "codex",
            providerInstanceId: specialistInstance,
            runtimeMode: "full-access",
            activeTurnId: status === "running" ? TurnId.make("textless-turn") : null,
            lastError: null,
            updatedAt: now,
          },
          createdAt: now,
        });
      }
      const result = yield* Fiber.join(fiber);
      assert.strictEqual(result.status, "completed");
      assert.include(result.text, "without an assistant answer");
    }),
  );
});

it.effect("rejects specialist definitions targeting an unsupported provider driver", () =>
  Effect.gen(function* () {
    yield* seed();
    const service = yield* SpecialistService;
    const error = yield* Effect.flip(service.run(parentId, definition, "task"));
    assert.include(error.message, "requires a Codex or Claude provider instance");
  }).pipe(Effect.scoped, Effect.provide(Layer.fresh(testLayer("cursor")))),
);

it.effect("maps configured reasoning effort to Claude's model option", () =>
  Effect.gen(function* () {
    yield* seed();
    const service = yield* SpecialistService;
    const engine = yield* OrchestrationEngineService;
    const snapshots = yield* ProjectionSnapshotQuery;
    const events = yield* engine.subscribeDomainEvents;
    const fiber = yield* Effect.forkChild(
      service.run(
        parentId,
        {
          ...definition,
          modelSelection: {
            ...definition.modelSelection,
            options: [{ id: "reasoningEffort", value: "high" }],
          },
        },
        "Review with Claude",
      ),
    );
    const requested = Option.getOrThrow(
      yield* events.pipe(
        Stream.filter((event) => event.type === "thread.turn-start-requested"),
        Stream.runHead,
      ),
    );
    assert.strictEqual(requested.type, "thread.turn-start-requested");
    if (requested.type !== "thread.turn-start-requested") return;
    const child = Option.getOrThrow(
      yield* snapshots.getThreadDetailById(requested.payload.threadId),
    );
    assert.deepEqual(child.modelSelection.options, [{ id: "effort", value: "high" }]);
    yield* TestClock.adjust("40 seconds");
    yield* Fiber.join(fiber);
  }).pipe(Effect.scoped, Effect.provide(Layer.fresh(testLayer("claudeAgent")))),
);

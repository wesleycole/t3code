import { CommandId, MessageId, ThreadId, type OrchestrationThread } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProjectionTurnRepository } from "../persistence/Services/ProjectionTurns.ts";
import { ProjectionTurnRepositoryLive } from "../persistence/Layers/ProjectionTurns.ts";
import { ProviderService } from "../provider/Services/ProviderService.ts";
import type { SpecialistDefinition } from "./definitions.ts";
import { buildSpecialistInstructions, buildSpecialistTaskPrompt } from "./prompts.ts";

/** A consultation's current outcome; running children can be queried again. */
export type SpecialistResult = {
  readonly threadId: ThreadId;
  readonly status: "running" | "completed" | "error" | "interrupted";
  readonly text: string;
};

/** Expected specialist configuration, execution, or lookup failure. */
export class SpecialistError extends Schema.TaggedError<SpecialistError>()("SpecialistError", {
  detail: Schema.String,
}) {
  override get message() {
    return this.detail;
  }
}

const failure = (cause: { readonly message: string }) =>
  new SpecialistError({ detail: cause.message });

const resultOf = (thread: OrchestrationThread): SpecialistResult => {
  const turn = thread.latestTurn;
  if (thread.session?.status === "error") {
    return {
      threadId: thread.id,
      status: "error",
      text: thread.session.lastError ?? "Specialist failed.",
    };
  }
  if (turn && turn.state !== "running" && thread.session?.status !== "running") {
    const answer = thread.messages.find((message) => message.id === turn.assistantMessageId);
    // Runtime ingestion finalizes output before publishing terminal session state.
    return {
      threadId: thread.id,
      status: turn.state,
      text:
        answer?.text ??
        (turn.state === "completed"
          ? "Specialist completed without an assistant answer. Send a follow-up for clarification."
          : `Specialist ${turn.state}.`),
    };
  }
  if (thread.session?.status === "stopped" || thread.session?.status === "interrupted") {
    return {
      threadId: thread.id,
      status: "interrupted",
      text: "Specialist session stopped. Send a follow-up to resume.",
    };
  }
  return {
    threadId: thread.id,
    status: "running",
    text: "Specialist is still working. Use specialist_result to retrieve its answer.",
  };
};

/** Runs specialist definitions using ordinary durable T3 child threads. */
export class SpecialistService extends Context.Service<
  SpecialistService,
  {
    readonly run: (
      parentThreadId: ThreadId,
      definition: SpecialistDefinition,
      prompt: string,
    ) => Effect.Effect<SpecialistResult, SpecialistError>;
    readonly result: (
      parentThreadId: ThreadId,
      threadId: ThreadId,
    ) => Effect.Effect<SpecialistResult, SpecialistError>;
    readonly followUp: (
      parentThreadId: ThreadId,
      threadId: ThreadId,
      prompt: string,
    ) => Effect.Effect<SpecialistResult, SpecialistError>;
  }
>()("t3/specialists/SpecialistService") {
  /** Uses the existing engine and read model; no separate execution queue. */
  static readonly layer = Layer.effect(
    SpecialistService,
    Effect.gen(function* () {
      const engine = yield* OrchestrationEngineService;
      const snapshots = yield* ProjectionSnapshotQuery;
      const turns = yield* ProjectionTurnRepository;
      const providers = yield* ProviderService;
      const crypto = yield* Crypto.Crypto;
      const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
      const commandId = crypto.randomUUIDv4.pipe(Effect.orDie, Effect.map(CommandId.make));

      const requireThread = Effect.fn("SpecialistService.requireThread")(function* (
        threadId: ThreadId,
      ) {
        const thread = yield* snapshots
          .getThreadDetailById(threadId)
          .pipe(Effect.mapError(failure));
        if (Option.isNone(thread))
          return yield* new SpecialistError({ detail: `Thread '${threadId}' was not found.` });
        return thread.value;
      });
      const requireChild = Effect.fn("SpecialistService.requireChild")(function* (
        parentThreadId: ThreadId,
        threadId: ThreadId,
      ) {
        const thread = yield* requireThread(threadId);
        if (thread.specialist?.parentThreadId !== parentThreadId) {
          return yield* new SpecialistError({
            detail: "This specialist conversation belongs to another parent.",
          });
        }
        return thread;
      });

      const readResult = Effect.fn("SpecialistService.readResult")(function* (
        parentThreadId: ThreadId,
        threadId: ThreadId,
      ) {
        const pending = yield* turns
          .getPendingTurnStartByThreadId({ threadId })
          .pipe(Effect.mapError(failure));
        const child = yield* requireChild(parentThreadId, threadId);
        if (Option.isSome(pending)) {
          return {
            threadId,
            status: "running",
            text: "Specialist is still working. Use specialist_result to retrieve its answer.",
          } satisfies SpecialistResult;
        }
        return resultOf(child);
      });

      const result = Effect.fn("SpecialistService.result")(function* (
        parentThreadId: ThreadId,
        threadId: ThreadId,
      ) {
        return yield* Effect.scoped(
          Effect.gen(function* () {
            // Subscribe before reading so completion between the read and wait is not lost.
            const events = yield* engine.subscribeDomainEvents;
            const current = yield* readResult(parentThreadId, threadId);
            if (current.status !== "running") return current;
            const completed = yield* events.pipe(
              Stream.filter(
                (event) =>
                  event.aggregateId === threadId &&
                  (event.type === "thread.session-set" ||
                    event.type === "thread.deleted" ||
                    event.type === "thread.turn-diff-completed" ||
                    (event.type === "thread.message-sent" && !event.payload.streaming)),
              ),
              Stream.mapEffect(() => readResult(parentThreadId, threadId)),
              Stream.filter((outcome) => outcome.status !== "running"),
              Stream.runHead,
              Effect.timeoutOption("40 seconds"),
            );
            return Option.getOrElse(Option.flatten(completed), () => current);
          }),
        );
      });

      const send = Effect.fn("SpecialistService.send")(function* (
        thread: OrchestrationThread,
        prompt: string,
      ) {
        yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId: yield* commandId,
            threadId: thread.id,
            message: {
              messageId: MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
              role: "user",
              text: buildSpecialistTaskPrompt(prompt),
              attachments: [],
            },
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: "default",
            createdAt: yield* now,
          })
          .pipe(Effect.mapError(failure));
      });

      const run = Effect.fn("SpecialistService.run")(function* (
        parentThreadId: ThreadId,
        definition: SpecialistDefinition,
        prompt: string,
      ) {
        const parent = yield* requireThread(parentThreadId);
        if (parent.specialist)
          return yield* new SpecialistError({
            detail: "Specialists cannot delegate to more specialists.",
          });
        const target = yield* providers
          .getInstanceInfo(definition.modelSelection.instanceId)
          .pipe(Effect.mapError(failure));
        if (target.driverKind !== "codex" && target.driverKind !== "claudeAgent") {
          return yield* new SpecialistError({
            detail: `Specialist '${definition.name}' requires a Codex or Claude provider instance.`,
          });
        }
        const modelSelection = {
          ...definition.modelSelection,
          ...(definition.modelSelection.options
            ? {
                options: definition.modelSelection.options.map((option) =>
                  target.driverKind === "claudeAgent" && option.id === "reasoningEffort"
                    ? { ...option, id: "effort" }
                    : option,
                ),
              }
            : {}),
        };
        const threadId = ThreadId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie));
        yield* engine
          .dispatch({
            type: "thread.create",
            commandId: yield* commandId,
            threadId,
            projectId: parent.projectId,
            title: `${definition.name}: ${prompt.trim().split("\n")[0]?.slice(0, 100) ?? "Consultation"}`,
            modelSelection,
            runtimeMode: parent.runtimeMode,
            interactionMode: "default",
            branch: parent.branch,
            worktreePath: parent.worktreePath,
            specialist: {
              name: definition.name,
              description: definition.description,
              instructions: buildSpecialistInstructions(definition),
              parentThreadId,
              parentTurnId: parent.session?.activeTurnId ?? null,
            },
            createdAt: yield* now,
          })
          .pipe(Effect.mapError(failure));
        yield* send(yield* requireThread(threadId), prompt);
        return yield* result(parentThreadId, threadId);
      });

      const followUp = Effect.fn("SpecialistService.followUp")(function* (
        parentThreadId: ThreadId,
        threadId: ThreadId,
        prompt: string,
      ) {
        const child = yield* requireChild(parentThreadId, threadId);
        const pending = yield* turns
          .getPendingTurnStartByThreadId({ threadId })
          .pipe(Effect.mapError(failure));
        if (
          Option.isSome(pending) ||
          child.latestTurn?.state === "running" ||
          child.session?.status === "starting"
        ) {
          return yield* new SpecialistError({
            detail:
              "The specialist is still working. Retrieve its result before sending a follow-up.",
          });
        }
        yield* send(child, prompt);
        return yield* result(parentThreadId, threadId);
      });

      const events = yield* engine.subscribeDomainEvents;
      yield* events.pipe(
        Stream.filter(
          (event) =>
            event.type === "thread.turn-interrupt-requested" ||
            event.type === "thread.session-stop-requested" ||
            event.type === "thread.deleted",
        ),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const shell = yield* snapshots.getShellSnapshot();
            for (const child of shell.threads) {
              if (child.specialist?.parentThreadId !== event.aggregateId) continue;
              const pending = yield* turns.getPendingTurnStartByThreadId({ threadId: child.id });
              if (
                Option.isNone(pending) &&
                child.latestTurn?.state !== "running" &&
                child.session?.status !== "starting"
              )
                continue;
              yield* engine.dispatch({
                type: "thread.session.stop",
                commandId: yield* commandId,
                threadId: child.id,
                createdAt: yield* now,
              });
            }
          }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Could not stop a specialist with its parent", { cause }),
            ),
          ),
        ),
        Effect.forkScoped,
      );
      return SpecialistService.of({ run, result, followUp });
    }),
  ).pipe(Layer.provide(ProjectionTurnRepositoryLive));
}

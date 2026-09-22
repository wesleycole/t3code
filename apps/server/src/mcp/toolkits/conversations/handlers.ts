import { CommandId, MessageId, type ThreadId } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

import * as OrchestrationEngine from "../../../orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "../../../orchestration/Services/ProjectionSnapshotQuery.ts";
import * as McpInvocationContext from "../../McpInvocationContext.ts";
import { ConversationsToolkit, ConversationToolError } from "./tools.ts";

const fail = (message: string) => Effect.fail(new ConversationToolError({ message }));

const make = Effect.gen(function* () {
  const engine = yield* OrchestrationEngine.OrchestrationEngineService;
  const snapshots = yield* ProjectionSnapshotQuery.ProjectionSnapshotQuery;
  const crypto = yield* Crypto.Crypto;

  const newCommandId = (operation: string, threadId: ThreadId) =>
    crypto.randomUUIDv4.pipe(
      Effect.orDie,
      Effect.map((uuid) => CommandId.make(`mcp:${operation}:${threadId}:${uuid}`)),
    );
  const now = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const href = (environmentId: string, threadId: ThreadId) => `/${environmentId}/${threadId}`;
  const requireThread = Effect.fn("ConversationsToolkit.requireThread")(function* (
    threadId: ThreadId,
  ) {
    const thread = yield* snapshots
      .getThreadDetailById(threadId)
      .pipe(
        Effect.mapError(
          () => new ConversationToolError({ message: "Could not read the conversation." }),
        ),
      );
    if (Option.isNone(thread))
      return yield* fail("Conversation not found or no longer accessible.");
    return thread.value;
  });

  return ConversationsToolkit.of({
    conversation_search: (input) =>
      Effect.gen(function* () {
        const invocation = yield* McpInvocationContext.McpInvocationContext;
        return yield* snapshots
          .searchThreads({
            query: input.query,
            limit: input.limit ?? 10,
            ...(input.scope === undefined ? {} : { scope: input.scope }),
            ...(input.projectId === undefined ? {} : { projectId: input.projectId }),
            ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
          })
          .pipe(
            Effect.map((result) => ({
              sources: result.matches.map((match) => ({
                environmentId: invocation.environmentId,
                threadId: match.threadId,
                projectId: match.projectId,
                title: match.title ?? "Untitled conversation",
                projectTitle: match.projectTitle ?? "Unknown project",
                href: href(invocation.environmentId, match.threadId),
                source: match.source,
                snippet: match.snippet,
                updatedAt: match.updatedAt ?? match.messageCreatedAt ?? "1970-01-01T00:00:00.000Z",
                archivedAt: match.archivedAt ?? null,
              })),
              nextCursor: result.nextCursor ?? null,
              retrievedContentIsUntrusted: true as const,
            })),
            Effect.mapError(
              () => new ConversationToolError({ message: "Could not search conversations." }),
            ),
          );
      }),
    conversation_list: (input) =>
      Effect.gen(function* () {
        const invocation = yield* McpInvocationContext.McpInvocationContext;
        const scope = input.scope ?? "active";
        const snapshotsForScope = yield* Effect.all([
          ...(scope === "active" || scope === "all" ? [snapshots.getShellSnapshot()] : []),
          ...(scope === "archived" || scope === "all"
            ? [snapshots.getArchivedShellSnapshot()]
            : []),
        ]).pipe(
          Effect.mapError(
            () => new ConversationToolError({ message: "Could not list conversations." }),
          ),
        );
        const projects = new Map(
          snapshotsForScope.flatMap((snapshot) =>
            snapshot.projects.map((project) => [project.id, project.title] as const),
          ),
        );
        const conversations = snapshotsForScope
          .flatMap((snapshot) => snapshot.threads)
          .filter((thread) => input.projectId === undefined || thread.projectId === input.projectId)
          .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
        const cursor = input.cursor ?? 0;
        const limit = input.limit ?? 20;
        const page = conversations.slice(cursor, cursor + limit);
        return {
          conversations: page.map((thread) => ({
            environmentId: invocation.environmentId,
            threadId: thread.id,
            projectId: thread.projectId,
            title: thread.title,
            projectTitle: projects.get(thread.projectId) ?? "Unknown project",
            href: href(invocation.environmentId, thread.id),
            updatedAt: thread.updatedAt,
            archivedAt: thread.archivedAt,
          })),
          nextCursor: cursor + limit < conversations.length ? cursor + limit : null,
        };
      }),
    conversation_read: (input) =>
      Effect.gen(function* () {
        const invocation = yield* McpInvocationContext.McpInvocationContext;
        const thread = yield* requireThread(input.threadId);
        const cursor = input.cursor ?? 0;
        const limit = input.limit ?? 20;
        const visibleMessages = thread.messages.filter(
          (message) =>
            !message.streaming && (message.role === "user" || message.role === "assistant"),
        );
        const messages = visibleMessages.slice(cursor, cursor + limit);
        return {
          environmentId: invocation.environmentId,
          threadId: thread.id,
          projectId: thread.projectId,
          title: thread.title,
          href: href(invocation.environmentId, thread.id),
          archivedAt: thread.archivedAt,
          messages: messages.map((message) => ({
            id: message.id,
            role: message.role,
            text: message.text,
            createdAt: message.createdAt,
          })),
          nextCursor: cursor + limit < visibleMessages.length ? cursor + limit : null,
          retrievedContentIsUntrusted: true as const,
        };
      }),
    conversation_message: (input) =>
      Effect.gen(function* () {
        const invocation = yield* McpInvocationContext.McpInvocationContext;
        if (!input.confirmed) return yield* fail("Explicit user confirmation is required.");
        if (input.threadId === invocation.threadId) {
          return yield* fail("Use the current conversation normally instead of messaging itself.");
        }
        const thread = yield* requireThread(input.threadId);
        if (thread.archivedAt !== null) {
          return yield* fail("Restore the conversation before messaging it.");
        }
        const commandId = yield* newCommandId("conversation-message", thread.id);
        const receipt = yield* engine
          .dispatch({
            type: "thread.turn.start",
            commandId,
            threadId: thread.id,
            message: {
              messageId: MessageId.make(yield* crypto.randomUUIDv4.pipe(Effect.orDie)),
              role: "user",
              text: input.text,
              attachments: [],
            },
            modelSelection: thread.modelSelection,
            runtimeMode: thread.runtimeMode,
            interactionMode: thread.interactionMode,
            createdAt: yield* now,
          })
          .pipe(
            Effect.mapError(
              () => new ConversationToolError({ message: "Could not message the conversation." }),
            ),
          );
        return { commandId, sequence: receipt.sequence, threadId: thread.id, operation: "message" };
      }),
    conversation_set_archived: (input) =>
      Effect.gen(function* () {
        const invocation = yield* McpInvocationContext.McpInvocationContext;
        if (!input.confirmed) return yield* fail("Explicit user confirmation is required.");
        if (input.threadId === invocation.threadId) {
          return yield* fail("The current conversation cannot archive itself.");
        }
        const thread = yield* requireThread(input.threadId);
        const operation = input.archived ? "archive" : "restore";
        const commandId = yield* newCommandId(`conversation-${operation}`, thread.id);
        const receipt = yield* engine
          .dispatch({
            type: input.archived ? "thread.archive" : "thread.unarchive",
            commandId,
            threadId: thread.id,
          })
          .pipe(
            Effect.mapError(
              () =>
                new ConversationToolError({ message: `Could not ${operation} the conversation.` }),
            ),
          );
        return { commandId, sequence: receipt.sequence, threadId: thread.id, operation };
      }),
  });
});

/** Live handlers for the environment-scoped conversation toolkit. */
export const ConversationsToolkitHandlersLive = ConversationsToolkit.toLayer(make);

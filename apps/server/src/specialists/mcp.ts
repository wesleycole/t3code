import { ThreadId, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { loadSpecialistDefinitions } from "./definitions.ts";
import { buildSpecialistToolDescription } from "./prompts.ts";
import { SpecialistService } from "./SpecialistService.ts";

const Prompt = Schema.Struct({ prompt: TrimmedNonEmptyString });
const Child = Schema.Struct({ threadId: ThreadId });
const FollowUp = Schema.Struct({ threadId: ThreadId, prompt: TrimmedNonEmptyString });
const decodePrompt = Schema.decodeUnknownEffect(Prompt);
const decodeChild = Schema.decodeUnknownEffect(Child);
const decodeFollowUp = Schema.decodeUnknownEffect(FollowUp);
const promptProperty = {
  type: "string",
  description:
    "A self-contained assignment: desired outcome, relevant findings and sources, constraints, and what to return. The specialist cannot see your conversation.",
};

/** Registers a frozen, thread-local catalog on that provider session's MCP server. */
export const specialistToolsLayer = (parentThreadId: ThreadId) =>
  Layer.effectDiscard(
    Effect.gen(function* () {
      const server = yield* McpServer.McpServer;
      const snapshots = yield* ProjectionSnapshotQuery;
      const service = yield* SpecialistService;
      const thread = yield* snapshots.getThreadShellById(parentThreadId);
      if (Option.isNone(thread) || thread.value.specialist) return;
      const project = yield* snapshots.getProjectShellById(thread.value.projectId);
      if (Option.isNone(project)) return;

      const add = (
        name: string,
        description: string,
        inputSchema: (typeof McpSchema.Tool.Type)["inputSchema"],
        handle: (payload: unknown) => Effect.Effect<unknown, { readonly message: string }>,
      ) =>
        server.addTool({
          tool: new McpSchema.Tool({ name, description, inputSchema }),
          annotations: Context.empty(),
          handle: (payload: unknown) =>
            handle(payload).pipe(
              Effect.match({
                onFailure: (error) =>
                  new McpSchema.CallToolResult({
                    isError: true,
                    content: [{ type: "text", text: error.message }],
                  }),
                onSuccess: (result) =>
                  new McpSchema.CallToolResult({
                    content: [{ type: "text", text: JSON.stringify(result) }],
                  }),
              }),
            ),
        });

      const definitions = yield* loadSpecialistDefinitions(
        thread.value.worktreePath ?? project.value.workspaceRoot,
      ).pipe(
        Effect.catch((error) =>
          add(
            "specialist_configuration",
            "Explain why this project's specialist definitions could not be loaded. Fix the definition and restart the provider session.",
            { type: "object", properties: {} },
            () => Effect.fail(error),
          ).pipe(Effect.as([])),
        ),
      );
      for (const definition of definitions) {
        yield* add(
          `specialist_${definition.name}`,
          buildSpecialistToolDescription(definition),
          {
            type: "object",
            properties: { prompt: promptProperty },
            required: ["prompt"],
          },
          (payload) =>
            decodePrompt(payload).pipe(
              Effect.flatMap(({ prompt }) => service.run(parentThreadId, definition, prompt)),
            ),
        );
      }
      yield* add(
        "specialist_result",
        "Wait for or retrieve the final answer from an existing specialist child. Use the threadId returned by a specialist tool; do not launch a duplicate consultation when it is still running.",
        {
          type: "object",
          properties: { threadId: { type: "string" } },
          required: ["threadId"],
        },
        (payload) =>
          decodeChild(payload).pipe(
            Effect.flatMap(({ threadId }) => service.result(parentThreadId, threadId)),
          ),
      );
      yield* add(
        "specialist_follow_up",
        "Continue an idle specialist conversation with another self-contained assignment. The child retains its previous context and specialist instructions. Wait for its current answer before following up.",
        {
          type: "object",
          properties: { threadId: { type: "string" }, prompt: promptProperty },
          required: ["threadId", "prompt"],
        },
        (payload) =>
          decodeFollowUp(payload).pipe(
            Effect.flatMap(({ threadId, prompt }) =>
              service.followUp(parentThreadId, threadId, prompt),
            ),
          ),
      );
    }),
  );

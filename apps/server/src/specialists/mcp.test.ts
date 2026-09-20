import { ProjectId, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import { McpSchema, McpServer } from "effect/unstable/ai";

import { ProjectionSnapshotQuery } from "../orchestration/Services/ProjectionSnapshotQuery.ts";
import { SpecialistService } from "./SpecialistService.ts";
import { specialistToolsLayer } from "./mcp.ts";

const client = McpSchema.McpServerClient.of({
  clientId: 1,
  clientCapabilities: {},
  clientInfo: { name: "specialist-test", version: "1" },
  protocolVersion: "2025-06-18",
  initializePayload: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "specialist-test", version: "1" },
  },
  getClient: Effect.die("unused"),
});

const serviceLayer = Layer.mock(SpecialistService)({
  run: () => Effect.die("catalog tests do not invoke specialists"),
  result: () => Effect.die("catalog tests do not invoke specialists"),
  followUp: () => Effect.die("catalog tests do not invoke specialists"),
});

const shell = (threadId: ThreadId, projectId: ProjectId, cwd: string) => ({
  id: threadId,
  projectId,
  title: String(threadId),
  modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  branch: null,
  worktreePath: cwd,
  latestTurn: null,
  session: null,
  createdAt: "2026-09-20T12:00:00.000Z",
  updatedAt: "2026-09-20T12:00:00.000Z",
  archivedAt: null,
  deletedAt: null,
  settledOverride: null,
  settledAt: null,
  hasPendingApprovals: false,
  hasPendingUserInput: false,
  hasActionableProposedPlan: false,
  pullRequests: [],
  pendingUserInput: null,
  latestUserMessageAt: null,
  pinnedAt: null,
  pinOrderKey: null,
  activeOrderKey: null,
});

const snapshotsLayer = (threadId: ThreadId, projectId: ProjectId, cwd: string) =>
  Layer.mock(ProjectionSnapshotQuery)({
    getThreadShellById: (id) =>
      Effect.succeed(
        id === threadId ? Option.some(shell(threadId, projectId, cwd)) : Option.none(),
      ),
    getProjectShellById: (id) =>
      Effect.succeed(
        id === projectId
          ? Option.some({
              id: projectId,
              title: String(projectId),
              workspaceRoot: cwd,
              defaultModelSelection: null,
              scripts: [],
              createdAt: "2026-09-20T12:00:00.000Z",
              updatedAt: "2026-09-20T12:00:00.000Z",
            })
          : Option.none(),
      ),
  });

const acquireServer = (threadId: ThreadId, projectId: ProjectId, cwd: string) =>
  Effect.service(McpServer.McpServer).pipe(
    Effect.provide(
      specialistToolsLayer(threadId).pipe(
        Layer.provideMerge(McpServer.McpServer.layer),
        Layer.provide(snapshotsLayer(threadId, projectId, cwd)),
        Layer.provide(serviceLayer),
      ),
    ),
  );

it.effect("keeps same-named specialist catalogs isolated between MCP sessions", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const first = yield* fs.makeTempDirectoryScoped({ prefix: "specialist-mcp-first-" });
      const second = yield* fs.makeTempDirectoryScoped({ prefix: "specialist-mcp-second-" });
      for (const [cwd, description] of [
        [first, "First description"],
        [second, "Second description"],
      ] as const) {
        const directory = path.join(cwd, ".agents", "specialists");
        yield* fs.makeDirectory(directory, { recursive: true });
        yield* fs.writeFileString(
          path.join(directory, "reviewer.md"),
          `---\nname: reviewer\ndescription: ${description}\nproviderInstance: codex\nmodel: gpt-5\n---\nReview carefully.`,
        );
      }

      const firstServer = yield* acquireServer(
        ThreadId.make("first"),
        ProjectId.make("first-project"),
        first,
      );
      const secondServer = yield* acquireServer(
        ThreadId.make("second"),
        ProjectId.make("second-project"),
        second,
      );
      const firstTool = firstServer.tools.find(
        ({ tool }) => tool.name === "specialist_reviewer",
      )?.tool;
      const secondTool = secondServer.tools.find(
        ({ tool }) => tool.name === "specialist_reviewer",
      )?.tool;
      assert.include(firstTool?.description, "First description");
      assert.notInclude(firstTool?.description, "Second description");
      assert.include(secondTool?.description, "Second description");
      assert.notInclude(secondTool?.description, "First description");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("does not expose specialist or follow-up tools to a child", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const childId = ThreadId.make("child");
      const server = yield* Effect.service(McpServer.McpServer).pipe(
        Effect.provide(
          specialistToolsLayer(childId).pipe(
            Layer.provideMerge(McpServer.McpServer.layer),
            Layer.provide(
              Layer.mock(ProjectionSnapshotQuery)({
                getThreadShellById: () =>
                  Effect.succeed(
                    Option.some({
                      ...shell(childId, ProjectId.make("project"), "/unused"),
                      specialist: {
                        name: "reviewer",
                        description: "Review code",
                        instructions: "Inspect sources",
                        parentThreadId: ThreadId.make("parent"),
                        parentTurnId: null,
                      },
                    }),
                  ),
              }),
            ),
            Layer.provide(serviceLayer),
          ),
        ),
      );
      assert.deepEqual(server.tools, []);
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

it.effect("exposes an actionable MCP result for malformed specialist configuration", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const fs = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fs.makeTempDirectoryScoped({ prefix: "specialist-mcp-invalid-" });
      const directory = path.join(cwd, ".agents", "specialists");
      yield* fs.makeDirectory(directory, { recursive: true });
      yield* fs.writeFileString(path.join(directory, "broken.md"), "not frontmatter");
      const server = yield* acquireServer(
        ThreadId.make("invalid"),
        ProjectId.make("invalid-project"),
        cwd,
      );
      assert.deepEqual(server.tools.map(({ tool }) => tool.name).toSorted(), [
        "specialist_configuration",
        "specialist_follow_up",
        "specialist_result",
      ]);
      const result = yield* server
        .callTool({ name: "specialist_configuration", arguments: {} })
        .pipe(Effect.provideService(McpSchema.McpServerClient, client));
      assert.isTrue(result.isError);
      const text = result.content.find((entry) => entry.type === "text")?.text;
      assert.include(text, "broken.md");
      assert.include(text, "expected YAML frontmatter");
    }),
  ).pipe(Effect.provide(NodeServices.layer)),
);

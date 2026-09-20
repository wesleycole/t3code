import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";

import { loadSpecialistDefinitions, parseSpecialistDefinition } from "./definitions.ts";

const validDefinition = `---
name: oracle
description: Explores architecture and tests competing designs.
providerInstance: codex-work
model: gpt-5.4
reasoningEffort: high
---
Trace the implementation before recommending changes.

Preserve Unicode and Markdown: naïve → careful; 你好.
`;

describe("parseSpecialistDefinition", () => {
  it.effect("keeps definition metadata separate from multiline task instructions", () =>
    Effect.gen(function* () {
      const definition = yield* parseSpecialistDefinition("/project/oracle.md", validDefinition);

      assert.strictEqual(definition.name, "oracle");
      assert.strictEqual(
        definition.description,
        "Explores architecture and tests competing designs.",
      );
      assert.strictEqual(
        definition.instructions,
        "Trace the implementation before recommending changes.\n\nPreserve Unicode and Markdown: naïve → careful; 你好.\n",
      );
      assert.strictEqual(definition.modelSelection.instanceId, "codex-work");
      assert.strictEqual(definition.modelSelection.model, "gpt-5.4");
      assert.deepStrictEqual(definition.modelSelection.options, [
        { id: "reasoningEffort", value: "high" },
      ]);
    }),
  );

  it.effect("omits model options when reasoning effort is absent", () =>
    Effect.gen(function* () {
      const definition = yield* parseSpecialistDefinition(
        "minimal.md",
        `---
name: research_2
description: Finds primary sources.
providerInstance: claude
model: sonnet
---
Use the supplied assignment, not this definition, as the task.
`,
      );

      assert.strictEqual(definition.modelSelection.instanceId, "claude");
      assert.strictEqual(definition.modelSelection.model, "sonnet");
      assert.isUndefined(definition.modelSelection.options);
    }),
  );

  for (const [label, contents] of [
    ["malformed YAML", "---\nname: [unterminated\n---\ninstructions"],
    ["missing fields", "---\nname: oracle\n---\ninstructions"],
    ["reserved tool name", validDefinition.replace("name: oracle", "name: result")],
    ["overlong tool name", validDefinition.replace("name: oracle", `name: ${"x".repeat(54)}`)],
    ["empty role", validDefinition.slice(0, validDefinition.indexOf("Trace")) + " \n\t"],
    [
      "unsafe tool name",
      "---\nname: bad.name\ndescription: no\nproviderInstance: codex\nmodel: model\n---\ninstructions",
    ],
  ] as const) {
    it.effect(`returns a file-specific error for ${label}`, () =>
      Effect.gen(function* () {
        const error = yield* Effect.flip(
          parseSpecialistDefinition("/repo/.agents/specialists/bad.md", contents),
        );

        assert.strictEqual(error._tag, "SpecialistDefinitionError");
        assert.strictEqual(error.reason, "invalid-definition");
        assert.strictEqual(error.filePath, "/repo/.agents/specialists/bad.md");
        assert.match(error.message, /bad\.md/);
      }),
    );
  }
});

it.layer(NodeServices.layer)("loadSpecialistDefinitions", (it) => {
  it.effect("returns an empty array when the specialists directory is missing", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-specialists-missing-" });

      assert.deepStrictEqual(yield* loadSpecialistDefinitions(cwd), []);
    }),
  );

  it.effect("loads Markdown files from a real project directory in filename order", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({ prefix: "t3-specialists-load-" });
      const directory = path.join(cwd, ".agents", "specialists");
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      yield* fileSystem.writeFileString(
        path.join(directory, "b.md"),
        validDefinition.replace("name: oracle", "name: second"),
      );
      yield* fileSystem.writeFileString(
        path.join(directory, "a.md"),
        validDefinition.replace("name: oracle", "name: first"),
      );
      yield* fileSystem.writeFileString(path.join(directory, "ignored.txt"), "not markdown");

      const loaded = yield* loadSpecialistDefinitions(cwd);

      assert.deepStrictEqual(
        loaded.map(({ name }) => name),
        ["first", "second"],
      );
    }),
  );

  it.effect("fails with both file paths when names are duplicated", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const cwd = yield* fileSystem.makeTempDirectoryScoped({
        prefix: "t3-specialists-duplicate-",
      });
      const directory = path.join(cwd, ".agents", "specialists");
      yield* fileSystem.makeDirectory(directory, { recursive: true });
      yield* fileSystem.writeFileString(path.join(directory, "first.md"), validDefinition);
      yield* fileSystem.writeFileString(path.join(directory, "second.md"), validDefinition);

      const error = yield* Effect.flip(loadSpecialistDefinitions(cwd));

      assert.strictEqual(error.reason, "duplicate-name");
      assert.match(error.message, /second\.md/);
      assert.match(error.message, /first\.md/);
      assert.match(error.message, /oracle/);
    }),
  );
});

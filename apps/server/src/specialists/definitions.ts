import { ModelSelection, TrimmedNonEmptyString } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { parse as parseYaml } from "yaml";

const FRONTMATTER_PATTERN = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/;
const SAFE_TOOL_SUFFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

const SpecialistName = Schema.String.check(
  Schema.isMaxLength(53),
  Schema.isPattern(SAFE_TOOL_SUFFIX_PATTERN, {
    message: "name must contain only letters, numbers, underscores, or hyphens",
  }),
  Schema.isPattern(/^(?!(?:result|follow_up|configuration)$)/, {
    message: "result, follow_up, and configuration are reserved specialist tool names",
  }),
);

const SpecialistFrontmatter = Schema.Struct({
  name: SpecialistName,
  description: TrimmedNonEmptyString,
  providerInstance: Schema.NonEmptyString,
  model: Schema.NonEmptyString,
  reasoningEffort: Schema.optionalKey(Schema.NonEmptyString),
});

/** A parsed project-local specialist definition. */
export const SpecialistDefinition = Schema.Struct({
  name: SpecialistName,
  description: TrimmedNonEmptyString,
  instructions: Schema.String.check(Schema.isPattern(/\S/)),
  modelSelection: ModelSelection,
});

/** The value represented by {@link SpecialistDefinition}. */
export type SpecialistDefinition = typeof SpecialistDefinition.Type;

const decodeFrontmatter = Schema.decodeUnknownEffect(SpecialistFrontmatter);
const decodeModelSelection = Schema.decodeEffect(ModelSelection);
const decodeDefinition = Schema.decodeEffect(SpecialistDefinition);

/** A file-specific failure while reading or parsing specialist definitions. */
export class SpecialistDefinitionError extends Schema.TaggedError<SpecialistDefinitionError>()(
  "SpecialistDefinitionError",
  {
    reason: Schema.Literals([
      "read-directory",
      "read-file",
      "invalid-definition",
      "duplicate-name",
    ]),
    filePath: Schema.String,
    detail: Schema.String,
  },
) {
  override get message(): string {
    return `Specialist definition error in ${this.filePath}: ${this.detail}`;
  }
}

const failInvalid = (filePath: string, detail: string) =>
  Effect.fail(new SpecialistDefinitionError({ reason: "invalid-definition", filePath, detail }));

/**
 * Parses one Markdown specialist definition, retaining its instruction body verbatim.
 *
 * @param filePath - Path used to identify errors.
 * @param contents - Markdown with YAML frontmatter.
 * @returns The parsed definition or a file-specific typed error.
 */
export const parseSpecialistDefinition = Effect.fn("parseSpecialistDefinition")(function* (
  filePath: string,
  contents: string,
) {
  const match = FRONTMATTER_PATTERN.exec(contents);
  if (match === null) {
    return yield* failInvalid(filePath, "expected YAML frontmatter delimited by '---'");
  }

  const yaml = match[1] ?? "";
  const instructions = match[2] ?? "";
  const rawFrontmatter = yield* Effect.try({
    try: (): unknown => parseYaml(yaml),
    catch: (cause) =>
      new SpecialistDefinitionError({
        reason: "invalid-definition",
        filePath,
        detail: `invalid YAML: ${cause instanceof Error ? cause.message : String(cause)}`,
      }),
  });

  const frontmatter = yield* decodeFrontmatter(rawFrontmatter).pipe(
    Effect.mapError(
      (cause) =>
        new SpecialistDefinitionError({
          reason: "invalid-definition",
          filePath,
          detail: `invalid frontmatter: ${String(cause)}`,
        }),
    ),
  );

  const modelSelection = yield* decodeModelSelection({
    instanceId: frontmatter.providerInstance,
    model: frontmatter.model,
    ...(frontmatter.reasoningEffort === undefined
      ? {}
      : { options: [{ id: "reasoningEffort", value: frontmatter.reasoningEffort }] }),
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SpecialistDefinitionError({
          reason: "invalid-definition",
          filePath,
          detail: `invalid model selection: ${String(cause)}`,
        }),
    ),
  );

  return yield* decodeDefinition({
    name: frontmatter.name,
    description: frontmatter.description,
    instructions,
    modelSelection,
  }).pipe(
    Effect.mapError(
      (cause) =>
        new SpecialistDefinitionError({
          reason: "invalid-definition",
          filePath,
          detail: `invalid definition: ${String(cause)}`,
        }),
    ),
  );
});

/**
 * Loads all `.md` specialist definitions from `<cwd>/.agents/specialists`.
 *
 * @param cwd - Project working directory.
 * @returns Definitions sorted by filename, an empty array when the directory is absent, or a typed error.
 */
export const loadSpecialistDefinitions = Effect.fn("loadSpecialistDefinitions")(function* (
  cwd: string,
) {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const directory = path.join(cwd, ".agents", "specialists");
  const entries = yield* fileSystem.readDirectory(directory).pipe(
    Effect.catchTag("PlatformError", (cause) =>
      cause.reason._tag === "NotFound"
        ? Effect.succeed<ReadonlyArray<string>>([])
        : Effect.fail(
            new SpecialistDefinitionError({
              reason: "read-directory",
              filePath: directory,
              detail: String(cause),
            }),
          ),
    ),
  );

  const definitions: Array<{
    readonly definition: SpecialistDefinition;
    readonly filePath: string;
  }> = [];
  for (const entry of entries.filter((name) => name.endsWith(".md")).toSorted()) {
    const filePath = path.join(directory, entry);
    const contents = yield* fileSystem.readFileString(filePath).pipe(
      Effect.mapError(
        (cause) =>
          new SpecialistDefinitionError({
            reason: "read-file",
            filePath,
            detail: String(cause),
          }),
      ),
    );
    definitions.push({
      definition: yield* parseSpecialistDefinition(filePath, contents),
      filePath,
    });
  }

  const names = new Map<string, string>();
  for (const item of definitions) {
    const existing = names.get(item.definition.name);
    if (existing !== undefined) {
      return yield* new SpecialistDefinitionError({
        reason: "duplicate-name",
        filePath: item.filePath,
        detail: `duplicate name '${item.definition.name}' (already defined in ${existing})`,
      });
    }
    names.set(item.definition.name, item.filePath);
  }
  return definitions.map(({ definition }) => definition);
});

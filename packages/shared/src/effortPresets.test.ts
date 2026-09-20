import {
  ProviderInstanceId,
  type EffortPresets,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { resolveEffortPreset, sameEffortSelection } from "./effortPresets.ts";

const presets: EffortPresets = {
  low: {
    instanceId: ProviderInstanceId.make("codex"),
    model: "sol",
    options: [{ id: "reasoningEffort", value: "low" }],
  },
  medium: { instanceId: ProviderInstanceId.make("codex"), model: "astra" },
  high: {
    instanceId: ProviderInstanceId.make("claudeAgent"),
    model: "fable",
    options: [{ id: "thinking", value: true }],
  },
  ultra: { instanceId: ProviderInstanceId.make("codex"), model: "astra" },
};

function provider(
  instanceId: string,
  models: ServerProvider["models"],
): Pick<
  ServerProvider,
  "instanceId" | "enabled" | "installed" | "availability" | "status" | "models"
> {
  return {
    instanceId: ProviderInstanceId.make(instanceId),
    enabled: true,
    installed: true,
    availability: "available",
    status: "ready",
    models,
  };
}

const providers = [
  provider("codex", [
    {
      slug: "sol",
      name: "Sol",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [
              { id: "low", label: "Low" },
              { id: "medium", label: "Medium", isDefault: true },
              { id: "secret", label: "Secret" },
            ],
            promptInjectedValues: ["secret"],
          },
        ],
      },
    },
    {
      slug: "astra",
      name: "Astra",
      isCustom: false,
      capabilities: {
        optionDescriptors: [
          {
            id: "reasoningEffort",
            label: "Reasoning",
            type: "select",
            options: [{ id: "medium", label: "Medium", isDefault: true }],
          },
        ],
      },
    },
  ]),
  provider("claudeAgent", [
    {
      slug: "fable",
      name: "Fable",
      isCustom: false,
      capabilities: {
        optionDescriptors: [{ id: "thinking", label: "Thinking", type: "boolean" }],
      },
    },
  ]),
];

describe("resolveEffortPreset", () => {
  it("resolves asymmetric provider choices and preserves explicit values", () => {
    expect(resolveEffortPreset(presets, "low", providers)).toEqual({
      _tag: "Available",
      modelName: "Sol",
      selection: {
        instanceId: ProviderInstanceId.make("codex"),
        model: "sol",
        options: [{ id: "reasoningEffort", value: "low" }],
        effortPreset: "low",
      },
    });
    expect(resolveEffortPreset(presets, "high", providers)).toMatchObject({
      _tag: "Available",
      selection: {
        instanceId: ProviderInstanceId.make("claudeAgent"),
        model: "fable",
        options: [{ id: "thinking", value: true }],
        effortPreset: "high",
      },
    });
    expect(resolveEffortPreset(presets, "medium", providers)).toMatchObject({
      _tag: "Available",
      selection: { options: [{ id: "reasoningEffort", value: "medium" }] },
    });
  });

  it("does not fall back when the configured provider or model is unavailable", () => {
    expect(resolveEffortPreset(presets, "low", [])._tag).toBe("Unavailable");
    expect(
      resolveEffortPreset(
        { ...presets, low: { ...presets.low, model: "missing" } },
        "low",
        providers,
      )._tag,
    ).toBe("Unavailable");
  });

  it.each([
    { options: [{ id: "unknown", value: "low" }] },
    { options: [{ id: "reasoningEffort", value: "secret" }] },
    {
      options: [
        { id: "reasoningEffort", value: "low" },
        { id: "reasoningEffort", value: "medium" },
      ],
    },
  ])("rejects unsupported, prompt-injected, and duplicate options", ({ options }) => {
    const configured = { ...presets, low: { ...presets.low, options } };
    expect(resolveEffortPreset(configured, "low", providers)._tag).toBe("Unavailable");
  });
});

describe("sameEffortSelection", () => {
  const selection: ModelSelection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "sol",
    effortPreset: "low",
    options: [
      { id: "reasoningEffort", value: "low" },
      { id: "fast", value: false },
    ],
  };

  it("ignores option order while preserving marker and option values", () => {
    expect(
      sameEffortSelection(selection, {
        ...selection,
        options: [...(selection.options ?? [])].reverse(),
      }),
    ).toBe(true);
    expect(sameEffortSelection(selection, { ...selection, effortPreset: "medium" })).toBe(false);
    expect(
      sameEffortSelection(selection, {
        ...selection,
        options: [
          { id: "reasoningEffort", value: "medium" },
          { id: "fast", value: false },
        ],
      }),
    ).toBe(false);
  });
});

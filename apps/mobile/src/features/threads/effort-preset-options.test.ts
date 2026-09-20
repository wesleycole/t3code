import { ProviderInstanceId, type EffortPresets } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { buildEffortPresetOptions } from "./effort-preset-options";

const presets: EffortPresets = {
  low: { instanceId: ProviderInstanceId.make("codex"), model: "fast" },
  medium: { instanceId: ProviderInstanceId.make("codex"), model: "balanced" },
  high: { instanceId: ProviderInstanceId.make("claude"), model: "deep" },
  ultra: { instanceId: ProviderInstanceId.make("missing"), model: "max" },
};

const providers = [
  {
    instanceId: ProviderInstanceId.make("codex"),
    enabled: true,
    installed: true,
    availability: "available",
    status: "ready",
    models: [
      { slug: "fast", name: "Fast", capabilities: {}, isCustom: false },
      { slug: "balanced", name: "Balanced", capabilities: {}, isCustom: false },
    ],
  },
] as const;

describe("mobile effort preset options", () => {
  it("keeps unavailable mappings visible and never falls back", () => {
    const options = buildEffortPresetOptions(presets, providers);

    expect(options.map((option) => option.preset)).toEqual(["low", "medium", "high", "ultra"]);
    expect(options[0]).toMatchObject({ detail: "Fast", unavailableReason: null });
    expect(options[2]?.selection).toBeNull();
    expect(options[2]?.unavailableReason).toContain("claude");
    expect(options[3]?.selection).toBeNull();
  });

  it("re-resolves an edited mapping while retaining the chosen dial position", () => {
    const options = buildEffortPresetOptions(presets, providers);
    const updated = buildEffortPresetOptions({ ...presets, medium: presets.low }, providers);
    expect(options[1]?.selection).toMatchObject({ effortPreset: "medium", model: "balanced" });
    expect(updated[1]?.selection).toMatchObject({ effortPreset: "medium", model: "fast" });
  });
});

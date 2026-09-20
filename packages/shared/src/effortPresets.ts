import type {
  EffortPreset,
  EffortPresets,
  ModelSelection,
  ServerProvider,
} from "@t3tools/contracts";

import {
  buildProviderOptionSelectionsFromDescriptors,
  createModelSelection,
  getProviderOptionDescriptors,
} from "./model.ts";

/** A preset is either runnable as shown, or unavailable with an actionable reason. */
export type EffortPresetResolution =
  | { readonly _tag: "Available"; readonly selection: ModelSelection; readonly modelName: string }
  | { readonly _tag: "Unavailable"; readonly reason: string };

/** Resolve a preset without fallback, capturing the model's advertised option defaults. */
export function resolveEffortPreset(
  presets: EffortPresets,
  preset: EffortPreset,
  providers: ReadonlyArray<
    Pick<
      ServerProvider,
      "instanceId" | "enabled" | "installed" | "availability" | "status" | "models"
    >
  >,
): EffortPresetResolution {
  const configured = presets[preset];
  const provider = providers.find((entry) => entry.instanceId === configured.instanceId);
  if (
    !provider?.enabled ||
    !provider.installed ||
    provider.availability === "unavailable" ||
    provider.status !== "ready"
  ) {
    return {
      _tag: "Unavailable",
      reason: `Configure or connect ${configured.instanceId} in provider settings to use this effort.`,
    };
  }
  const model = provider.models.find((entry) => entry.slug === configured.model);
  if (!model) {
    return {
      _tag: "Unavailable",
      reason: `${configured.model} is unavailable. Choose another model for this effort in Settings.`,
    };
  }
  const caps = model.capabilities ?? {};
  const seen = new Set<string>();
  for (const option of configured.options ?? []) {
    const descriptor = caps.optionDescriptors?.find((entry) => entry.id === option.id);
    if (
      seen.has(option.id) ||
      !descriptor ||
      (descriptor.type === "boolean"
        ? typeof option.value !== "boolean"
        : typeof option.value !== "string" ||
          !descriptor.options.some((entry) => entry.id === option.value) ||
          descriptor.promptInjectedValues?.includes(option.value))
    ) {
      return {
        _tag: "Unavailable",
        reason: `${model.name} does not support the configured ${option.id}. Update this effort in Settings.`,
      };
    }
    seen.add(option.id);
  }
  const options = buildProviderOptionSelectionsFromDescriptors(
    getProviderOptionDescriptors({ caps, selections: configured.options }),
  );
  return {
    _tag: "Available",
    modelName: model.name,
    selection: {
      ...createModelSelection(configured.instanceId, configured.model, options),
      effortPreset: preset,
    },
  };
}

/** Compare saved choices independently of option ordering, including their preset identity. */
export function sameEffortSelection(left: ModelSelection, right: ModelSelection): boolean {
  const leftOptions = left.options ?? [];
  const rightOptions = right.options ?? [];
  return (
    left.instanceId === right.instanceId &&
    left.model === right.model &&
    left.effortPreset === right.effortPreset &&
    leftOptions.length === rightOptions.length &&
    new Set(rightOptions.map((option) => option.id)).size === rightOptions.length &&
    new Set(leftOptions.map((option) => option.id)).size === leftOptions.length &&
    leftOptions.every((option) =>
      rightOptions.some(
        (candidate) => candidate.id === option.id && candidate.value === option.value,
      ),
    )
  );
}

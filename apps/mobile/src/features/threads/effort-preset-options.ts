import {
  EFFORT_PRESET_LABELS,
  EFFORT_PRESETS,
  type EffortPreset,
  type EffortPresets,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveEffortPreset } from "@t3tools/shared/effortPresets";

/** A mobile effort choice together with its fixed model snapshot, when runnable. */
export type EffortPresetOption = {
  readonly preset: EffortPreset;
  readonly label: string;
  readonly selection: ModelSelection | null;
  readonly detail: string;
  readonly unavailableReason: string | null;
};

/** Resolve all four environment-owned choices without substituting another model. */
export function buildEffortPresetOptions(
  presets: EffortPresets,
  providers: ReadonlyArray<
    Pick<
      ServerProvider,
      "instanceId" | "enabled" | "installed" | "availability" | "status" | "models"
    >
  >,
): ReadonlyArray<EffortPresetOption> {
  return EFFORT_PRESETS.map((preset) => {
    const resolution = resolveEffortPreset(presets, preset, providers);
    return resolution._tag === "Available"
      ? {
          preset,
          label: EFFORT_PRESET_LABELS[preset],
          selection: resolution.selection,
          detail: resolution.modelName,
          unavailableReason: null,
        }
      : {
          preset,
          label: EFFORT_PRESET_LABELS[preset],
          selection: null,
          detail: resolution.reason,
          unavailableReason: resolution.reason,
        };
  });
}

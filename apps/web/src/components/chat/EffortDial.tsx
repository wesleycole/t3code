import {
  EFFORT_PRESETS,
  EFFORT_PRESET_LABELS,
  type EffortPreset,
  type EffortPresets,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveEffortPreset } from "@t3tools/shared/effortPresets";
import { getProviderOptionCurrentLabel, getProviderOptionDescriptors } from "@t3tools/shared/model";
import { GaugeIcon, LockKeyholeIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useComposerMenuProps } from "./composerEventScope";
import { cn } from "../../lib/utils";
import styles from "./EffortDial.module.css";

/** New-conversation effort selector; saved conversations expose only their frozen selection. */
export function EffortDial({
  preset,
  presets,
  providers,
  lockedSelection,
  disabled,
  open,
  onOpenChange,
  onChange,
}: {
  preset: EffortPreset;
  presets: EffortPresets;
  providers: ReadonlyArray<ServerProvider>;
  lockedSelection: ModelSelection | null;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (preset: EffortPreset) => void;
}) {
  const composerFloatingLayerProps = useComposerMenuProps();
  const specialistSelections = Object.entries(
    (lockedSelection ? lockedSelection.specialistModels : presets[preset].specialistModels) ?? {},
  );
  const specialistSummary =
    specialistSelections.length > 0 ? (
      <ul aria-label="Specialist models" className="max-h-32 space-y-1 overflow-y-auto text-xs">
        {specialistSelections.map(([name, selection]) => (
          <li key={name} className="flex flex-wrap justify-between gap-x-3 gap-y-0.5">
            <span className="capitalize">{name}</span>
            <span className="text-muted-foreground wrap-anywhere">
              {selection.model}
              {selection.options?.length
                ? ` · ${selection.options.map((option) => String(option.value)).join(", ")}`
                : ""}
            </span>
          </li>
        ))}
      </ul>
    ) : null;
  if (lockedSelection) {
    return (
      <Tooltip>
        <TooltipTrigger
          render={<span tabIndex={0} />}
          className="inline-flex min-w-0 items-center gap-1.5 px-2 text-xs text-muted-foreground"
          data-testid="locked-effort"
        >
          <LockKeyholeIcon className="size-3.5 shrink-0" />
          <span className="truncate">
            {lockedSelection.effortPreset
              ? `${EFFORT_PRESET_LABELS[lockedSelection.effortPreset]} · ${lockedSelection.model}`
              : lockedSelection.model}
          </span>
        </TooltipTrigger>
        <TooltipPopup className="max-w-sm space-y-2">
          <p>Fixed for this conversation. Start a new conversation to change effort.</p>
          {specialistSummary}
        </TooltipPopup>
      </Tooltip>
    );
  }

  const index = EFFORT_PRESETS.indexOf(preset);
  const resolution = resolveEffortPreset(presets, preset, providers);
  const configured = presets[preset];
  const model = providers
    .find((provider) => provider.instanceId === configured.instanceId)
    ?.models.find((entry) => entry.slug === configured.model);
  const options = getProviderOptionDescriptors({
    caps: model?.capabilities ?? {},
    selections: resolution._tag === "Available" ? resolution.selection.options : configured.options,
  }).flatMap((descriptor) => {
    const value = getProviderOptionCurrentLabel(descriptor);
    return value ? [{ id: descriptor.id, label: descriptor.label, value }] : [];
  });
  const chooseIndex = (next: number) => {
    const choice = EFFORT_PRESETS[Math.max(0, Math.min(3, next))];
    if (choice) onChange(choice);
  };
  const turnDial = (event: PointerEvent<HTMLDivElement>) => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const angle =
      (Math.atan2(
        event.clientX - bounds.left - bounds.width / 2,
        bounds.top + bounds.height / 2 - event.clientY,
      ) *
        180) /
      Math.PI;
    chooseIndex(Math.round((angle + 120) / 80));
  };

  return (
    <Popover open={open && !disabled} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="ghost" size="sm" disabled={disabled} />}
        aria-label={`Effort: ${EFFORT_PRESET_LABELS[preset]}`}
        className="w-24 shrink-0 justify-center gap-1.5 [&_svg]:mx-0"
      >
        <GaugeIcon className="size-4" />
        {EFFORT_PRESET_LABELS[preset]}
      </PopoverTrigger>
      <PopoverPopup
        {...composerFloatingLayerProps}
        side="top"
        align="start"
        className="w-[560px] max-w-[calc(100vw-2rem)] bg-popover!"
        viewportClassName="p-3"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-1">
          <span className="text-sm font-medium">Conversation effort</span>
          <span className="text-xs text-muted-foreground">Locks on first send</span>
        </div>
        <div className={styles.console}>
          {[0, 1, 2, 3].map((screw) => (
            <span key={screw} className={styles.screw} aria-hidden="true" />
          ))}
          <div className={styles.controls}>
            <div className={styles.dial}>
              <svg viewBox="0 0 252 248" className={styles.scale} aria-hidden="true">
                {Array.from({ length: 25 }, (_, tick) => (
                  <line
                    key={tick}
                    x1="126"
                    y1="38"
                    x2="126"
                    y2={tick % 8 === 0 ? "49" : "44"}
                    transform={`rotate(${-120 + tick * 10} 126 132)`}
                    strokeWidth={tick % 8 === 0 ? 3 : 1.5}
                    strokeLinecap="round"
                    className={cn(styles.tick, tick <= index * 8 && styles.tickActive)}
                  />
                ))}
              </svg>
              {EFFORT_PRESETS.map((level, position) => {
                const angle = ((-120 + position * 80) * Math.PI) / 180;
                return (
                  <button
                    key={level}
                    type="button"
                    tabIndex={-1}
                    aria-label={`Set ${EFFORT_PRESET_LABELS[level]} effort`}
                    aria-pressed={level === preset}
                    className={styles.dialLabel}
                    style={{
                      left: `${126 + Math.sin(angle) * 111}px`,
                      top: `${124 - Math.cos(angle) * 111}px`,
                    }}
                    onClick={() => onChange(level)}
                  >
                    {level === "medium" ? "Med" : level}
                    <span className={styles.led} aria-hidden="true" />
                  </button>
                );
              })}
              <div
                role="slider"
                aria-label="Conversation effort"
                aria-valuemin={0}
                aria-valuemax={3}
                aria-valuenow={index}
                aria-valuetext={EFFORT_PRESET_LABELS[preset]}
                tabIndex={0}
                className={styles.knob}
                onPointerDown={(event) => {
                  event.currentTarget.focus();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  turnDial(event);
                }}
                onPointerMove={(event) => {
                  if (event.currentTarget.hasPointerCapture(event.pointerId)) turnDial(event);
                }}
                onPointerUp={(event) => event.currentTarget.releasePointerCapture(event.pointerId)}
                onKeyDown={(event) => {
                  if (
                    !["ArrowLeft", "ArrowDown", "ArrowRight", "ArrowUp", "Home", "End"].includes(
                      event.key,
                    )
                  )
                    return;
                  event.preventDefault();
                  chooseIndex(
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? 3
                        : index + (["ArrowLeft", "ArrowDown"].includes(event.key) ? -1 : 1),
                  );
                }}
              >
                <div className={styles.grip} aria-hidden="true">
                  <div className={styles.face} />
                  <div
                    className={styles.needle}
                    style={{ transform: `rotate(${-120 + index * 80}deg)` }}
                  />
                </div>
              </div>
            </div>
            <div
              className={styles.readout}
              data-unavailable={resolution._tag === "Unavailable" || undefined}
              aria-live="polite"
            >
              <div className={styles.bezel}>
                <dl className={styles.screen}>
                  <div className={styles.model}>
                    <dt>Agent</dt>
                    <dd>
                      {resolution._tag === "Available" ? resolution.modelName : configured.model}
                    </dd>
                  </div>
                  {options.length > 0 ? (
                    options.map((option) => (
                      <div key={option.id} className={styles.option}>
                        <dt>{option.label}</dt>
                        <dd>{option.value}</dd>
                      </div>
                    ))
                  ) : (
                    <div className={styles.option}>
                      <dt>Options</dt>
                      <dd>Provider defaults</dd>
                    </div>
                  )}
                  <div className={styles.provider}>
                    <dt>Provider</dt>
                    <dd>{configured.instanceId}</dd>
                  </div>
                </dl>
              </div>
              <div className={styles.status}>
                <span className={styles.led} aria-hidden="true" />
                {resolution._tag === "Available" ? "Preset ready" : "Setup required"}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-4 gap-1" role="group" aria-label="Effort presets">
          {EFFORT_PRESETS.map((level) => (
            <Button
              key={level}
              size="sm"
              variant={level === preset ? "secondary" : "ghost"}
              aria-pressed={level === preset}
              onClick={() => onChange(level)}
              className={cn("px-1", level === preset && "text-primary")}
            >
              {EFFORT_PRESET_LABELS[level]}
            </Button>
          ))}
        </div>
        <div className="mt-3 border-t px-1 pt-3" aria-live="polite">
          {specialistSummary}
          <p className="mt-2 text-xs wrap-anywhere text-muted-foreground">
            {resolution._tag === "Unavailable"
              ? resolution.reason
              : "Configure presets in Settings → General."}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

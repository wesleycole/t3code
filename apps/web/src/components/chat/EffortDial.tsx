import {
  EFFORT_PRESETS,
  EFFORT_PRESET_LABELS,
  type EffortPreset,
  type EffortPresets,
  type ModelSelection,
  type ServerProvider,
} from "@t3tools/contracts";
import { resolveEffortPreset } from "@t3tools/shared/effortPresets";
import { GaugeIcon, LockKeyholeIcon } from "lucide-react";
import type { PointerEvent } from "react";

import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import { useComposerMenuProps } from "./composerEventScope";
import { cn } from "../../lib/utils";

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
        <TooltipPopup>
          Fixed for this conversation. Start a new conversation to change effort.
        </TooltipPopup>
      </Tooltip>
    );
  }

  const index = EFFORT_PRESETS.indexOf(preset);
  const resolution = resolveEffortPreset(presets, preset, providers);
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
        className="shrink-0 gap-1.5"
      >
        <GaugeIcon className="size-4" />
        {EFFORT_PRESET_LABELS[preset]}
      </PopoverTrigger>
      <PopoverPopup
        {...composerFloatingLayerProps}
        side="top"
        align="start"
        className="w-80 max-w-[calc(100vw-2rem)] bg-popover!"
      >
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium">Conversation effort</span>
          <span className="text-xs text-muted-foreground">Locks on first send</span>
        </div>
        <div className="relative mx-auto my-5 size-36">
          <svg
            viewBox="0 0 144 144"
            className="pointer-events-none absolute inset-0 size-full"
            aria-hidden="true"
          >
            {EFFORT_PRESETS.map((level, position) => (
              <line
                key={level}
                x1="72"
                y1="4"
                x2="72"
                y2="13"
                transform={`rotate(${-120 + position * 80} 72 72)`}
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                className={position <= index ? "text-primary" : "text-muted-foreground/35"}
              />
            ))}
          </svg>
          <div
            role="slider"
            aria-label="Conversation effort"
            aria-valuemin={0}
            aria-valuemax={3}
            aria-valuenow={index}
            aria-valuetext={EFFORT_PRESET_LABELS[preset]}
            tabIndex={0}
            className="absolute inset-5 touch-none cursor-grab rounded-full border border-border bg-muted shadow-[0_4px_8px_rgb(0_0_0/12%)] outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
            onPointerDown={(event) => {
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
            <div
              className="pointer-events-none absolute inset-2"
              style={{ transform: `rotate(${-120 + index * 80}deg)` }}
            >
              <span className="absolute top-0 left-1/2 h-6 w-1 -translate-x-1/2 rounded-full bg-primary" />
            </div>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-1" role="group" aria-label="Effort presets">
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
        <div className="mt-4 border-t pt-3" aria-live="polite">
          <p className="text-sm font-medium">
            {resolution._tag === "Available" ? resolution.modelName : presets[preset].model}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {resolution._tag === "Unavailable"
              ? resolution.reason
              : `${presets[preset].instanceId} · Configure presets in Settings → General.`}
          </p>
        </div>
      </PopoverPopup>
    </Popover>
  );
}

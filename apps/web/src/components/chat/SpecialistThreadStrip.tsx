import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { ArrowUpRightIcon, BotIcon } from "lucide-react";
import { resolveThreadStatusPill } from "../Sidebar.logic";
import { ThreadStatusLabel } from "../ThreadStatusIndicators";

interface SpecialistThreadStripProps {
  readonly thread: EnvironmentThreadShell;
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly onOpenThread: (thread: EnvironmentThreadShell) => void;
}

/** Shows the current thread's specialist relationship without promoting children into navigation. */
export function SpecialistThreadStrip({
  thread,
  threads,
  onOpenThread,
}: SpecialistThreadStripProps) {
  const specialist = thread.specialist;
  const parent = specialist
    ? threads.find(
        (candidate) =>
          candidate.environmentId === thread.environmentId &&
          candidate.id === specialist.parentThreadId,
      )
    : null;
  const children = specialist
    ? []
    : threads.filter(
        (candidate) =>
          candidate.environmentId === thread.environmentId &&
          candidate.specialist?.parentThreadId === thread.id,
      );

  if (!specialist && children.length === 0) return null;

  return (
    <div className="border-b border-border/60 bg-muted/25 px-3 py-1.5 text-xs text-muted-foreground">
      {specialist ? (
        <div className="mx-auto flex max-w-4xl min-w-0 items-center gap-2">
          <BotIcon className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="shrink-0 font-medium text-foreground">{specialist.name}</span>
          {parent ? (
            <button
              type="button"
              className="flex min-w-0 items-center gap-1 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onOpenThread(parent)}
            >
              <span className="truncate">Parent: {parent.title}</span>
              <ArrowUpRightIcon className="size-3 shrink-0" aria-hidden="true" />
            </button>
          ) : (
            <span className="truncate">Parent conversation unavailable</span>
          )}
        </div>
      ) : (
        <div className="mx-auto flex max-w-4xl items-center gap-2 overflow-x-auto">
          <span className="shrink-0 font-medium text-foreground">Specialists</span>
          {children.map((child) => {
            const status = resolveThreadStatusPill({ thread: child });
            return (
              <button
                key={child.id}
                type="button"
                className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onOpenThread(child)}
              >
                <span className="max-w-44 truncate">{child.title}</span>
                <span className="max-w-32 truncate text-[10px] opacity-70">
                  {child.modelSelection.model}
                </span>
                {status ? <ThreadStatusLabel status={status} compact /> : null}
                <ArrowUpRightIcon className="size-3" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

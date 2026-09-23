import { scopeProjectRef, scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ProviderInstanceId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { createModelSelection } from "@t3tools/shared/model";
import { useNavigate } from "@tanstack/react-router";
import {
  ArchiveIcon,
  ArrowUpIcon,
  MessagesSquareIcon,
  PlusIcon,
  SearchIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { useComposerDraftStore } from "../composerDraftStore";
import { useNewThreadHandler } from "../hooks/useHandleNewThread";
import { useThreadActions } from "../hooks/useThreadActions";
import { useHoidDialogStore } from "../hoidDialogStore";
import { buildThreadRouteParams } from "../threadRoutes";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useThreadShells,
} from "../state/entities";
import { sortScopedProjectsForSidebar } from "./Sidebar.logic";
import { Button } from "./ui/button";
import { Dialog, DialogClose, DialogDescription, DialogPopup, DialogTitle } from "./ui/dialog";
import { Textarea } from "./ui/textarea";
import { toastManager } from "./ui/toast";
import { Tooltip, TooltipPopup, TooltipTrigger } from "./ui/tooltip";

const HOID_THREAD_KEY_PREFIX = "t3-code:meta-agent-thread:";
const HOID_MODEL = createModelSelection(ProviderInstanceId.make("codex"), "gpt-5.6-sol");
const STARTERS = [
  {
    icon: SearchIcon,
    label: "Find prior work",
    prompt:
      "Search my conversations, including archived ones, for the most relevant prior work on this topic. Show linked sources and quote only the excerpts that support your answer.",
  },
  {
    icon: MessagesSquareIcon,
    label: "Check delegated work",
    prompt:
      "Find conversations with unfinished or recently completed work. Summarize their current status with links, and do not claim an outcome until you have read the relevant conversation.",
  },
  {
    icon: ArchiveIcon,
    label: "Review archived conversations",
    prompt:
      "Search archived conversations for reusable decisions or implementation details. Return a concise list with project names, updated dates, excerpts, and links.",
  },
] as const;

export function HoidDialog() {
  const open = useHoidDialogStore((state) => state.open);
  const setOpen = useHoidDialogStore((state) => state.setOpen);
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useThreadShells();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const { archiveThread } = useThreadActions();
  const [prompt, setPrompt] = useState("");
  const [starting, setStarting] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [detachedThreadId, setDetachedThreadId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetProject = useMemo(
    () => sortScopedProjectsForSidebar(projects, threads, "updated_at")[0] ?? null,
    [projects, threads],
  );
  const existingThread = useMemo(() => {
    if (typeof window === "undefined") return null;
    for (const thread of threads) {
      if (thread.id === detachedThreadId) continue;
      const stored = window.localStorage.getItem(
        `${HOID_THREAD_KEY_PREFIX}${thread.environmentId}`,
      );
      if (stored === thread.id) return thread;
    }
    return null;
  }, [detachedThreadId, threads]);
  const canStart = bootstrapped && (existingThread !== null || targetProject !== null);

  const startNewConversation = useCallback(() => {
    const environmentId = existingThread?.environmentId ?? targetProject?.environmentId;
    if (environmentId) {
      window.localStorage.removeItem(`${HOID_THREAD_KEY_PREFIX}${environmentId}`);
    }
    setPrompt("");
    setError(null);
    setDetachedThreadId(existingThread?.id ?? null);
  }, [existingThread?.environmentId, existingThread?.id, targetProject?.environmentId]);

  const archiveCurrentConversation = useCallback(async () => {
    if (!existingThread || archiving) return;
    setArchiving(true);
    const result = await archiveThread(
      scopeThreadRef(existingThread.environmentId, existingThread.id),
      { onArchived: startNewConversation },
    );
    setArchiving(false);
    if (result._tag === "Failure") {
      const failure = squashAtomCommandFailure(result);
      toastManager.add({
        type: "error",
        title: "Couldn’t archive Hoid conversation",
        description: failure instanceof Error ? failure.message : "Try again.",
      });
    }
  }, [archiveThread, archiving, existingThread, startNewConversation]);

  const start = useCallback(
    async (nextPrompt: string) => {
      const trimmed = nextPrompt.trim();
      if (trimmed.length === 0 || starting) return;
      setStarting(true);
      setError(null);
      try {
        if (existingThread) {
          const threadRef = scopeThreadRef(existingThread.environmentId, existingThread.id);
          const drafts = useComposerDraftStore.getState();
          drafts.setModelSelection(threadRef, HOID_MODEL, { replaceOptions: true });
          drafts.setPrompt(threadRef, trimmed);
          setOpen(false);
          await navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams({
              environmentId: existingThread.environmentId,
              threadId: existingThread.id,
            }),
          });
          return;
        }

        if (!targetProject) return;
        const opened = await handleNewThread(
          scopeProjectRef(targetProject.environmentId, targetProject.id),
          { replace: false },
        );
        if (!opened) {
          setError("The workspace changed before the agent could open. Try again.");
          return;
        }
        window.localStorage.setItem(
          `${HOID_THREAD_KEY_PREFIX}${targetProject.environmentId}`,
          opened.threadId,
        );
        const drafts = useComposerDraftStore.getState();
        drafts.setModelSelection(opened.draftId, HOID_MODEL, { replaceOptions: true });
        drafts.setPrompt(opened.draftId, trimmed);
        setOpen(false);
      } catch {
        setError("Couldn’t open Hoid. Check the environment connection and try again.");
      } finally {
        setStarting(false);
      }
    },
    [existingThread, handleNewThread, navigate, setOpen, starting, targetProject],
  );

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogPopup
        variant="workspace"
        bottomStickOnMobile={false}
        className="h-[min(84dvh,52rem)] max-h-none w-[min(90vw,72rem)] max-w-none overflow-hidden max-sm:h-[calc(100dvh-2rem)] max-sm:w-[calc(100vw-2rem)]"
        showCloseButton={false}
      >
        <header className="relative grid h-14 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-b border-border/70 px-3">
          <div className="justify-self-start">
            <Tooltip>
              <TooltipTrigger
                render={
                  <DialogClose
                    aria-label="Close Hoid"
                    render={<Button size="icon" variant="ghost" />}
                  />
                }
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipPopup>Close</TooltipPopup>
            </Tooltip>
          </div>
          <div className="flex items-center gap-2">
            <SparklesIcon className="size-4 text-muted-foreground" />
            <DialogTitle size="sm">Hoid</DialogTitle>
          </div>
          <div className="flex items-center justify-self-end">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Start a new Hoid conversation"
                    disabled={starting || archiving}
                    onClick={startNewConversation}
                    size="icon"
                    variant="ghost"
                  />
                }
              >
                <PlusIcon />
              </TooltipTrigger>
              <TooltipPopup>New conversation</TooltipPopup>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    aria-label="Archive current Hoid conversation"
                    disabled={existingThread === null || starting || archiving}
                    onClick={() => void archiveCurrentConversation()}
                    size="icon"
                    variant="ghost"
                  />
                }
              >
                <ArchiveIcon />
              </TooltipTrigger>
              <TooltipPopup>
                {existingThread ? "Archive conversation" : "No conversation to archive"}
              </TooltipPopup>
            </Tooltip>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-8 sm:px-10 sm:py-12">
          <div className="m-auto flex w-full max-w-3xl flex-col">
            <div className="mb-9 text-center">
              <div className="mx-auto mb-5 flex size-12 items-center justify-center rounded-2xl bg-foreground text-background shadow-sm">
                <SparklesIcon className="size-5" />
              </div>
              <h2 className="text-balance text-3xl font-semibold tracking-tight">
                Ask across your work
              </h2>
              <DialogDescription className="mx-auto mt-3 max-w-xl">
                <span className="text-pretty leading-6">
                  Search and read conversations on this environment, including archived work. Hoid
                  retrieves sources before answering and links back to the conversations it used.
                </span>
              </DialogDescription>
            </div>

            <div className="mb-5 grid gap-2 sm:grid-cols-3">
              {STARTERS.map((starter) => (
                <button
                  key={starter.label}
                  className="group flex min-h-24 flex-col items-start gap-3 rounded-xl border border-border/70 bg-card/40 p-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                  disabled={starting || !canStart}
                  onClick={() => void start(starter.prompt)}
                  type="button"
                >
                  <starter.icon className="size-4 text-muted-foreground transition-colors group-hover:text-foreground" />
                  <span className="text-sm font-medium">{starter.label}</span>
                </button>
              ))}
            </div>

            <form
              className="rounded-2xl border border-border/80 bg-card/70 p-2 shadow-sm"
              onSubmit={(event) => {
                event.preventDefault();
                void start(prompt);
              }}
            >
              <Textarea
                aria-label="Ask Hoid"
                disabled={starting || !canStart}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Ask about a decision, an archived conversation, or ongoing work…"
                rows={3}
                unstyled
                value={prompt}
              />
              <div className="flex items-center justify-between gap-3 px-2 pb-1 pt-2">
                <p className="truncate text-xs text-muted-foreground">
                  {canStart
                    ? "GPT-5.6 Sol · All accessible conversations on this environment"
                    : "Add a project to start Hoid"}
                </p>
                <Button
                  aria-label="Start Hoid"
                  disabled={starting || !canStart || prompt.trim().length === 0}
                  size="icon"
                  type="submit"
                >
                  <ArrowUpIcon className="size-4" />
                </Button>
              </div>
            </form>

            {error ? <p className="mt-3 text-center text-sm text-destructive">{error}</p> : null}
            <p className="mt-5 text-center text-xs leading-5 text-muted-foreground">
              Conversation content is treated as untrusted data. Messaging and archive changes
              require an explicit request; bulk archive, deletion, shipping, and credential changes
              are not available here.
            </p>
          </div>
        </div>
      </DialogPopup>
    </Dialog>
  );
}

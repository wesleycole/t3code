import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_EFFORT_PRESETS,
  EFFORT_PRESET_LABELS,
  EFFORT_PRESETS,
  type EffortPreset,
  type ModelSelection,
  type WorktreeSubmodules,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveEffortModel, resolveEffortPreset } from "@t3tools/shared/effortPresets";
import { resolveProjectSettings } from "@t3tools/shared/projectSettings";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";
import { useState } from "react";

import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { resolveEnvModeLabel, WORKTREE_SUBMODULES_LABELS } from "../BranchToolbar.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import { TraitsPicker } from "../chat/TraitsPicker";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Switch } from "../ui/switch";
import type { ProjectSettingsCategory } from "./ProjectSettingsPanel";
import { searchableSetting } from "./settingsSearch";
import { useSettingsScope } from "./SettingsScopeContext";
import {
  SETTINGS_PICKER_TRIGGER_CLASSNAME,
  SettingResetButton,
  SettingsRow,
  SettingsSection,
} from "./settingsLayout";
import {
  useScopedSettings,
  useScopedSettingsMixed,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/** Environment-owned model and option mappings for the conversation effort dial. */
export function EffortPresetsSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { scope, environment, connectedEnvironments } = useSettingsScope();
  const [customSpecialists, setCustomSpecialists] = useState<ReadonlyArray<string>>([]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  if (isProjectScope) return null;

  const providers = environment?.serverConfig?.providers ?? EMPTY_SERVER_PROVIDERS;
  const entries = sortProviderInstanceEntries(
    applyProviderInstanceSettings(deriveProviderInstanceEntries(providers), settings),
  );
  const canEdit = scope.environmentIds.length === 1 && connectedEnvironments.length === 1;
  const resetDisabled =
    Equal.equals(settings.effortPresets, DEFAULT_EFFORT_PRESETS) &&
    settings.defaultEffortPreset === DEFAULT_SERVER_SETTINGS.defaultEffortPreset;

  const setPreset = (preset: EffortPreset, selection: ModelSelection) => {
    if (!canEdit) return;
    updateSettings({ effortPresets: { ...settings.effortPresets, [preset]: selection } });
  };
  const specialistNames = Array.from(
    new Set([
      "oracle",
      "librarian",
      "critic",
      ...customSpecialists,
      ...EFFORT_PRESETS.flatMap((preset) =>
        Object.keys(settings.effortPresets[preset].specialistModels ?? {}),
      ),
    ]),
  );

  const modelControls = (
    selection: ModelSelection | undefined,
    label: string,
    onChange: (selection: ModelSelection) => void,
    specialistName?: string,
  ) => {
    const allowedEntries = specialistName
      ? entries.filter(
          (entry) => entry.driverKind === "codex" || entry.driverKind === "claudeAgent",
        )
      : entries;
    const displayed = selection ?? settings.effortPresets.low;
    const activeEntry = allowedEntries.find((entry) => entry.instanceId === displayed.instanceId);
    return (
      <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
        <ProviderModelPicker
          activeInstanceId={displayed.instanceId}
          model={displayed.model}
          lockedProvider={null}
          instanceEntries={allowedEntries}
          modelOptionsByInstance={getCustomModelOptionsByInstance(
            settings,
            providers,
            displayed.instanceId,
            displayed.model,
          )}
          triggerVariant="outline"
          triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
          triggerAriaLabel={label}
          {...(!selection ? { triggerLabel: "Definition default" } : {})}
          onOpenProviderSetup={(instanceId) => {
            if (environment)
              void navigate({
                to: "/settings/providers",
                search: { environmentId: environment.environmentId, instanceId },
              });
          }}
          onInstanceModelChange={(instanceId, model) =>
            onChange(createModelSelection(instanceId, model))
          }
        />
        {selection && activeEntry ? (
          <TraitsPicker
            provider={activeEntry.driverKind}
            models={activeEntry.models}
            model={selection.model}
            prompt=""
            onPromptChange={() => {}}
            modelOptions={selection.options ?? []}
            allowPromptInjectedEffort={false}
            planModeEnabled={settings.planModeEnabled}
            triggerVariant="outline"
            triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
            onModelOptionsChange={(options) =>
              onChange(createModelSelection(selection.instanceId, selection.model, options))
            }
          />
        ) : null}
      </div>
    );
  };

  return (
    <SettingsSection
      id="effort-presets"
      title="Effort presets"
      headerAction={
        !resetDisabled && canEdit ? (
          <SettingResetButton
            label="effort presets"
            onClick={() =>
              updateSettings({
                effortPresets: DEFAULT_EFFORT_PRESETS,
                defaultEffortPreset: DEFAULT_SERVER_SETTINGS.defaultEffortPreset,
              })
            }
          />
        ) : null
      }
    >
      {!canEdit ? (
        <SettingsRow
          title="Choose an environment"
          description="Effort mappings use each environment's own providers. Select one environment to review or edit them."
        />
      ) : (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultEffortPreset"]}
            id="default-effort-preset"
            title="Default effort"
            description="New conversations start at this dial position. Existing conversations are unchanged."
            resetAction={
              settings.defaultEffortPreset !== DEFAULT_SERVER_SETTINGS.defaultEffortPreset ? (
                <SettingResetButton
                  label="default effort"
                  onClick={() =>
                    updateSettings({
                      defaultEffortPreset: DEFAULT_SERVER_SETTINGS.defaultEffortPreset,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={settings.defaultEffortPreset}
                onValueChange={(value) => {
                  if (value && EFFORT_PRESETS.includes(value))
                    updateSettings({ defaultEffortPreset: value });
                }}
              >
                <SelectTrigger size="sm" aria-label="Default effort">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {EFFORT_PRESETS.map((preset) => (
                    <SelectItem key={preset} value={preset}>
                      {EFFORT_PRESET_LABELS[preset]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
          {EFFORT_PRESETS.map((preset) => {
            const selection = settings.effortPresets[preset];
            const resolution = resolveEffortPreset(settings.effortPresets, preset, providers);
            return (
              <div key={preset}>
                <SettingsRow
                  serverScoped
                  settingKeys={["effortPresets"]}
                  id={`effort-preset-${preset}`}
                  title={EFFORT_PRESET_LABELS[preset]}
                  description={`Primary agent for ${preset} effort.`}
                  status={resolution._tag === "Unavailable" ? resolution.reason : undefined}
                  control={modelControls(
                    selection,
                    `${EFFORT_PRESET_LABELS[preset]} effort model`,
                    (next) =>
                      setPreset(preset, {
                        ...next,
                        ...(selection.specialistModels
                          ? { specialistModels: selection.specialistModels }
                          : {}),
                      }),
                  )}
                />
                <details className="px-4 py-3">
                  <summary className="cursor-pointer rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring">
                    Specialists
                  </summary>
                  <p className="pt-3 text-xs text-muted-foreground">
                    Override a specialist’s model for this effort. Otherwise its Markdown definition
                    chooses the model. Saved conversations keep their overrides.
                  </p>
                  {specialistNames.map((name) => {
                    const override = selection.specialistModels?.[name];
                    const specialistResolution = override
                      ? resolveEffortModel(override, providers)
                      : null;
                    return (
                      <SettingsRow
                        key={name}
                        title={
                          name === "oracle"
                            ? "Oracle"
                            : name === "librarian"
                              ? "Librarian"
                              : name === "critic"
                                ? "Critic"
                                : name
                        }
                        status={
                          specialistResolution?._tag === "Unavailable"
                            ? specialistResolution.reason
                            : undefined
                        }
                        resetAction={
                          override ? (
                            <SettingResetButton
                              label={`${preset} ${name} model`}
                              tooltip="Use the specialist definition’s model"
                              onClick={() => {
                                const specialistModels = { ...selection.specialistModels };
                                delete specialistModels[name];
                                setPreset(preset, { ...selection, specialistModels });
                              }}
                            />
                          ) : null
                        }
                        control={modelControls(
                          override,
                          `${EFFORT_PRESET_LABELS[preset]} ${name} model`,
                          (next) =>
                            setPreset(preset, {
                              ...selection,
                              specialistModels: { ...selection.specialistModels, [name]: next },
                            }),
                          name,
                        )}
                      />
                    );
                  })}
                </details>
              </div>
            );
          })}
          <SettingsRow
            title="Custom specialist"
            description="Use the name from its .agents/specialists Markdown definition. This adds a model override, not a new specialist."
            control={
              <form
                className="flex min-w-0 gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const name = new FormData(event.currentTarget).get("specialistName");
                  if (typeof name !== "string" || !name.trim()) return;
                  setCustomSpecialists((names) => [...names, name.trim()]);
                  event.currentTarget.reset();
                }}
              >
                <Input
                  name="specialistName"
                  aria-label="Specialist name"
                  placeholder="Specialist name"
                  required
                  maxLength={53}
                  pattern="[A-Za-z0-9][A-Za-z0-9_\-]*"
                  className="min-w-0"
                />
                <Button type="submit" size="sm" variant="outline">
                  Add
                </Button>
              </form>
            }
          />
        </>
      )}
    </SettingsSection>
  );
}

/**
 * Rows for the settings a project may override. The same rows edit
 * environment defaults at an environment scope and project overrides at a
 * project or checkout scope; the scoped hooks route the write.
 */
const WORKTREE_SUBMODULES_OPTIONS = ["recursive", "top-level", "none"] as const;
function isWorktreeSubmodules(value: string | null): value is WorktreeSubmodules {
  return value !== null && (WORKTREE_SUBMODULES_OPTIONS as readonly string[]).includes(value);
}

export function ProjectDefaultsSettings({ category }: { category: ProjectSettingsCategory }) {
  const { scope, target, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedPermissions = useScopedSettingsMixed(["defaultRuntimeMode"]);
  const PermissionIcon = runtimeModeConfig[settings.defaultRuntimeMode].icon;
  const mixedWorkspace = useScopedSettingsMixed(["defaultThreadEnvMode"]);
  const mixedSubmodules = useScopedSettingsMixed(["worktreeSubmodules"]);
  const mixedBrowser = useScopedSettingsMixed(["enableAgentBrowserAccess"]);
  const mixedAutoPull = useScopedSettingsMixed(["defaultAutoPull"]);
  const mixedMergeMethod = useScopedSettingsMixed(["pullRequestMergeMethod"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;
  // File-backed keys show their effective value; the target already carries
  // the checkout's t3.json, and a null file here only fills the built-in.
  // The reset arrow beside the title clears the tier (SettingsRow handles a
  // project override, the environment value is cleared here), so the picker
  // has no "inherit" item.
  const effective = target
    ? resolveProjectSettings(target.settings, null, null, null).settings
    : null;

  return (
    <SettingsSection
      id={
        category === "general"
          ? "project-defaults"
          : category === "integrations"
            ? "browser-access"
            : "source-control-defaults"
      }
      title={
        category === "general"
          ? "New threads"
          : category === "integrations"
            ? "Browser"
            : "Repositories"
      }
    >
      {category === "general" ? (
        <>
          {isProjectScope ? (
            <SettingsRow
              serverScoped
              id="effort-presets"
              title="Effort presets"
              description="Models and options for effort levels are configured per environment, not per project."
              control={<span className="text-sm text-muted-foreground">Environment setting</span>}
            />
          ) : null}
          <SettingsRow
            serverScoped
            settingKeys={["defaultRuntimeMode"]}
            mixed={mixedPermissions}
            {...searchableSetting("default-permissions")}
            description={
              isProjectScope
                ? "Permissions for new threads in this project."
                : "Default permissions for new threads. Projects can override them."
            }
            resetAction={
              settings.defaultRuntimeMode !== DEFAULT_SERVER_SETTINGS.defaultRuntimeMode ? (
                <SettingResetButton
                  label="default permissions"
                  onClick={() =>
                    updateSettings({
                      defaultRuntimeMode: DEFAULT_SERVER_SETTINGS.defaultRuntimeMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={mixedPermissions ? null : settings.defaultRuntimeMode}
                onValueChange={(value) => {
                  if (value) updateSettings({ defaultRuntimeMode: value });
                }}
              >
                <SelectTrigger size="sm" aria-label="Default permissions">
                  {!mixedPermissions && (
                    <PermissionIcon className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <SelectValue>
                    {mixedPermissions
                      ? "Mixed"
                      : runtimeModeConfig[settings.defaultRuntimeMode].label}
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {runtimeModeOptions.map((mode) => {
                    const option = runtimeModeConfig[mode];
                    const Icon = option.icon;
                    return (
                      <SelectItem key={mode} value={mode} className="min-w-64 py-2">
                        <div className="grid gap-0.5">
                          <span className="inline-flex items-center gap-1.5 font-medium">
                            <Icon className="size-3.5 shrink-0 text-muted-foreground" />
                            {option.label}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {option.description}
                          </span>
                        </div>
                      </SelectItem>
                    );
                  })}
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["defaultThreadEnvMode"]}
            mixed={mixedWorkspace}
            id={searchableSetting("new-threads").id}
            title="Workspace"
            description={
              isProjectScope
                ? "Where new threads in this project start."
                : "Where new threads start. Projects and their t3.json can override it."
            }
            resetAction={
              !isProjectScope && settings.defaultThreadEnvMode !== null ? (
                <SettingResetButton
                  label="default workspace"
                  onClick={() => updateSettings({ defaultThreadEnvMode: null })}
                />
              ) : null
            }
            control={
              <Select
                value={mixedWorkspace ? null : (effective?.defaultThreadEnvMode ?? null)}
                onValueChange={(value) => {
                  if (value === "local" || value === "worktree")
                    updateSettings({ defaultThreadEnvMode: value });
                }}
              >
                <SelectTrigger size="sm" aria-label="Default workspace">
                  <SelectValue>
                    {(value: string | null) =>
                      value === "local" || value === "worktree"
                        ? resolveEnvModeLabel(value)
                        : unavailable
                          ? "Unavailable"
                          : "Mixed"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="local">{resolveEnvModeLabel("local")}</SelectItem>
                  <SelectItem value="worktree">{resolveEnvModeLabel("worktree")}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["worktreeSubmodules"]}
            mixed={mixedSubmodules}
            {...searchableSetting("worktree-submodules")}
            description={
              isProjectScope
                ? "How new worktrees in this project populate git submodules."
                : "How new worktrees populate git submodules. Projects and their t3.json can override it."
            }
            resetAction={
              !isProjectScope && settings.worktreeSubmodules !== null ? (
                <SettingResetButton
                  label="worktree submodules"
                  onClick={() => updateSettings({ worktreeSubmodules: null })}
                />
              ) : null
            }
            control={
              <Select
                value={mixedSubmodules ? null : (effective?.worktreeSubmodules ?? null)}
                onValueChange={(value) => {
                  if (isWorktreeSubmodules(value)) updateSettings({ worktreeSubmodules: value });
                }}
              >
                <SelectTrigger size="sm" aria-label="Worktree submodules">
                  <SelectValue>
                    {(value: string | null) =>
                      isWorktreeSubmodules(value)
                        ? WORKTREE_SUBMODULES_LABELS[value]
                        : unavailable
                          ? "Unavailable"
                          : "Mixed"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  {WORKTREE_SUBMODULES_OPTIONS.map((option) => (
                    <SelectItem key={option} value={option}>
                      {WORKTREE_SUBMODULES_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            }
          />
        </>
      ) : category === "source-control" ? (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["defaultAutoPull"]}
            mixed={mixedAutoPull}
            id="automatic-pull"
            title="Automatically pull"
            description={
              isProjectScope
                ? "Keeps this project's default branch current when the checkout has no local changes or commits."
                : "Keeps the default branch current when the checkout has no local changes or commits. Projects can override it."
            }
            resetAction={
              settings.defaultAutoPull ? (
                <SettingResetButton
                  label="default automatic pull"
                  tooltip="Reset automatic pull to off"
                  onClick={() => updateSettings({ defaultAutoPull: false })}
                />
              ) : null
            }
            control={
              <Switch
                aria-label="Default automatic pull"
                mixed={mixedAutoPull}
                checked={mixedAutoPull ? false : settings.defaultAutoPull}
                onCheckedChange={(enabled) => updateSettings({ defaultAutoPull: enabled })}
              />
            }
          />
          <SettingsRow
            serverScoped
            settingKeys={["pullRequestMergeMethod"]}
            mixed={mixedMergeMethod}
            {...searchableSetting("pull-request-merge-method")}
            description={
              isProjectScope
                ? "Pull requests in this project start with this method."
                : "Pull requests start with this method. Last selected reuses whatever you chose most recently on this device."
            }
            resetAction={
              settings.pullRequestMergeMethod !== null ? (
                <SettingResetButton
                  label="default merge method"
                  tooltip="Reset to last selected"
                  onClick={() => updateSettings({ pullRequestMergeMethod: null })}
                />
              ) : null
            }
            control={
              <Select
                value={mixedMergeMethod ? null : (settings.pullRequestMergeMethod ?? "last")}
                onValueChange={(value) => {
                  if (value === "last") updateSettings({ pullRequestMergeMethod: null });
                  else if (value === "merge" || value === "squash" || value === "rebase")
                    updateSettings({ pullRequestMergeMethod: value });
                }}
              >
                <SelectTrigger size="sm" aria-label="Default pull request merge method">
                  <SelectValue>
                    {(value: string | null) =>
                      value === "merge" || value === "squash" || value === "rebase"
                        ? PULL_REQUEST_MERGE_METHOD_LABELS[value]
                        : value === "last"
                          ? "Last selected"
                          : "Mixed"
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectPopup align="end" alignItemWithTrigger={false}>
                  <SelectItem value="last">Last selected</SelectItem>
                  <SelectItem value="merge">{PULL_REQUEST_MERGE_METHOD_LABELS.merge}</SelectItem>
                  <SelectItem value="squash">{PULL_REQUEST_MERGE_METHOD_LABELS.squash}</SelectItem>
                  <SelectItem value="rebase">{PULL_REQUEST_MERGE_METHOD_LABELS.rebase}</SelectItem>
                </SelectPopup>
              </Select>
            }
          />
        </>
      ) : (
        <>
          <SettingsRow
            serverScoped
            settingKeys={["enableAgentBrowserAccess"]}
            mixed={mixedBrowser}
            id={searchableSetting("agent-browser-access").id}
            title="Agent browser access"
            description={
              isProjectScope
                ? "Allow agents in this project to use the shared browser. Applies when the agent session next starts."
                : "Allow agents to use the shared browser. Projects can override it."
            }
            resetAction={
              settings.enableAgentBrowserAccess !==
              DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess ? (
                <SettingResetButton
                  label="default browser access"
                  onClick={() =>
                    updateSettings({
                      enableAgentBrowserAccess: DEFAULT_SERVER_SETTINGS.enableAgentBrowserAccess,
                    })
                  }
                />
              ) : null
            }
            control={
              <Switch
                aria-label="Agent browser access"
                mixed={mixedBrowser}
                checked={mixedBrowser ? false : settings.enableAgentBrowserAccess}
                onCheckedChange={(enabled) => updateSettings({ enableAgentBrowserAccess: enabled })}
              />
            }
          />
        </>
      )}
    </SettingsSection>
  );
}

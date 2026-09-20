import {
  DEFAULT_SERVER_SETTINGS,
  DEFAULT_EFFORT_PRESETS,
  EFFORT_PRESET_LABELS,
  EFFORT_PRESETS,
  EnvironmentId,
  type EffortPreset,
  type ModelSelection,
} from "@t3tools/contracts";
import { createModelSelection } from "@t3tools/shared/model";
import { resolveEffortPreset } from "@t3tools/shared/effortPresets";
import { useNavigate } from "@tanstack/react-router";
import * as Equal from "effect/Equal";

import { useT3ProjectFileState } from "../../hooks/useT3ProjectFileScripts";
import { getCustomModelOptionsByInstance } from "../../modelSelection";
import {
  applyProviderInstanceSettings,
  deriveProviderInstanceEntries,
  sortProviderInstanceEntries,
} from "../../providerInstances";
import { EMPTY_SERVER_PROVIDERS } from "../../state/server";
import { resolveEnvModeLabel } from "../BranchToolbar.logic";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { runtimeModeConfig, runtimeModeOptions } from "../chat/runtimeModeConfig";
import { PULL_REQUEST_MERGE_METHOD_LABELS } from "../pullRequest/pullRequestDetail.logic";
import { TraitsPicker } from "../chat/TraitsPicker";
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
  useScopedSettingSource,
  useUpdateScopedSettings,
} from "./useScopedSettings";

/** Environment-owned model and option mappings for the conversation effort dial. */
export function EffortPresetsSettings() {
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const navigate = useNavigate();
  const { scope, environment, connectedEnvironments } = useSettingsScope();
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
            const activeEntry = entries.find((entry) => entry.instanceId === selection.instanceId);
            const modelOptions = getCustomModelOptionsByInstance(
              settings,
              providers,
              selection.instanceId,
              selection.model,
            );
            const resolution = resolveEffortPreset(settings.effortPresets, preset, providers);
            return (
              <SettingsRow
                key={preset}
                serverScoped
                settingKeys={["effortPresets"]}
                id={`effort-preset-${preset}`}
                title={EFFORT_PRESET_LABELS[preset]}
                description={`Provider, model, and options used for ${preset} effort.`}
                status={resolution._tag === "Unavailable" ? resolution.reason : undefined}
                control={
                  <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                    <ProviderModelPicker
                      activeInstanceId={selection.instanceId}
                      model={selection.model}
                      lockedProvider={null}
                      instanceEntries={entries}
                      modelOptionsByInstance={modelOptions}
                      triggerVariant="outline"
                      triggerClassName={SETTINGS_PICKER_TRIGGER_CLASSNAME}
                      triggerAriaLabel={`${EFFORT_PRESET_LABELS[preset]} effort model`}
                      onOpenProviderSetup={(instanceId) => {
                        if (environment)
                          void navigate({
                            to: "/settings/providers",
                            search: { environmentId: environment.environmentId, instanceId },
                          });
                      }}
                      onInstanceModelChange={(instanceId, model) =>
                        setPreset(preset, createModelSelection(instanceId, model))
                      }
                    />
                    {activeEntry ? (
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
                          setPreset(
                            preset,
                            createModelSelection(selection.instanceId, selection.model, options),
                          )
                        }
                      />
                    ) : null}
                  </div>
                }
              />
            );
          })}
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
export function ProjectDefaultsSettings({ category }: { category: ProjectSettingsCategory }) {
  const { scope, connectedEnvironments } = useSettingsScope();
  const settings = useScopedSettings();
  const updateSettings = useUpdateScopedSettings();
  const mixedPermissions = useScopedSettingsMixed(["defaultRuntimeMode"]);
  const PermissionIcon = runtimeModeConfig[settings.defaultRuntimeMode].icon;
  const mixedWorkspace = useScopedSettingsMixed(["defaultThreadEnvMode"]);
  const mixedBrowser = useScopedSettingsMixed(["enableAgentBrowserAccess"]);
  const mixedAutoPull = useScopedSettingsMixed(["defaultAutoPull"]);
  const mixedMergeMethod = useScopedSettingsMixed(["pullRequestMergeMethod"]);
  const workspaceSource = useScopedSettingSource(["defaultThreadEnvMode"]);
  const isProjectScope = scope.kind === "project" || scope.kind === "checkout";
  const unavailable = connectedEnvironments.length === 0;

  // A checkout's t3.json wins over the environment default when the project
  // has no override of its own; show which one "inherit" resolves to.
  const checkout = scope.kind === "checkout" ? scope.checkout : null;
  // The query is disabled without a checkout, so any id satisfies the hook.
  const t3File = useT3ProjectFileState(
    checkout?.environmentId ?? EnvironmentId.make("none"),
    category === "general" && checkout ? checkout.workspaceRoot : null,
  );
  const repositoryEnvMode = t3File.file?.defaultThreadEnvMode ?? null;
  const inheritedEnvModeLabel =
    workspaceSource === "project"
      ? null
      : repositoryEnvMode
        ? `${resolveEnvModeLabel(repositoryEnvMode)} (t3.json)`
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
                ? "Where new threads in this project start. A t3.json preference applies when the project has no override."
                : "Where new threads start, unless overridden by the project or t3.json."
            }
            status={
              inheritedEnvModeLabel ? `Repository default: ${inheritedEnvModeLabel}` : undefined
            }
            resetAction={
              settings.defaultThreadEnvMode !== DEFAULT_SERVER_SETTINGS.defaultThreadEnvMode ? (
                <SettingResetButton
                  label="default workspace"
                  onClick={() =>
                    updateSettings({
                      defaultThreadEnvMode: DEFAULT_SERVER_SETTINGS.defaultThreadEnvMode,
                    })
                  }
                />
              ) : null
            }
            control={
              <Select
                value={mixedWorkspace ? null : settings.defaultThreadEnvMode}
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

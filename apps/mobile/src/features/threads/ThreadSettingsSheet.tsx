import type {
  EnvironmentId,
  ModelSelection,
  ProviderInstanceId,
  ProviderOptionDescriptor,
  ProviderOptionSelection,
  RuntimeMode,
} from "@t3tools/contracts";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import {
  createContext,
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { Alert, Platform, ScrollView, View } from "react-native";

import { AndroidScreenHeader } from "../../components/AndroidScreenHeader";
import { AppText as Text } from "../../components/AppText";
import type { ModelOption, ProviderGroup } from "../../lib/modelOptions";
import { NativeStackScreenOptions } from "../../native/StackHeader";
import { useNewTaskFlow } from "./new-task-flow-provider";
import { RUNTIME_MODE_CHOICES } from "./thread-settings-options";
import { ChoiceRow } from "./ThreadSettingsRows";

type ThreadSettingsSessionProps = {
  readonly environmentId: EnvironmentId | null;
  readonly providerInstanceId?: ProviderInstanceId;
  readonly providerGroups: ReadonlyArray<ProviderGroup>;
  readonly selectedModel: ModelSelection | null;
  readonly onSelectModel: (option: ModelOption) => void;
  readonly optionDescriptors: ReadonlyArray<ProviderOptionDescriptor>;
  readonly onUpdateOptionSelections: (selections: ReadonlyArray<ProviderOptionSelection>) => void;
  readonly runtimeMode: RuntimeMode;
  readonly onUpdateRuntimeMode: (mode: RuntimeMode) => void;
};

/** Settings state bridged from an existing thread into its root sheet route. */
export type ExistingThreadSettingsRouteSession = ThreadSettingsSessionProps & {
  readonly ownerId: string;
};

type ExistingThreadSettingsRouteContextValue = {
  readonly session: ExistingThreadSettingsRouteSession | null;
  readonly present: (session: ExistingThreadSettingsRouteSession) => void;
  readonly clear: (ownerId: string) => void;
};

const ExistingThreadSettingsRouteContext =
  createContext<ExistingThreadSettingsRouteContextValue | null>(null);

/** Bridges the active thread's settings state into the root native sheet route. */
export function ExistingThreadSettingsRouteProvider(props: { readonly children: ReactNode }) {
  const [session, setSession] = useState<ExistingThreadSettingsRouteSession | null>(null);
  const present = useCallback((nextSession: ExistingThreadSettingsRouteSession) => {
    setSession(nextSession);
  }, []);
  const clear = useCallback((ownerId: string) => {
    setSession((current) => (current?.ownerId === ownerId ? null : current));
  }, []);
  const value = useMemo(() => ({ session, present, clear }), [clear, present, session]);

  return (
    <ExistingThreadSettingsRouteContext.Provider value={value}>
      {props.children}
    </ExistingThreadSettingsRouteContext.Provider>
  );
}

/** Accesses the existing thread settings route presentation. */
export function useExistingThreadSettingsRoutePresentation() {
  const value = use(ExistingThreadSettingsRouteContext);
  if (!value) {
    throw new Error(
      "useExistingThreadSettingsRoutePresentation must be used inside ExistingThreadSettingsRouteProvider.",
    );
  }
  return value;
}

/** Existing threads expose permissions only; their model snapshot is immutable. */
export function ExistingThreadSettingsRouteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();
  const presentation = useExistingThreadSettingsRoutePresentation();
  const session = presentation.session;

  useEffect(() => {
    if (!session) navigation.goBack();
  }, [navigation, session]);

  if (!session) return <View className="flex-1 bg-sheet" />;

  return (
    <View className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: "Permissions" }} />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title="Permissions" onBack={() => navigation.goBack()} />
      ) : null}
      <ScrollView contentContainerClassName="px-4 pb-10 pt-5">
        <View className="overflow-hidden rounded-2xl bg-card">
          {RUNTIME_MODE_CHOICES.map((choice, index) => (
            <ChoiceRow
              key={choice.mode}
              label={choice.label}
              description={choice.description}
              selected={choice.mode === session.runtimeMode}
              isLast={index === RUNTIME_MODE_CHOICES.length - 1}
              onPress={() => {
                session.onUpdateRuntimeMode(choice.mode);
                navigation.goBack();
              }}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

/** Shows effort and permission defaults for a new task. */
export function NewTaskThreadSettingsRouteScreen() {
  const flow = useNewTaskFlow();
  const navigation = useNavigation<NativeStackNavigationProp<Record<string, object | undefined>>>();

  return (
    <View className="flex-1 bg-sheet">
      <NativeStackScreenOptions options={{ title: "Effort" }} />
      {Platform.OS === "android" ? (
        <AndroidScreenHeader title="Effort" onBack={() => navigation.goBack()} />
      ) : null}
      <ScrollView contentContainerClassName="pb-10 pt-5">
        <Text className="px-5 pb-2 text-sm font-t3-medium text-foreground-muted">
          New conversation effort
        </Text>
        <View className="mx-4 overflow-hidden rounded-2xl bg-card">
          {flow.effortPresetOptions.map((option, index) => (
            <ChoiceRow
              key={option.preset}
              label={option.label}
              description={option.detail}
              selected={option.preset === flow.selectedEffortPreset}
              isLast={index === flow.effortPresetOptions.length - 1}
              onPress={() => {
                if (option.unavailableReason) {
                  Alert.alert("Effort unavailable", option.unavailableReason);
                  return;
                }
                flow.setEffortPreset(option.preset);
                navigation.goBack();
              }}
            />
          ))}
        </View>
        <Text className="px-5 pt-3 text-xs text-foreground-muted">
          Effort mappings are configured for this environment in desktop or web settings. Your
          choice is saved as a fixed model for this conversation.
        </Text>

        <Text className="px-5 pb-2 pt-7 text-sm font-t3-medium text-foreground-muted">
          Permissions
        </Text>
        <View className="mx-4 overflow-hidden rounded-2xl bg-card">
          {RUNTIME_MODE_CHOICES.map((choice, index) => (
            <ChoiceRow
              key={choice.mode}
              label={choice.label}
              description={choice.description}
              selected={choice.mode === flow.runtimeMode}
              isLast={index === RUNTIME_MODE_CHOICES.length - 1}
              onPress={() => flow.setRuntimeMode(choice.mode)}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

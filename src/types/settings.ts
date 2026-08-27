import { ShortcutAction } from "./shortcut";

export type CommandPolicyMode = "none" | "whitelist" | "blacklist";

export type CommandSettings = {
  policyMode: CommandPolicyMode;
  whitelist: string[];
  blacklist: string[];
  trustedDirectories?: string[];
};

export type PluginTrustRecord = {
  trusted: boolean;
  trustedAt?: string | null;
  manifestFingerprint?: string | null;
  version?: string | null;
};

export type PluginSecuritySettings = {
  trustedPlugins: Record<string, PluginTrustRecord>;
};

export type TargetGroup = {
  id: string;
  name: string;
  paths: string[];
  active: boolean;
};

export type Language = "en" | "ja" | "de";

export type UiSettings = {
  compactListItems: boolean;
  closeToTray: boolean;
  language: Language;
};

export type ExperimentalSettings = {
  captureSelectedTextOnActivation: boolean;
};

export type KeybindingValue = string | string[];

export type KeybindingMap = Partial<
  Record<ShortcutAction, KeybindingValue>
>;

export type AppSettings = {
  theme: string;
  commands: CommandSettings;
  plugins: PluginSecuritySettings;
  targetGroups: TargetGroup[];
  currentTargetGroupId: string | null;
  ui: UiSettings;
  experimental: ExperimentalSettings;
  keybindings: KeybindingMap;
};

export type PartialSettings = {
  theme?: string;
  commands?: Partial<CommandSettings>;
  plugins?: PluginSecuritySettings;
  targetGroups?: TargetGroup[];
  currentTargetGroupId?: string | null;
  ui?: Partial<UiSettings>;
  experimental?: Partial<ExperimentalSettings>;
  keybindings?: KeybindingMap;
};

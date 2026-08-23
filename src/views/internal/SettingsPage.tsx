import { useEffect, useRef, useState } from "react";

import { toast } from "@/utils/toast";

import { settingsApi } from "@/api/settings";
import {
  AppSettings,
  CommandPolicyMode,
  CommandSettings,
  Language,
  TargetGroup,
} from "@/types";
import { ThemeOption } from "@/constants/themes";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { AdvancedSettings } from "./settings/AdvancedSettings";
import { ExperimentalSettings } from "./settings/ExperimentalSettings";
import { SecuritySettings } from "./settings/SecuritySettings";
import { TargetGroupSettings } from "./settings/TargetGroupSettings";
import { UiSettings } from "./settings/UiSettings";
import { useI18nContext } from "@/i18n/I18nProvider";

type Props = {
  themeId: string;
  themeOptions: ThemeOption[];
  onThemeChange: (themeId: string) => void;
  onReloadThemes: () => Promise<void>;
  compactListItems: boolean;
  onCompactListItemsChange: (compact: boolean) => void;
  language: Language;
  onLanguageChange: (language: Language) => void;
};

const DEFAULT_COMMANDS: CommandSettings = {
  policyMode: "blacklist",
  whitelist: [],
  blacklist: [
    "rm",
    "sudo",
    "su",
    "sh",
    "bash",
    "zsh",
    "fish",
    "cmd",
    "powershell",
    "pwsh",
  ],
};

const DEFAULT_EXPERIMENTAL = {
  captureSelectedTextOnActivation: false,
};

const TARGET_GROUP_NAME_REGEX = /^[\p{L}\p{N}][\p{L}\p{N} _-]*$/u;

const normalizeTargetGroupName = (name: string) =>
  name.trim().toLocaleLowerCase();

const isValidTargetGroupName = (name: string) => {
  const trimmedName = name.trim();

  return trimmedName.length > 0 && TARGET_GROUP_NAME_REGEX.test(trimmedName);
};

export const SettingsPage = ({
  themeId,
  themeOptions,
  onThemeChange,
  onReloadThemes,
  compactListItems,
  onCompactListItemsChange,
  language,
  onLanguageChange,
}: Props) => {
  const { LL } = useI18nContext();
  const [settings, setSettings] = useState<AppSettings | null>(null);

  const [whitelistInput, setWhitelistInput] = useState("");
  const [blacklistInput, setBlacklistInput] = useState("");
  const [targetGroupNameInput, setTargetGroupNameInput] = useState("");

  const saveUiTimerRef = useRef<number | null>(null);

  useEffect(() => {
    settingsApi
      .get()
      .then(setSettings)
      .catch((error) => {
        console.error("Failed to load settings:", error);
      });
  }, []);

  useEffect(() => {
    return () => {
      if (saveUiTimerRef.current !== null) {
        window.clearTimeout(saveUiTimerRef.current);
      }
    };
  }, []);

  const commands = settings?.commands ?? DEFAULT_COMMANDS;
  const experimental = settings?.experimental ?? DEFAULT_EXPERIMENTAL;
  const targetGroups = settings?.targetGroups ?? [];
  const currentTargetGroupId = settings?.currentTargetGroupId ?? null;

  const hasDuplicateTargetGroupName = (
    name: string,
    excludeGroupId?: string,
  ) => {
    const normalizedName = normalizeTargetGroupName(name);

    return targetGroups.some(
      (group) =>
        group.id !== excludeGroupId &&
        normalizeTargetGroupName(group.name) === normalizedName,
    );
  };

  const validateTargetGroupName = (name: string, excludeGroupId?: string) => {
    if (!isValidTargetGroupName(name)) {
      toast.error(LL.settingsPage.messages.invalidTargetGroupName());

      return false;
    }

    if (hasDuplicateTargetGroupName(name, excludeGroupId)) {
      toast.error(LL.settingsPage.messages.duplicateTargetGroupName());

      return false;
    }

    return true;
  };

  const updateCommands = async (nextCommands: CommandSettings) => {
    const nextSettings = await settingsApi.set({
      commands: nextCommands,
    });

    setSettings(nextSettings);
  };

  const updateTargetGroups = async (
    nextGroups: TargetGroup[],
    nextCurrentId = settings?.currentTargetGroupId ?? null,
  ) => {
    const normalizedGroups = nextGroups.map((group) =>
      group.id === nextCurrentId
        ? {
            ...group,
            active: true,
          }
        : group,
    );

    const nextSettings = await settingsApi.set({
      targetGroups: normalizedGroups,
      currentTargetGroupId: nextCurrentId,
    });

    setSettings(nextSettings);
  };

  const changePolicyMode = async (policyMode: CommandPolicyMode) => {
    await updateCommands({
      ...commands,
      policyMode,
    });
  };

  const addCommand = async (list: "whitelist" | "blacklist") => {
    const value =
      list === "whitelist" ? whitelistInput.trim() : blacklistInput.trim();

    if (!value) return;

    await updateCommands({
      ...commands,
      [list]: Array.from(new Set([...commands[list], value])),
    });

    if (list === "whitelist") {
      setWhitelistInput("");
    } else {
      setBlacklistInput("");
    }
  };

  const removeCommand = async (
    list: "whitelist" | "blacklist",
    command: string,
  ) => {
    await updateCommands({
      ...commands,
      [list]: commands[list].filter((item) => item !== command),
    });
  };

  const createTargetGroupId = () => {
    const existingIds = new Set(targetGroups.map((group) => group.id));

    let suffix = targetGroups.length + 1;
    let id = `target-group-${suffix}`;

    while (existingIds.has(id)) {
      suffix += 1;
      id = `target-group-${suffix}`;
    }

    return id;
  };

  const addTargetGroup = async () => {
    const name = targetGroupNameInput.trim();

    if (!validateTargetGroupName(name)) {
      return;
    }

    const id = createTargetGroupId();

    const nextGroups: TargetGroup[] = [
      ...targetGroups,
      {
        id,
        name,
        paths: [],
        active: true,
      },
    ];

    try {
      await updateTargetGroups(nextGroups, currentTargetGroupId ?? id);

      setTargetGroupNameInput("");
    } catch (error) {
      console.error("Failed to add target group:", error);

      toast.error(LL.settingsPage.messages.addTargetGroupFailed());
    }
  };

  const renameTargetGroup = async (
    groupId: string,
    nameInput: string,
  ): Promise<boolean> => {
    const name = nameInput.trim();

    const currentGroup = targetGroups.find((group) => group.id === groupId);

    if (!currentGroup) {
      return false;
    }

    if (currentGroup.name === name) {
      return true;
    }

    if (!validateTargetGroupName(name, groupId)) {
      return false;
    }

    const nextGroups = targetGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            name,
          }
        : group,
    );

    try {
      await updateTargetGroups(nextGroups);

      return true;
    } catch (error) {
      console.error("Failed to rename target group:", error);

      toast.error(LL.settingsPage.messages.renameTargetGroupFailed());

      return false;
    }
  };

  const removeTargetGroup = async (groupId: string) => {
    const nextGroups = targetGroups.filter((group) => group.id !== groupId);

    const nextCurrentId =
      currentTargetGroupId === groupId
        ? (nextGroups[0]?.id ?? null)
        : currentTargetGroupId;

    try {
      await updateTargetGroups(nextGroups, nextCurrentId);
    } catch (error) {
      console.error("Failed to remove target group:", error);

      toast.error(LL.settingsPage.messages.removeTargetGroupFailed());
    }
  };

  const addTargetPath = async (groupId: string, pathInput: string) => {
    const path = pathInput.trim();

    if (!path) return;

    const targetGroup = targetGroups.find((group) => group.id === groupId);

    if (!targetGroup) return;

    if (targetGroup.paths.includes(path)) {
      toast.error(LL.settingsPage.messages.duplicateTargetPath());

      return;
    }

    const nextGroups = targetGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            paths: [...group.paths, path],
          }
        : group,
    );

    try {
      await updateTargetGroups(nextGroups);
    } catch (error) {
      console.error("Failed to add target path:", error);

      toast.error(LL.settingsPage.messages.addTargetPathFailed());
    }
  };

  const updateTargetPath = async (
    groupId: string,
    oldPath: string,
    newPathInput: string,
  ): Promise<boolean> => {
    const newPath = newPathInput.trim();

    if (!newPath) {
      toast.error(LL.settingsPage.messages.emptyTargetPath());

      return false;
    }

    if (newPath === oldPath) {
      return true;
    }

    const targetGroup = targetGroups.find((group) => group.id === groupId);

    if (!targetGroup) {
      return false;
    }

    const duplicatePath = targetGroup.paths.some(
      (path) => path !== oldPath && path === newPath,
    );

    if (duplicatePath) {
      toast.error(LL.settingsPage.messages.duplicateTargetPath());

      return false;
    }

    const nextGroups = targetGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            paths: group.paths.map((path) =>
              path === oldPath ? newPath : path,
            ),
          }
        : group,
    );

    try {
      await updateTargetGroups(nextGroups);

      return true;
    } catch (error) {
      console.error("Failed to update target path:", error);

      toast.error(LL.settingsPage.messages.updateTargetPathFailed());

      return false;
    }
  };

  const removeTargetPath = async (groupId: string, path: string) => {
    const nextGroups = targetGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            paths: group.paths.filter((item) => item !== path),
          }
        : group,
    );

    try {
      await updateTargetGroups(nextGroups);
    } catch (error) {
      console.error("Failed to remove target path:", error);

      toast.error(LL.settingsPage.messages.removeTargetPathFailed());
    }
  };

  const changeTargetGroupActive = async (
    groupId: string,
    active: boolean,
  ) => {
    if (groupId === currentTargetGroupId && !active) {
      toast.error(LL.settingsPage.messages.currentTargetGroupMustBeActive());

      return;
    }

    const nextGroups = targetGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            active,
          }
        : group,
    );

    try {
      await updateTargetGroups(nextGroups);
    } catch (error) {
      console.error("Failed to update target group active state:", error);

      toast.error(LL.settingsPage.messages.updateTargetGroupActiveFailed());
    }
  };

  const makeCurrentTargetGroup = async (groupId: string) => {
    const nextGroups = targetGroups.map((group) =>
      group.id === groupId
        ? {
            ...group,
            active: true,
          }
        : group,
    );

    try {
      await updateTargetGroups(nextGroups, groupId);
    } catch (error) {
      console.error("Failed to switch current target group:", error);

      toast.error(LL.settingsPage.messages.makeCurrentTargetGroupFailed());
    }
  };

  const changeCompactListItems = (checked: boolean) => {
    onCompactListItemsChange(checked);

    if (saveUiTimerRef.current !== null) {
      window.clearTimeout(saveUiTimerRef.current);
    }

    saveUiTimerRef.current = window.setTimeout(async () => {
      try {
        const nextSettings = await settingsApi.set({
          ui: {
            compactListItems: checked,
          },
        });

        setSettings(nextSettings);
      } catch (error) {
        console.error("Failed to save UI settings:", error);
      }
    }, 500);
  };

  const changeLanguage = async (nextLanguage: Language) => {
    onLanguageChange(nextLanguage);

    try {
      const nextSettings = await settingsApi.set({
        ui: {
          language: nextLanguage,
        },
      });

      setSettings(nextSettings);
    } catch (error) {
      console.error("Failed to save language setting:", error);
    }
  };

  const changeCaptureSelectedTextOnActivation = async (checked: boolean) => {
    setSettings((current) =>
      current
        ? {
            ...current,
            experimental: {
              ...(current.experimental ?? DEFAULT_EXPERIMENTAL),
              captureSelectedTextOnActivation: checked,
            },
          }
        : current,
    );

    try {
      const nextSettings = await settingsApi.set({
        experimental: {
          captureSelectedTextOnActivation: checked,
        },
      });

      setSettings(nextSettings);
    } catch (error) {
      console.error("Failed to save experimental settings:", error);
    }
  };

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-text-main">
      <div className="mx-auto max-w-3xl">
        <AppearanceSettings
          themeId={themeId}
          themeOptions={themeOptions}
          onThemeChange={onThemeChange}
          onReloadThemes={onReloadThemes}
          onSettingsChange={setSettings}
        />

        <TargetGroupSettings
          targetGroups={targetGroups}
          currentTargetGroupId={currentTargetGroupId}
          targetGroupNameInput={targetGroupNameInput}
          onTargetGroupNameInputChange={setTargetGroupNameInput}
          onAddTargetGroup={addTargetGroup}
          onRenameTargetGroup={renameTargetGroup}
          onRemoveTargetGroup={removeTargetGroup}
          onAddTargetPath={addTargetPath}
          onUpdateTargetPath={updateTargetPath}
          onRemoveTargetPath={removeTargetPath}
          onTargetGroupActiveChange={changeTargetGroupActive}
          onMakeCurrentTargetGroup={makeCurrentTargetGroup}
        />

        <UiSettings
          compactListItems={compactListItems}
          language={language}
          onCompactListItemsChange={changeCompactListItems}
          onLanguageChange={changeLanguage}
        />

        <SecuritySettings
          commands={commands}
          whitelistInput={whitelistInput}
          blacklistInput={blacklistInput}
          onWhitelistInputChange={setWhitelistInput}
          onBlacklistInputChange={setBlacklistInput}
          onPolicyModeChange={changePolicyMode}
          onAddCommand={addCommand}
          onRemoveCommand={removeCommand}
        />

        <ExperimentalSettings
          captureSelectedTextOnActivation={
            experimental.captureSelectedTextOnActivation
          }
          onCaptureSelectedTextOnActivationChange={
            changeCaptureSelectedTextOnActivation
          }
        />

        <AdvancedSettings />
      </div>
    </div>
  );
};

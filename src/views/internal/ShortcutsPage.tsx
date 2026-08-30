import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { toast } from "@/utils/toast";

import { settingsApi } from "@/api/settings";
import {
  getInternalPageContributions,
  subscribeToPluginChanges,
} from "@/features/plugins/pluginRegistry";
import { useI18nContext } from "@/i18n/I18nProvider";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import {
  pluginActionPageShortcutAction,
  type AppSettings,
  type KeybindingMap,
  type KeybindingValue,
} from "@/types";
import type { ShortcutAction } from "@/types/shortcut";
import { Button } from "@/components/ui/button";

type ShortcutItem = {
  actionId: ShortcutAction;
  label: string;
  defaultShortcut: string;
};

type ShortcutGroup = {
  title: string;
  items: ShortcutItem[];
};

const MODIFIER_KEYS = new Set(["Control", "Shift", "Alt", "Meta"]);

const toShortcutArray = (value: KeybindingValue | undefined): string[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const fromShortcutArray = (values: string[]): KeybindingValue => {
  if (values.length === 0) return [];
  if (values.length === 1) return values[0];
  return values;
};

const normalizeKey = (key: string): string => {
  if (key === " ") return "Space";

  return key.length === 1 ? key.toUpperCase() : key;
};

const normalizeKeyboardShortcutKey = (
  e: React.KeyboardEvent<HTMLButtonElement>,
): string => {
  const digit = e.code.match(/^Digit(\d)$/)?.[1];

  if (digit) return digit;

  return normalizeKey(e.key);
};

const normalizeShortcutEvent = (
  e: React.KeyboardEvent<HTMLButtonElement>,
): string | null => {
  if (MODIFIER_KEYS.has(e.key)) return null;

  const parts: string[] = [];

  if (e.ctrlKey) parts.push("Ctrl");
  if (e.metaKey) parts.push("Meta");
  if (e.shiftKey && e.key !== ":") parts.push("Shift");
  if (e.altKey) parts.push("Alt");

  parts.push(normalizeKeyboardShortcutKey(e));

  return parts.join("+");
};

const getPluginActionPageShortcutItems = (): ShortcutItem[] =>
  getInternalPageContributions()
    .filter((contribution) => contribution.pageAction)
    .map((contribution) => ({
      actionId: pluginActionPageShortcutAction(contribution.id),
      defaultShortcut: "",
      label: contribution.title,
    }));

const getShortcutGroups = (
  LL: TranslationFunctions,
  pluginActionPageItems: ShortcutItem[],
): ShortcutGroup[] => [
  {
    title: LL.shortcutsPage.groups.search(),
    items: [
      {
        actionId: "focusSearch",
        defaultShortcut: "Ctrl+L",
        label: LL.shortcutsPage.actions.focusSearch(),
      },
      {
        actionId: "toggleHiddenFilter",
        defaultShortcut: "Ctrl+Shift+1",
        label: LL.shortcutsPage.actions.toggleHiddenFilter(),
      },
      {
        actionId: "toggleUnstarFilter",
        defaultShortcut: "",
        label: LL.shortcutsPage.actions.toggleUnstarFilter(),
      },
      {
        actionId: "toggleReverseSearch",
        defaultShortcut: "",
        label: LL.shortcutsPage.actions.toggleReverseSearch(),
      },
      {
        actionId: "toggleInternalFilter",
        defaultShortcut: "Ctrl+:",
        label: LL.shortcutsPage.actions.toggleInternalFilter(),
      },
      {
        actionId: "togglePluginPlaygroundFilter",
        defaultShortcut: "",
        label: LL.shortcutsPage.actions.togglePluginPlaygroundFilter(),
      },
      {
        actionId: "switchTargetGroup",
        defaultShortcut: "Ctrl+R",
        label: LL.shortcutsPage.actions.switchTargetGroup(),
      },
    ],
  },
  {
    title: LL.shortcutsPage.groups.navigation(),
    items: [
      {
        actionId: "selectNextItem",
        defaultShortcut: "ArrowDown",
        label: LL.shortcutsPage.actions.moveDown(),
      },
      {
        actionId: "selectPrevItem",
        defaultShortcut: "ArrowUp",
        label: LL.shortcutsPage.actions.moveUp(),
      },
      {
        actionId: "selectNextPage",
        defaultShortcut: "PageDown",
        label: LL.shortcutsPage.actions.moveDownPage(),
      },
      {
        actionId: "selectPrevPage",
        defaultShortcut: "PageUp",
        label: LL.shortcutsPage.actions.moveUpPage(),
      },
      {
        actionId: "openActiveItem",
        defaultShortcut: "Enter",
        label: LL.shortcutsPage.actions.openSelected(),
      },
      {
        actionId: "openActiveSourceFile",
        defaultShortcut: "Ctrl+E",
        label: LL.shortcutsPage.actions.openSourceFile(),
      },
      {
        actionId: "revealActiveSourceFile",
        defaultShortcut: "Ctrl+Shift+E",
        label: LL.shortcutsPage.actions.revealSourceDirectory(),
      },
    ],
  },
  {
    title: LL.shortcutsPage.groups.files(),
    items: [
      {
        actionId: "createFile",
        defaultShortcut: "Ctrl+N",
        label: LL.shortcutsPage.actions.createFile(),
      },
      {
        actionId: "openActiveFileEditor",
        defaultShortcut: "Ctrl+O",
        label: LL.shortcutsPage.actions.editActivePage(),
      },
    ],
  },
  {
    title: LL.shortcutsPage.groups.preview(),
    items: [
      {
        actionId: "scrollActivePreviewDown",
        defaultShortcut: "Ctrl+J",
        label: LL.shortcutsPage.actions.scrollPreviewDown(),
      },
      {
        actionId: "scrollActivePreviewUp",
        defaultShortcut: "Ctrl+K",
        label: LL.shortcutsPage.actions.scrollPreviewUp(),
      },
      {
        actionId: "pinActivePreview",
        defaultShortcut: "Ctrl+T",
        label: LL.shortcutsPage.actions.pinPreview(),
      },
      {
        actionId: "switchNextPreviewTab",
        defaultShortcut: "Ctrl+Tab",
        label: LL.shortcutsPage.actions.nextPreviewTab(),
      },
      {
        actionId: "switchPrevPreviewTab",
        defaultShortcut: "Ctrl+Shift+Tab",
        label: LL.shortcutsPage.actions.previousPreviewTab(),
      },
      {
        actionId: "closeActivePreviewTab",
        defaultShortcut: "Ctrl+W",
        label: LL.shortcutsPage.actions.closePreviewTab(),
      },
      {
        actionId: "closePreviewWindow",
        defaultShortcut: "Escape",
        label: LL.shortcutsPage.actions.closePreview(),
      },
      {
        actionId: "togglePreviewMode",
        defaultShortcut: "Alt+V",
        label: LL.shortcutsPage.actions.togglePreviewMode(),
      },
    ],
  },
  {
    title: LL.shortcutsPage.groups.codeCopy(),
    items: [
      {
        actionId: "copyActivePreviewCodeBlock1",
        defaultShortcut: "Ctrl+1",
        label: LL.shortcutsPage.actions.copyCodeBlock({ index: 1 }),
      },
      {
        actionId: "copyActivePreviewCodeBlock2",
        defaultShortcut: "Ctrl+2",
        label: LL.shortcutsPage.actions.copyCodeBlock({ index: 2 }),
      },
      {
        actionId: "copyActivePreviewCodeBlock3",
        defaultShortcut: "Ctrl+3",
        label: LL.shortcutsPage.actions.copyCodeBlock({ index: 3 }),
      },
      {
        actionId: "copyActivePreviewCodeBlock4",
        defaultShortcut: "Ctrl+4",
        label: LL.shortcutsPage.actions.copyCodeBlock({ index: 4 }),
      },
    ],
  },
  {
    title: LL.shortcutsPage.groups.view(),
    items: [
      {
        actionId: "toggleMainWindow",
        defaultShortcut: "Alt+Space",
        label: LL.shortcutsPage.actions.showHideWindow(),
      },
      {
        actionId: "togglePreviewLayout",
        defaultShortcut: "Ctrl+B",
        label: LL.shortcutsPage.actions.toggleSidebar(),
      },
      {
        actionId: "toggleLauncherLayout",
        defaultShortcut: "Ctrl+Shift+B",
        label: LL.shortcutsPage.actions.toggleCompactMode(),
      },
    ],
  },
  {
    title: LL.shortcutsPage.groups.internal(),
    items: [
      {
        actionId: "openItemHelp",
        defaultShortcut: "Ctrl+H",
        label: LL.shortcutsPage.actions.openHelp(),
      },
      {
        actionId: "openQueryInspector",
        defaultShortcut: "Ctrl+Alt+I",
        label: LL.shortcutsPage.actions.openQueryInspector(),
      },
      {
        actionId: "openCommandHistory",
        defaultShortcut: "",
        label: LL.commandHistoryPage.title(),
      },
      {
        actionId: "openDebugPage",
        defaultShortcut: "",
        label: LL.debugPage.title(),
      },
      {
        actionId: "openTagCloudPage",
        defaultShortcut: "",
        label: LL.tagCloudPage.title(),
      },
      {
        actionId: "inspectActiveItem",
        defaultShortcut: "",
        label: LL.previewPanel.inspectItem(),
      },
    ],
  },
  ...(pluginActionPageItems.length > 0
    ? [
        {
          title: LL.shortcutsPage.groups.plugin(),
          items: pluginActionPageItems,
        },
      ]
    : []),
];

export const ShortcutsPage = () => {
  const { LL } = useI18nContext();

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [draftKeybindings, setDraftKeybindings] = useState<KeybindingMap>({});
  const [pluginShortcutVersion, setPluginShortcutVersion] = useState(0);
  const [recordingActionId, setRecordingActionId] =
    useState<ShortcutAction | null>(null);
  const [updatingActionId, setUpdatingActionId] =
    useState<ShortcutAction | null>(null);

  const pluginActionPageItems = useMemo(
    () => getPluginActionPageShortcutItems(),
    [LL, pluginShortcutVersion],
  );

  const shortcutGroups = useMemo(
    () => getShortcutGroups(LL, pluginActionPageItems),
    [LL, pluginActionPageItems],
  );

  useEffect(() => {
    settingsApi.get().then((loaded) => {
      setSettings(loaded);
      setDraftKeybindings(loaded.keybindings ?? {});
    });
  }, []);

  useEffect(() => {
    return subscribeToPluginChanges(() => {
      setPluginShortcutVersion((version) => version + 1);
    });
  }, []);

  const persistKeybindings = async (
    next: KeybindingMap,
    previous: KeybindingMap,
    actionId: ShortcutAction,
  ) => {
    setUpdatingActionId(actionId);

    try {
      const updated = await settingsApi.set({
        keybindings: next,
      });

      setSettings(updated);
      setDraftKeybindings(updated.keybindings ?? {});
    } catch (error) {
      console.error(error);
      setDraftKeybindings(previous);
      toast.error(LL.shortcutsPage.messages.failedToUpdate());
    } finally {
      setUpdatingActionId(null);
    }
  };

  const addShortcut = async (actionId: ShortcutAction, value: string) => {
    const previous = draftKeybindings;
    const current = toShortcutArray(previous[actionId]);

    if (current.includes(value)) {
      return;
    }

    const next: KeybindingMap = {
      ...previous,
      [actionId]: fromShortcutArray([...current, value]),
    };

    setDraftKeybindings(next);
    await persistKeybindings(next, previous, actionId);
  };

  const removeShortcut = async (actionId: ShortcutAction, value: string) => {
    const previous = draftKeybindings;

    const nextValues = toShortcutArray(previous[actionId]).filter(
      (shortcut) => shortcut !== value,
    );

    const next: KeybindingMap = { ...previous };
    next[actionId] = fromShortcutArray(nextValues);

    setDraftKeybindings(next);
    await persistKeybindings(next, previous, actionId);
  };

  if (!settings) {
    return (
      <div className="h-full w-full p-6 text-sm text-text-muted">
        {LL.shortcutsPage.messages.loading()}
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-text-main">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{LL.shortcutsPage.title()}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {LL.shortcutsPage.subtitle()}
          </p>
        </header>

        <div className="space-y-6">
          {shortcutGroups.map((group) => (
            <section key={group.title}>
              <h2 className="mb-3 text-base font-semibold">{group.title}</h2>

              <table className="w-full text-sm">
                <tbody>
                  {group.items.map((item) => {
                    const bindings = toShortcutArray(
                      draftKeybindings[item.actionId],
                    );

                    const isRecording = recordingActionId === item.actionId;

                    const isUpdating = updatingActionId === item.actionId;

                    return (
                      <tr
                        key={`${group.title}-${item.actionId}`}
                        className="border-t border-border-main first:border-t-0"
                      >
                        <td className="w-56 py-3 pr-4 align-top text-text-muted">
                          {item.label}
                        </td>

                        <td className="py-3 align-top">
                          <div className="flex flex-wrap gap-1.5">
                            {bindings.length > 0 &&
                              bindings.map((binding) => (
                                <Button
                                  key={binding}
                                  type="button"
                                  disabled={isUpdating}
                                  onClick={() =>
                                    removeShortcut(item.actionId, binding)
                                  }
                                  className="inline-flex items-center gap-1 rounded border border-border-main px-2 py-1 font-mono text-xs disabled:opacity-50"
                                  variant="secondary"
                                  title={LL.shortcutsPage.messages.removeShortcut()}
                                >
                                  <span>{binding}</span>
                                  <X className="h-3 w-3" />
                                </Button>
                              ))}
                          </div>
                        </td>

                        <td className="w-16 py-3 pl-4 text-right align-top">
                          <Button
                            type="button"
                            autoFocus={isRecording}
                            disabled={isUpdating}
                            onClick={() => setRecordingActionId(item.actionId)}
                            onBlur={() => {
                              if (isRecording) {
                                setRecordingActionId(null);
                              }
                            }}
                            onKeyDown={async (e) => {
                              if (!isRecording) return;

                              e.preventDefault();
                              e.stopPropagation();

                              if (e.key === "Escape") {
                                setRecordingActionId(null);
                                e.currentTarget.blur();
                                return;
                              }

                              const shortcut = normalizeShortcutEvent(e);

                              if (!shortcut) return;

                              setRecordingActionId(null);
                              e.currentTarget.blur();

                              await addShortcut(item.actionId, shortcut);
                            }}
                            className="inline-flex h-8 w-8 items-center justify-center disabled:opacity-50"
                            variant="secondary"
                            title={
                              isRecording
                                ? LL.shortcutsPage.messages.pressShortcut()
                                : LL.shortcutsPage.messages.addShortcut()
                            }
                          >
                            {isRecording ? (
                              <span className="font-mono text-xs">...</span>
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
};

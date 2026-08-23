import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import { TargetGroup } from "@/types";
import { useI18nContext } from "@/i18n/I18nProvider";
import { settingsApi } from "@/api/settings";

import { CheckCircle2, FolderOpen, Trash2, X } from "lucide-react";

type Props = {
  group: TargetGroup;
  isCurrent: boolean;
  onActiveChange: (active: boolean) => void;
  onMakeCurrent: () => void;

  onRenameGroup: (name: string) => void;

  onAddPath: (path: string) => void;
  onUpdatePath: (oldPath: string, newPath: string) => void;
  onRemovePath: (path: string) => void;

  onRemoveGroup: () => void;
};

export const TargetGroupCard = ({
  group,
  isCurrent,
  onActiveChange,
  onMakeCurrent,
  onRenameGroup,
  onAddPath,
  onUpdatePath,
  onRemovePath,
  onRemoveGroup,
}: Props) => {
  const { LL } = useI18nContext();
  const [nameInput, setNameInput] = useState(group.name);
  const [pathInput, setPathInput] = useState("");
  const [pathInputs, setPathInputs] = useState<Record<string, string>>(() =>
    Object.fromEntries(group.paths.map((path) => [path, path])),
  );

  useEffect(() => {
    setNameInput(group.name);
  }, [group.name]);

  useEffect(() => {
    setPathInputs(Object.fromEntries(group.paths.map((path) => [path, path])));
  }, [group.paths]);

  const handleRenameGroup = () => {
    const name = nameInput.trim();

    if (!name) {
      setNameInput(group.name);
      return;
    }

    if (name === group.name) {
      setNameInput(group.name);
      return;
    }

    onRenameGroup(name);
  };

  const handleAddPath = () => {
    const path = pathInput.trim();

    if (!path) return;

    if (group.paths.includes(path)) {
      return;
    }

    onAddPath(path);
    setPathInput("");
  };

  const handleSelectPath = async () => {
    try {
      const selectedPath = await settingsApi.selectTargetDirectory();

      if (!selectedPath) return;

      onAddPath(selectedPath);
      setPathInput("");
    } catch (error) {
      console.error("Failed to select target directory:", error);
    }
  };

  const handleUpdatePath = (oldPath: string) => {
    const newPath = pathInputs[oldPath]?.trim() ?? "";

    if (!newPath) {
      setPathInputs((current) => ({
        ...current,
        [oldPath]: oldPath,
      }));
      return;
    }

    if (newPath === oldPath) {
      setPathInputs((current) => ({
        ...current,
        [oldPath]: oldPath,
      }));
      return;
    }

    if (group.paths.includes(newPath)) {
      setPathInputs((current) => ({
        ...current,
        [oldPath]: oldPath,
      }));
      return;
    }

    onUpdatePath(oldPath, newPath);
  };

  const resetPathInput = (path: string) => {
    setPathInputs((current) => ({
      ...current,
      [path]: path,
    }));
  };

  return (
    <div className="rounded-lg border border-border-main bg-main-bg p-4">
      <div className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <Input
            value={nameInput}
            onChange={(event) => setNameInput(event.target.value)}
            onBlur={handleRenameGroup}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
                return;
              }

              if (event.key === "Escape") {
                event.preventDefault();
                setNameInput(group.name);
                event.currentTarget.blur();
              }
            }}
            aria-label={LL.settingsPage.targetGroups.targetGroupName()}
            className="
              h-8
              border-transparent
              bg-transparent
              px-0
              text-sm font-semibold
              hover:border-border-main
              focus-visible:border-border-main
            "
          />

          <p className="mt-1 truncate text-xs text-text-muted">{group.id}</p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
          {isCurrent && (
            <span
              className="
                rounded-full
                border border-accent
                px-2 py-1
                text-xs font-medium
                text-accent
              "
            >
              {LL.settingsPage.targetGroups.current()}
            </span>
          )}

          <div className="flex h-8 items-center gap-2 rounded-md border border-border-main px-2">
            <span className="text-xs text-text-muted">
              {group.active
                ? LL.settingsPage.targetGroups.active()
                : LL.settingsPage.targetGroups.inactive()}
            </span>
            <Switch
              size="sm"
              checked={group.active}
              disabled={isCurrent}
              onCheckedChange={onActiveChange}
              aria-label={LL.settingsPage.targetGroups.activeToggle({
                name: group.name,
              })}
            />
          </div>

          {!isCurrent && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onMakeCurrent}
              className="h-8"
            >
              <CheckCircle2 className="h-4 w-4" />
              {LL.settingsPage.targetGroups.makeCurrent()}
            </Button>
          )}

          <Button
            type="button"
            variant="ghost"
            size="icon"
            onClick={onRemoveGroup}
            className="h-8 w-8 text-text-muted hover:bg-item-hover"
            aria-label={LL.settingsPage.targetGroups.removeTargetGroup()}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div className="mb-4 flex gap-2 px-3">
        <Input
          value={pathInput}
          onChange={(event) => setPathInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;

            event.preventDefault();
            handleAddPath();
          }}
          placeholder={LL.settingsPage.targetGroups.addPathPlaceholder()}
          className="
            flex-1
            rounded-md
            border border-border-main
            bg-main-bg
            px-3 py-2
            text-sm text-text-main
          "
        />

        <Button
          type="button"
          size="icon"
          variant="outline"
          onClick={() => {
            void handleSelectPath();
          }}
          aria-label={LL.settingsPage.targetGroups.addPath()}
          title={LL.settingsPage.targetGroups.addPath()}
        >
          <FolderOpen className="h-4 w-4" />
        </Button>
      </div>

      {group.paths.length === 0 ? (
        <p className="text-xs text-text-muted">
          {LL.settingsPage.targetGroups.noPaths()}
        </p>
      ) : (
        <ul className="space-y-1">
          {group.paths.map((path) => (
            <li key={path} className="flex items-center gap-2 px-3 py-1">
              <Input
                value={pathInputs[path] ?? path}
                onChange={(event) => {
                  const value = event.target.value;

                  setPathInputs((current) => ({
                    ...current,
                    [path]: value,
                  }));
                }}
                onBlur={() => handleUpdatePath(path)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                    return;
                  }

                  if (event.key === "Escape") {
                    event.preventDefault();
                    resetPathInput(path);
                    event.currentTarget.blur();
                  }
                }}
                aria-label={LL.settingsPage.targetGroups.pathFor({
                  name: group.name,
                })}
                className="
                  h-8 min-w-0 flex-1
                  border-transparent
                  bg-transparent
                  font-mono text-sm
                  hover:border-border-main
                  focus-visible:border-border-main
                "
              />

              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => onRemovePath(path)}
                className="
                  h-8 w-8 shrink-0
                  text-text-muted
                  hover:bg-item-hover
                "
                aria-label={LL.settingsPage.targetGroups.removePath()}
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

import { TargetGroup } from "@/types";
import { useI18nContext } from "@/i18n/I18nProvider";

import { SettingsSection } from "./components/SettingsSection";
import { TargetGroupCard } from "./components/TargetGroupCard";

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type Props = {
  targetGroups: TargetGroup[];
  currentTargetGroupId: string | null;

  targetGroupNameInput: string;

  onTargetGroupNameInputChange: (value: string) => void;

  onAddTargetGroup: () => void;
  onRenameTargetGroup: (
    groupId: string,
    name: string,
  ) => void;
  onRemoveTargetGroup: (groupId: string) => void;

  onAddTargetPath: (
    groupId: string,
    path: string,
  ) => void;
  onUpdateTargetPath: (
    groupId: string,
    oldPath: string,
    newPath: string,
  ) => void;
  onRemoveTargetPath: (
    groupId: string,
    path: string,
  ) => void;
  onTargetGroupActiveChange: (groupId: string, active: boolean) => void;
  onMakeCurrentTargetGroup: (groupId: string) => void;
};

export const TargetGroupSettings = ({
  targetGroups,
  currentTargetGroupId,

  targetGroupNameInput,
  onTargetGroupNameInputChange,

  onAddTargetGroup,
  onRenameTargetGroup,
  onRemoveTargetGroup,

  onAddTargetPath,
  onUpdateTargetPath,
  onRemoveTargetPath,
  onTargetGroupActiveChange,
  onMakeCurrentTargetGroup,
}: Props) => {
  const { LL } = useI18nContext();

  return (
    <SettingsSection
      title={LL.settingsPage.targetGroups.title()}
      description={LL.settingsPage.targetGroups.description()}
    >
      <div className="space-y-4">
        <h3 className="text-sm font-semibold">
          {LL.settingsPage.targetGroups.create()}
        </h3>

        <div className="flex items-center gap-2">
          <Input
            value={targetGroupNameInput}
            onChange={(event) =>
              onTargetGroupNameInputChange(event.target.value)
            }
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;

              event.preventDefault();
              onAddTargetGroup();
            }}
            placeholder="Work"
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
            onClick={onAddTargetGroup}
          >
            {LL.settingsPage.targetGroups.addGroup()}
          </Button>
        </div>

        <h3 className="pt-2 text-sm font-semibold">
          {LL.settingsPage.targetGroups.edit()}
        </h3>

        {targetGroups.length === 0 ? (
          <p className="text-xs text-text-muted">
            {LL.settingsPage.targetGroups.addHint()}
          </p>
        ) : (
          <div className="space-y-4">
            {targetGroups.map((group) => (
              <TargetGroupCard
                key={group.id}
                group={group}
                isCurrent={group.id === currentTargetGroupId}
                onActiveChange={(active) =>
                  onTargetGroupActiveChange(group.id, active)
                }
                onMakeCurrent={() =>
                  onMakeCurrentTargetGroup(group.id)
                }
                onRenameGroup={(name) =>
                  onRenameTargetGroup(group.id, name)
                }
                onAddPath={(path) =>
                  onAddTargetPath(group.id, path)
                }
                onUpdatePath={(oldPath, newPath) =>
                  onUpdateTargetPath(
                    group.id,
                    oldPath,
                    newPath,
                  )
                }
                onRemovePath={(path) =>
                  onRemoveTargetPath(group.id, path)
                }
                onRemoveGroup={() =>
                  onRemoveTargetGroup(group.id)
                }
              />
            ))}
          </div>
        )}
      </div>
    </SettingsSection>
  );
};

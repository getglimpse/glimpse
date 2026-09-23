import { settingsApi } from "@/api/settings";
import { useI18nContext } from "@/i18n/I18nProvider";
import { toast } from "@/utils/toast";

import { SettingsSection } from "./components/SettingsSection";

export const AdvancedSettings = ({
  backupAvailable,
  restoring,
  onRestore,
}: {
  backupAvailable: boolean;
  restoring: boolean;
  onRestore: () => void;
}) => {
  const { LL } = useI18nContext();

  return (
    <SettingsSection
      title={LL.settingsPage.advanced.title()}
      description={LL.settingsPage.advanced.description()}
    >
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void settingsApi
              .openFile()
              .catch((error) => toast.error(String(error)))
          }
          className="rounded-md border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-item-hover"
        >
          {LL.settingsPage.advanced.openSettings()}
        </button>
        <button
          type="button"
          onClick={onRestore}
          disabled={!backupAvailable || restoring}
          className="rounded-md border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-item-hover disabled:opacity-50"
        >
          {LL.settingsPage.advanced.restoreBackup()}
        </button>
      </div>
    </SettingsSection>
  );
};

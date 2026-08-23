import { settingsApi } from "@/api/settings";
import { useI18nContext } from "@/i18n/I18nProvider";

import { SettingsSection } from "./components/SettingsSection";

export const AdvancedSettings = () => {
  const { LL } = useI18nContext();

  return (
    <SettingsSection
      title={LL.settingsPage.advanced.title()}
      description={LL.settingsPage.advanced.description()}
    >
      <button
        type="button"
        onClick={() => settingsApi.openFile()}
        className="rounded-md border border-border-main px-3 py-2 text-sm text-text-muted hover:bg-item-hover"
      >
        {LL.settingsPage.advanced.openSettings()}
      </button>
    </SettingsSection>
  );
};
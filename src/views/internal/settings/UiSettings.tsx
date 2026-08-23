import { Switch } from "@/components/ui/switch";

import { Language } from "@/types";
import { useI18nContext } from "@/i18n/I18nProvider";

import { SettingsSection } from "./components/SettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  compactListItems: boolean;
  language: Language;
  onCompactListItemsChange: (checked: boolean) => void;
  onLanguageChange: (language: Language) => void;
};

export const UiSettings = ({
  compactListItems,
  language,
  onCompactListItemsChange,
  onLanguageChange,
}: Props) => {
  const { LL } = useI18nContext();

  return (
    <SettingsSection
      title={LL.settingsPage.ui.title()}
      description={LL.settingsPage.ui.description()}
    >
      <div className="py-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">
              {LL.settingsPage.ui.compactListItems()}
            </h3>

            <p className="mt-1 text-xs text-text-muted">
              {LL.settingsPage.ui.compactListItemsDescription()}
            </p>
          </div>

          <Switch
            checked={compactListItems}
            onCheckedChange={onCompactListItemsChange}
          />
        </div>
      </div>

      <div className="mt-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">
            {LL.settingsPage.ui.language()}
          </h3>

          <p className="mt-1 text-xs text-text-muted">
            {LL.settingsPage.ui.languageDescription()}
          </p>
        </div>

        <Select
          value={language}
          onValueChange={(value) => onLanguageChange(value as Language)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="ja">日本語</SelectItem>
            <SelectItem value="en">English</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </SettingsSection>
  );
};
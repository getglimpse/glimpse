import { Switch } from "@/components/ui/switch";
import { useI18nContext } from "@/i18n/I18nProvider";

import { SettingsSection } from "./components/SettingsSection";

type Props = {
  captureSelectedTextOnActivation: boolean;
  onCaptureSelectedTextOnActivationChange: (checked: boolean) => void;
};

export const ExperimentalSettings = ({
  captureSelectedTextOnActivation,
  onCaptureSelectedTextOnActivationChange,
}: Props) => {
  const { LL } = useI18nContext();

  return (
    <SettingsSection
      title={LL.settingsPage.experimental.title()}
      description={LL.settingsPage.experimental.description()}
    >
      <div className="py-2">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">
              {LL.settingsPage.experimental.captureSelectedTextOnActivation()}
            </h3>

            <p className="mt-1 text-xs text-text-muted">
              {LL.settingsPage.experimental.captureSelectedTextOnActivationDescription()}
            </p>
          </div>

          <Switch
            checked={captureSelectedTextOnActivation}
            onCheckedChange={onCaptureSelectedTextOnActivationChange}
          />
        </div>
      </div>
    </SettingsSection>
  );
};

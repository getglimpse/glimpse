import { CommandPolicyMode, CommandSettings } from "@/types";
import { useI18nContext } from "@/i18n/I18nProvider";

import { CommandList } from "./components/CommandList";
import { SettingsSection } from "./components/SettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

type Props = {
  commands: CommandSettings;
  whitelistInput: string;
  blacklistInput: string;
  onWhitelistInputChange: (value: string) => void;
  onBlacklistInputChange: (value: string) => void;
  onPolicyModeChange: (policyMode: CommandPolicyMode) => void;
  onAddCommand: (list: "whitelist" | "blacklist") => void;
  onRemoveCommand: (
    list: "whitelist" | "blacklist",
    command: string,
  ) => void;
};

export const SecuritySettings = ({
  commands,
  whitelistInput,
  blacklistInput,
  onWhitelistInputChange,
  onBlacklistInputChange,
  onPolicyModeChange,
  onAddCommand,
  onRemoveCommand,
}: Props) => {
  const { LL } = useI18nContext();

  return (
    <SettingsSection
      title={LL.settingsPage.security.title()}
      description={LL.settingsPage.security.description()}
    >
      <div className="mb-5 py-4">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">
              {LL.settingsPage.security.commandPolicy()}
            </h3>

            <p className="mt-1 text-xs text-text-muted">
              {LL.settingsPage.security.commandPolicyDescription()}
            </p>
          </div>

          <span className="rounded-full border border-border-main px-2 py-1 text-xs text-text-muted">
            {commands.policyMode}
          </span>
        </div>

        <Select
          value={commands.policyMode}
          onValueChange={(value) => onPolicyModeChange(value as CommandPolicyMode)}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          
          <SelectContent>
            <SelectItem value="none">None</SelectItem>
            <SelectItem value="whitelist">Whitelist</SelectItem>
            <SelectItem value="blacklist">Blacklist</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-4">
        <CommandList
          title={LL.settingsPage.security.whitelistCommands()}
          description={LL.settingsPage.security.whitelistDescription()}
          addLabel={LL.settingsPage.security.add()}
          commands={commands.whitelist}
          inputValue={whitelistInput}
          onInputChange={onWhitelistInputChange}
          placeholder="python3"
          onAdd={() => onAddCommand("whitelist")}
          onRemove={(command) => onRemoveCommand("whitelist", command)}
        />

        <CommandList
          title={LL.settingsPage.security.blacklistCommands()}
          description={LL.settingsPage.security.blacklistDescription()}
          addLabel={LL.settingsPage.security.add()}
          commands={commands.blacklist}
          inputValue={blacklistInput}
          onInputChange={onBlacklistInputChange}
          placeholder="rm"
          onAdd={() => onAddCommand("blacklist")}
          onRemove={(command) => onRemoveCommand("blacklist", command)}
        />
      </div>
    </SettingsSection>
  );
};
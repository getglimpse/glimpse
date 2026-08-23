import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useI18nContext } from "@/i18n/I18nProvider";

type Props = {
  title: string;
  description: string;
  commands: string[];

  inputValue: string;
  onInputChange: (value: string) => void;

  placeholder: string;
  addLabel: string;

  onAdd: () => void;
  onRemove: (command: string) => void;
};

export const CommandList = ({
  title,
  description,
  commands,
  inputValue,
  onInputChange,
  placeholder,
  addLabel,
  onAdd,
  onRemove,
}: Props) => {
  const { LL } = useI18nContext();

  return (
    <div className="py-4">
      <h3 className="text-sm font-semibold">{title}</h3>

      <p className="mb-3 mt-1 text-xs text-text-muted">{description}</p>

      <div className="mb-4 flex gap-2">
        <Input
          value={inputValue}
          onChange={(event) => onInputChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;

            event.preventDefault();
            onAdd();
          }}
          placeholder={placeholder}
          className="flex-1"
        />

        <Button
          type="button"
          variant="outline"
          size="icon"
          onClick={onAdd}
          aria-label={addLabel}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {commands.length === 0 ? (
        <p className="text-xs text-text-muted">
          {LL.settingsPage.security.noCommands()}
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {commands.map((command) => (
            <Button
              key={command}
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => onRemove(command)}
              className="h-8 rounded-full gap-2 px-3"
            >
              <span>{command}</span>
              <X className="h-3 w-3" />
            </Button>
          ))}
        </div>
      )}
    </div>
  );
};

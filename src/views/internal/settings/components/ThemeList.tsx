import { useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useI18nContext } from "@/i18n/I18nProvider";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";

export type ThemeOption = {
  id: string;
  name: string;
  source: "built-in" | "custom";
};

type Props = {
  themes: ThemeOption[];
  themeId: string;
  emptyText?: string;
  onSelect: (themeId: string) => void;
};

export const ThemeList = ({
  themes,
  themeId,
  emptyText = "No themes",
  onSelect,
}: Props) => {
  const { LL } = useI18nContext();
  const [open, setOpen] = useState(false);
  const committedThemeIdRef = useRef(themeId);
  const confirmedRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const selectedOption = themes.find((option) => option.id === themeId) ?? null;

  const confirmTheme = (nextThemeId: string) => {
    confirmedRef.current = true;
    committedThemeIdRef.current = nextThemeId;
    onSelect(nextThemeId);
    setOpen(false);

    requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  };

  return (
    <div className="space-y-2">
      {themes.length === 0 ? (
        <p className="text-xs text-text-muted">{emptyText}</p>
      ) : (
        <Popover
          open={open}
          onOpenChange={(nextOpen) => {
            if (nextOpen) {
              committedThemeIdRef.current = themeId;
              confirmedRef.current = false;
              setOpen(true);
              return;
            }

            setOpen(false);

            if (!confirmedRef.current) {
              onSelect(committedThemeIdRef.current);
            }
          }}
        >
          <PopoverTrigger asChild>
            <Button
              ref={triggerRef}
              type="button"
              className="flex h-auto w-full items-center justify-between rounded-md border border-border-main bg-main-bg px-3 py-2 text-left hover:bg-item-hover"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text-main">
                  {selectedOption?.name ??
                    LL.settingsPage.appearance.selectTheme()}
                </div>

                <div className="truncate text-xs text-text-muted">
                  {selectedOption
                    ? `${selectedOption.id} · ${
                        selectedOption.source === "built-in"
                          ? LL.settingsPage.appearance.builtInTheme()
                          : LL.settingsPage.appearance.customTheme()
                      }`
                    : LL.settingsPage.appearance.noThemeSelected()}
                </div>
              </div>

              <ChevronsUpDown className="ml-3 h-4 w-4 shrink-0 text-text-muted" />
            </Button>
          </PopoverTrigger>

          <PopoverContent
            className="w-[var(--radix-popover-trigger-width)] overflow-hidden border-border-main bg-main-bg p-0 text-text-main"
            onKeyDown={(event) => {
              event.stopPropagation();
            }}
          >
            <Command value={themeId} onValueChange={onSelect}>
              <CommandInput
                placeholder={LL.settingsPage.appearance.searchTheme()}
              />

              <CommandList>
                <CommandEmpty>
                  {LL.settingsPage.appearance.noThemesFound()}
                </CommandEmpty>

                <CommandGroup>
                  {themes.map((option) => {
                    const isSelected = option.id === themeId;

                    return (
                      <CommandItem
                        key={`${option.source}:${option.id}`}
                        value={option.id}
                        onSelect={() => confirmTheme(option.id)}
                      >
                        <div className="flex w-full items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2">
                            <Check
                              className={`h-4 w-4 shrink-0 ${
                                isSelected ? "opacity-100" : "opacity-0"
                              }`}
                            />

                            <div className="min-w-0">
                              <div className="truncate text-sm">
                                {option.name}
                              </div>
                              <div className="truncate text-xs text-text-muted">
                                {option.id}
                              </div>
                            </div>
                          </div>

                          <span className="shrink-0 rounded border border-border-main px-2 py-0.5 text-xs text-text-muted">
                            {option.source === "built-in"
                              ? LL.settingsPage.appearance.builtInTheme()
                              : LL.settingsPage.appearance.customTheme()}
                          </span>
                        </div>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
};

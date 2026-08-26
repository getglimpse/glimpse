import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { GjsonCardItem } from "@/types";
import { createEmptyGjsonCardItem } from "@/utils/gjsonEditor";

type Props = {
  items: GjsonCardItem[];
  disabled?: boolean;
  onChange: (items: GjsonCardItem[]) => void;
};

const updateItem = (
  items: GjsonCardItem[],
  id: string,
  patch: Partial<GjsonCardItem>,
) => items.map((item) => (item.id === id ? { ...item, ...patch } : item));

export const GjsonCardEditor = ({ items, disabled, onChange }: Props) => {
  const [collapsedItemIds, setCollapsedItemIds] = useState<Set<string>>(
    () => new Set(),
  );

  const toggleCollapsed = (id: string) => {
    setCollapsedItemIds((current) => {
      const next = new Set(current);

      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }

      return next;
    });
  };

  const addItem = () => {
    onChange([...items, createEmptyGjsonCardItem()]);
  };

  const removeItem = (id: string) => {
    setCollapsedItemIds((current) => {
      const next = new Set(current);
      next.delete(id);

      return next;
    });

    if (items.length <= 1) {
      onChange([createEmptyGjsonCardItem()]);
      return;
    }

    onChange(items.filter((item) => item.id !== id));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-text-main">items</span>
        <Button
          type="button"
          onClick={addItem}
          disabled={disabled}
          className="h-8 rounded-md border border-border-main px-2 text-xs"
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Add item
        </Button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">
        {items.map((item) => {
          const collapsed = collapsedItemIds.has(item.id);
          const CardChevron = collapsed ? ChevronRight : ChevronDown;
          const itemTitle = item.title.trim();

          return (
            <section
              key={item.id}
              className="rounded-md border border-border-main bg-app-bg p-3"
            >
              <div
                className={
                  collapsed
                    ? "flex items-center justify-between gap-3"
                    : "mb-3 flex items-center justify-between gap-3"
                }
              >
                <button
                  type="button"
                  onClick={() => toggleCollapsed(item.id)}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md text-left text-text-main hover:text-accent"
                  aria-expanded={!collapsed}
                >
                  <CardChevron className="h-4 w-4 shrink-0 text-text-muted" />
                  <span className="truncate text-sm font-semibold">
                    {itemTitle || "Untitled"}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => removeItem(item.id)}
                  disabled={disabled}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-item-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
                  title="Remove item"
                  tabIndex={-1}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {!collapsed && (
                <div
                  className="grid gap-x-5 gap-y-3"
                  style={{
                    gridTemplateColumns:
                      "repeat(auto-fit, minmax(min(100%, 28rem), 1fr))",
                  }}
                >
                  <TextField
                    label="title"
                    value={item.title}
                    required
                    disabled={disabled}
                    onChange={(title) =>
                      onChange(updateItem(items, item.id, { title }))
                    }
                  />
                  <TextField
                    label="url"
                    value={item.url}
                    disabled={disabled}
                    onChange={(url) =>
                      onChange(updateItem(items, item.id, { url }))
                    }
                  />
                  <TextField
                    label="desc"
                    value={item.desc}
                    disabled={disabled}
                    onChange={(desc) =>
                      onChange(updateItem(items, item.id, { desc }))
                    }
                  />
                  <TextField
                    label="command"
                    value={item.command}
                    disabled={disabled}
                    onChange={(command) =>
                      onChange(updateItem(items, item.id, { command }))
                    }
                  />
                  <TextField
                    label="tags"
                    value={item.tags}
                    placeholder="rust, docs"
                    disabled={disabled}
                    onChange={(tags) =>
                      onChange(updateItem(items, item.id, { tags }))
                    }
                  />
                  <TextField
                    label="aliases"
                    value={item.aliases}
                    placeholder="book, rustbook"
                    disabled={disabled}
                    onChange={(aliases) =>
                      onChange(updateItem(items, item.id, { aliases }))
                    }
                  />
                  <SelectField
                    label="defaultAction"
                    value={item.defaultAction}
                    disabled={disabled}
                    onChange={(defaultAction) =>
                      onChange(updateItem(items, item.id, { defaultAction }))
                    }
                  />
                  <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 pt-6 text-sm text-text-muted">
                    <CheckboxField
                      label="star"
                      checked={item.star}
                      disabled={disabled}
                      onChange={(star) =>
                        onChange(updateItem(items, item.id, { star }))
                      }
                    />
                    <CheckboxField
                      label="hidden"
                      checked={item.hidden}
                      disabled={disabled}
                      onChange={(hidden) =>
                        onChange(updateItem(items, item.id, { hidden }))
                      }
                    />
                    <CheckboxField
                      label="iframe"
                      checked={item.iframe}
                      disabled={disabled}
                      onChange={(iframe) =>
                        onChange(updateItem(items, item.id, { iframe }))
                      }
                    />
                  </div>
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
};

type TextFieldProps = {
  label: string;
  value: string;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
};

const TextField = ({
  label,
  value,
  required,
  placeholder,
  disabled,
  onChange,
}: TextFieldProps) => (
  <label className="flex min-w-0 flex-col gap-2 text-sm">
    <span className="truncate font-medium text-text-main">
      {label}
      {required ? " *" : ""}
    </span>
    <input
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={disabled}
      placeholder={placeholder}
      className="h-9 rounded-md border border-border bg-glass-bg px-3 text-sm text-text-main outline-none placeholder:text-placeholder focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
    />
  </label>
);

type SelectFieldProps = {
  label: string;
  value: "" | "command" | "url";
  disabled?: boolean;
  onChange: (value: "" | "command" | "url") => void;
};

const SelectField = ({
  label,
  value,
  disabled,
  onChange,
}: SelectFieldProps) => (
  <label className="flex min-w-0 flex-col gap-2 text-sm">
    <span className="truncate font-medium text-text-main">{label}</span>
    <select
      value={value}
      disabled={disabled}
      onChange={(event) =>
        onChange(event.target.value as "" | "command" | "url")
      }
      className="h-9 min-w-0 rounded-md border border-border bg-glass-bg px-3 text-sm text-text-main outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
    >
      <option value="">auto</option>
      <option value="command">command</option>
      <option value="url">url</option>
    </select>
  </label>
);

type CheckboxFieldProps = {
  label: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
};

const CheckboxField = ({
  label,
  checked,
  disabled,
  onChange,
}: CheckboxFieldProps) => (
  <label className="inline-flex h-9 items-center gap-2">
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(event) => onChange(event.target.checked)}
      className="h-4 w-4 accent-accent disabled:cursor-not-allowed"
    />
    <span>{label}</span>
  </label>
);

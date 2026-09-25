import type { PluginFormField, PluginFormFieldOption } from "@/types";

export const PluginFormFieldControl = ({
  field,
  value,
  onChange,
}: {
  field: PluginFormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  const inputId = `plugin-form-${field.id}`;
  const label = field.label ?? field.labelFallback ?? field.id;
  const description = field.description ?? field.descriptionFallback;
  const isCheckbox = field.type === "boolean" || field.control === "checkbox";

  if (isCheckbox) {
    return (
      <label
        htmlFor={inputId}
        className="flex min-h-full cursor-pointer items-start gap-2 rounded border border-border-main/60 bg-main-bg px-2 py-1.5 hover:border-accent"
      >
        <PluginFormInput
          id={inputId}
          field={field}
          value={value}
          onChange={onChange}
        />
        <span className="min-w-0">
          <span className="block text-sm font-medium text-text-main">
            {label}
          </span>
          {description && (
            <span className="block text-xs leading-4 text-text-muted">
              {description}
            </span>
          )}
        </span>
      </label>
    );
  }

  return (
    <label
      htmlFor={inputId}
      className="block space-y-0.5 @min-[420px]:col-span-2"
    >
      <div className="text-sm font-medium text-text-main">{label}</div>
      {description && (
        <div className="text-xs text-text-muted">{description}</div>
      )}
      <PluginFormInput
        id={inputId}
        field={field}
        value={value}
        onChange={onChange}
      />
    </label>
  );
};

const PluginFormInput = ({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: PluginFormField;
  value: unknown;
  onChange: (value: unknown) => void;
}) => {
  if (field.type === "boolean" || field.control === "checkbox") {
    return (
      <input
        id={id}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 accent-[var(--accent)]"
      />
    );
  }

  if (field.type === "enum") {
    if (field.control === "segmented") {
      return (
        <div id={id} className="inline-flex border border-border-main">
          {(field.options ?? []).map((option) => (
            <button
              key={String(option.value)}
              type="button"
              onClick={() => onChange(option.value)}
              className={`px-3 py-1.5 text-xs ${
                value === option.value
                  ? "bg-accent text-white"
                  : "bg-main-bg text-text-muted hover:text-text-main"
              }`}
            >
              {getFormOptionLabel(option)}
            </button>
          ))}
        </div>
      );
    }

    return (
      <select
        id={id}
        value={String(value ?? "")}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded border border-border-main bg-main-bg px-2 py-1 text-sm text-text-main outline-none focus:border-accent"
      >
        {(field.options ?? []).map((option) => (
          <option key={String(option.value)} value={String(option.value)}>
            {getFormOptionLabel(option)}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "number" || field.control === "slider") {
    const inputType = field.control === "slider" ? "range" : "number";
    const numericValue =
      typeof value === "number"
        ? value
        : Number(field.default ?? field.min ?? 0);

    return (
      <div className="flex items-center gap-3">
        <input
          id={id}
          type={inputType}
          min={field.min}
          max={field.max}
          step={field.step}
          value={numericValue}
          onChange={(event) => onChange(Number(event.target.value))}
          className={`rounded border border-border-main bg-main-bg px-2 py-1 text-sm text-text-main outline-none focus:border-accent ${
            inputType === "range" ? "min-w-0 flex-1" : "w-28"
          }`}
        />
        {inputType === "range" && (
          <span className="w-12 text-right font-mono text-xs text-text-muted">
            {numericValue}
          </span>
        )}
      </div>
    );
  }

  return (
    <input
      id={id}
      type="text"
      value={typeof value === "string" ? value : ""}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded border border-border-main bg-main-bg px-2 py-1 text-sm text-text-main outline-none focus:border-accent"
    />
  );
};

export const getDefaultFormFieldValue = (field: PluginFormField): unknown => {
  if (field.type === "boolean") {
    return false;
  }

  if (field.type === "number") {
    return field.min ?? 0;
  }

  if (field.type === "enum") {
    return field.options?.[0]?.value ?? "";
  }

  return "";
};

const getFormOptionLabel = (option: PluginFormFieldOption): string =>
  option.label ?? option.labelFallback ?? String(option.value);

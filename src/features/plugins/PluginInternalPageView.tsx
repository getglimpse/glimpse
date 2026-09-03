import {
  Component,
  createElement,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import type {
  GlimpsePlugin,
  PluginFormField,
  PluginFormFieldOption,
  PluginFormTab,
  PluginInternalPageManifest,
  PluginPageTab,
  PluginStaticPageSection,
} from "@/types";

import { invokePluginAction } from "./pluginComponents";
import {
  getPluginRuntime,
  getPluginRuntimeSnapshot,
  type PluginRuntimeSnapshot,
  subscribeToPluginRuntimeChanges,
} from "./pluginRuntime";

export const PluginInternalPageView = ({
  page,
  plugin,
  pluginId,
}: {
  page: PluginInternalPageManifest;
  plugin?: GlimpsePlugin;
  pluginId: string;
}) => {
  const [, forceRuntimeUpdate] = useState(0);
  const runtime = getPluginRuntime(pluginId);
  const runtimeSnapshot = getPluginRuntimeSnapshot(pluginId);
  const { dynamicPage, renderError } = renderPluginPage(page, runtime, plugin);

  useEffect(
    () =>
      subscribeToPluginRuntimeChanges(() => {
        forceRuntimeUpdate((previous) => previous + 1);
      }),
    [],
  );

  return (
    <div
      className="h-full w-full overflow-hidden px-6 pt-3 pb-6 text-sm text-text-main select-text"
      data-glimpse-plugin-page={pluginId}
    >
      <div className="mx-auto flex h-full min-h-0 max-w-3xl flex-col">
        {page.staticPage?.subtitle && !dynamicPage && (
          <p className="mb-6 shrink-0 text-sm text-text-muted">
            {page.staticPage.subtitle}
          </p>
        )}

        <div
          className={`min-h-0 flex-1 ${
            dynamicPage ? "overflow-hidden" : "overflow-y-auto"
          }`}
        >
          <PluginPageBody
            dynamicPage={dynamicPage}
            page={page}
            status={runtimeSnapshot.status}
            error={runtimeSnapshot.error}
            renderError={renderError}
            runtimeUpdatedAt={runtimeSnapshot.updatedAt}
          />
        </div>
      </div>
    </div>
  );
};

const renderPluginPage = (
  page: PluginInternalPageManifest,
  runtime: ReturnType<typeof getPluginRuntime>,
  plugin?: GlimpsePlugin,
) => {
  const pageRenderer = runtime?.pages.get(page.id);

  if (!runtime) {
    return { dynamicPage: null, renderError: undefined };
  }

  if (!pageRenderer && page.pageDefinition) {
    return {
      dynamicPage: <StandardPluginPage page={page} plugin={plugin} runtime={runtime} />,
      renderError: undefined,
    };
  }

  if (!pageRenderer) {
    return { dynamicPage: null, renderError: undefined };
  }

  try {
    return {
      dynamicPage: pageRenderer({
        h: createElement,
        components: runtime.components,
        actions: {
          invoke: (id, input) => invokePluginAction(runtime.actions, id, input),
        },
        plugin: {
          id: runtime.pluginId,
          version: runtime.version,
        },
        i18n: runtime.context.i18n,
      }),
      renderError: undefined,
    };
  } catch (error) {
    return {
      dynamicPage: null,
      renderError: error instanceof Error ? error.message : String(error),
    };
  }
};

const StandardPluginPage = ({
  page,
  plugin,
  runtime,
}: {
  page: PluginInternalPageManifest;
  plugin?: GlimpsePlugin;
  runtime: NonNullable<ReturnType<typeof getPluginRuntime>>;
}) => {
  const tabs = (page.pageDefinition?.tabs ?? []).filter(
    (tab) => !["info", "settings"].includes(tab.id),
  );
  const settings = Object.entries(plugin?.settings ?? {});
  const items = [
    ...tabs.map((tab) => ({
      id: tab.id,
      title: getStandardTabTitle(tab),
      content: <StandardPluginTab tab={tab} runtime={runtime} />,
    })),
    ...(settings.length > 0
      ? [
          {
            id: "settings",
            title: "Settings",
            content: (
              <StandardPluginSettings plugin={plugin} runtime={runtime} />
            ),
          },
        ]
      : []),
    {
      id: "info",
      title: "Info",
      content: <StandardPluginInfo page={page} plugin={plugin} />,
    },
  ];

  const Tabs = runtime.components.Tabs;

  return <Tabs items={items} />;
};

const StandardPluginTab = ({
  tab,
  runtime,
}: {
  tab: PluginPageTab;
  runtime: NonNullable<ReturnType<typeof getPluginRuntime>>;
}) => {
  if (tab.type === "playground") {
    const ActionPlayground = runtime.components.ActionPlayground;

    return (
      <ActionPlayground
        action={tab.action}
        placeholder={
          tab.inputPlaceholder ??
          tab.inputPlaceholderFallback ??
          "Enter input"
        }
        examples={tab.examples}
        submitLabel={tab.submitLabel}
      />
    );
  }

  if (tab.type === "converter") {
    const FileDropConverter = runtime.components.FileDropConverter;

    return (
      <FileDropConverter
        action={tab.action}
        accept={
          Array.isArray(tab.accept)
            ? tab.accept.join(",")
            : tab.accept
        }
        multiple={tab.multiple}
        maxBytes={tab.maxBytes}
        maxFiles={tab.maxFiles}
        outputDirectoryPreference={
          tab.outputDirectorySetting ?? "outputDirectory"
        }
        title={getStandardTabTitle(tab)}
        description={tab.description}
        chooseFileLabel={tab.chooseFileLabel}
        emptyLabel={tab.emptyLabel}
        convertingLabel={tab.convertingLabel}
        resultsLabel={tab.resultsLabel}
        revealLabel={tab.revealLabel}
        clearLabel={tab.clearLabel}
        fileColumnLabel={tab.fileColumnLabel}
        sizeColumnLabel={tab.sizeColumnLabel}
        pathColumnLabel={tab.pathColumnLabel}
        emptyResultsLabel={tab.emptyResultsLabel}
      />
    );
  }

  return <StandardPluginForm tab={tab} runtime={runtime} />;
};

const getStandardTabTitle = (tab: PluginPageTab): string =>
  tab.title ?? tab.titleFallback ?? tab.id;

const StandardPluginSettings = ({
  plugin,
  runtime,
}: {
  plugin?: GlimpsePlugin;
  runtime: NonNullable<ReturnType<typeof getPluginRuntime>>;
}) => {
  const settings = Object.entries(plugin?.settings ?? {});
  const OutputDirectorySettings = runtime.components.OutputDirectorySettings;

  if (settings.length === 0) {
    return null;
  }

  return (
    <div className="space-y-4 py-3">
      {settings.map(([key, schema]) => {
        const setting = readSettingSchema(schema);

        if (setting.type === "directory") {
          return (
            <OutputDirectorySettings
              key={key}
              preference={key}
              label={setting.label ?? key}
              description={setting.description}
              placeholder={setting.placeholder ?? key}
            />
          );
        }

        return (
          <InfoSection key={key} title={setting.label ?? key}>
            <StaticRow
              label="Type"
              value={setting.type || "string"}
            />
            {setting.description && (
              <StaticRow label="Description" value={setting.description} />
            )}
          </InfoSection>
        );
      })}
    </div>
  );
};

const readSettingSchema = (schema: unknown) => {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    return {};
  }

  const record = schema as Record<string, unknown>;

  return {
    type: typeof record.type === "string" ? record.type : undefined,
    label:
      readString(record.label) ??
      readString(record.labelFallback) ??
      readString(record.labelKey),
    description:
      readString(record.description) ??
      readString(record.descriptionFallback) ??
      undefined,
    placeholder:
      readString(record.placeholder) ??
      readString(record.placeholderFallback) ??
      undefined,
  };
};

const readString = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

const StandardPluginInfo = ({
  page,
  plugin,
}: {
  page: PluginInternalPageManifest;
  plugin?: GlimpsePlugin;
}) => {
  const actions = plugin?.contributes?.actions ?? [];
  const viewers = plugin?.contributes?.viewers ?? [];
  const settings = Object.keys(plugin?.settings ?? {});
  const fileCapabilities = plugin?.capabilities?.files;
  const rows = [
    ["Name", plugin?.name ?? page.title],
    ["Plugin ID", plugin?.id ?? page.id.replace(/^plugin:/, "")],
    ["Version", plugin?.version ?? "unknown"],
    ["API Version", plugin?.apiVersion ?? "unknown"],
    ["Page", page.id],
    [
      "File Access",
      [
        fileCapabilities?.read ? `read: ${fileCapabilities.read}` : null,
        fileCapabilities?.write ? `write: ${fileCapabilities.write}` : null,
      ]
        .filter(Boolean)
        .join(", ") || "none",
    ],
  ];

  return (
    <div className="space-y-5 py-3 pr-3 sm:pr-4">
      {plugin?.description && (
        <p className="text-sm leading-6 text-text-muted">{plugin.description}</p>
      )}

      <InfoSection title="Overview">
        {rows.map(([label, value]) => (
          <StaticRow key={label} label={label} value={value} />
        ))}
      </InfoSection>

      {(actions.length > 0 || viewers.length > 0 || settings.length > 0) && (
        <InfoSection title="Contributions">
          {actions.length > 0 && (
            <StaticRow
              label="Actions"
              value={actions.map((action) => action.title).join(", ")}
            />
          )}
          {viewers.length > 0 && (
            <StaticRow
              label="Viewers"
              value={viewers.map((viewer) => viewer.title).join(", ")}
            />
          )}
          {settings.length > 0 && (
            <StaticRow label="Settings" value={settings.join(", ")} />
          )}
        </InfoSection>
      )}
    </div>
  );
};

const InfoSection = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section>
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h2>
    <div className="divide-y divide-border-main/60 border-y border-border-main/60">
      {children}
    </div>
  </section>
);

const StandardPluginForm = ({
  tab,
  runtime,
}: {
  tab: PluginFormTab;
  runtime: NonNullable<ReturnType<typeof getPluginRuntime>>;
}) => {
  const [values, setValues] = useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      (tab.fields ?? []).map((field) => [
        field.id,
        field.default ?? getDefaultFormFieldValue(field),
      ]),
    ),
  );
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const updateValue = (id: string, value: unknown) => {
    setValues((current) => ({
      ...current,
      [id]: value,
    }));
  };

  const submit = async () => {
    if (running) {
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const output = await invokePluginAction(runtime.actions, tab.action, values);
      setResult(formatPluginFormResult(output));
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : String(submitError),
      );
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-4 py-3">
      <div className="space-y-3">
        {(tab.fields ?? []).map((field) => (
          <PluginFormFieldControl
            key={field.id}
            field={field}
            value={values[field.id]}
            onChange={(value) => updateValue(field.id, value)}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={() => void submit()}
        disabled={running}
        className="rounded border border-border-main bg-main-bg px-3 py-2 text-sm font-medium text-text-main hover:border-accent disabled:opacity-60"
      >
        {running ? "Running" : tab.submitLabel ?? tab.submitLabelFallback ?? "Run"}
      </button>

      {error && (
        <div className="border-y border-red-500/40 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      {result !== null && !error && (
        <pre className="max-h-80 overflow-auto border-y border-border-main/60 bg-main-bg px-3 py-2 text-xs whitespace-pre-wrap text-text-main">
          {result}
        </pre>
      )}
    </div>
  );
};

const PluginFormFieldControl = ({
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

  return (
    <label htmlFor={inputId} className="block space-y-1.5">
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
        className="w-full rounded border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
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
      typeof value === "number" ? value : Number(field.default ?? field.min ?? 0);

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
          className="min-w-0 flex-1 rounded border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
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
      className="w-full rounded border border-border-main bg-main-bg px-3 py-2 text-sm text-text-main outline-none focus:border-accent"
    />
  );
};

const getDefaultFormFieldValue = (field: PluginFormField): unknown => {
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

const formatPluginFormResult = (value: unknown): string => {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value, null, 2);
};

const PluginPageBody = ({
  dynamicPage,
  page,
  status,
  error,
  renderError,
  runtimeUpdatedAt,
}: {
  dynamicPage: ReactNode;
  page: PluginInternalPageManifest;
  status: PluginRuntimeSnapshot["status"];
  error?: string;
  renderError?: string;
  runtimeUpdatedAt: string;
}) => {
  if (status === "loading") {
    return (
      <RuntimeMessage
        title="Loading plugin runtime"
        message="Glimpse is activating this plugin's main.js."
      />
    );
  }

  if (status === "error") {
    return (
      <>
        <RuntimeMessage
          title="Plugin runtime failed"
          message={error ?? "The plugin failed while activating."}
          tone="error"
        />
        <StaticPageFallback page={page} />
      </>
    );
  }

  if (renderError) {
    return (
      <>
        <RuntimeMessage
          title="Plugin page render failed"
          message={renderError}
          tone="error"
        />
        <StaticPageFallback page={page} />
      </>
    );
  }

  if (dynamicPage) {
    return (
      <PluginRenderErrorBoundary key={runtimeUpdatedAt} page={page}>
        {dynamicPage}
      </PluginRenderErrorBoundary>
    );
  }

  return <StaticPageFallback page={page} />;
};

const RuntimeMessage = ({
  title,
  message,
  tone = "muted",
}: {
  title: string;
  message: string;
  tone?: "muted" | "error";
}) => (
  <div
    className={`border-y py-3 ${
      tone === "error"
        ? "border-red-500/40 text-red-400"
        : "border-border-main/60 text-text-muted"
    }`}
  >
    <div className="font-medium text-text-main">{title}</div>
    <div className="mt-1 text-xs">{message}</div>
  </div>
);

class PluginRenderErrorBoundary extends Component<
  { children: ReactNode; page: PluginInternalPageManifest },
  { error?: string }
> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, _errorInfo: ErrorInfo) {
    console.error("Plugin page render failed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <>
          <RuntimeMessage
            title="Plugin page render failed"
            message={this.state.error}
            tone="error"
          />
          <StaticPageFallback page={this.props.page} />
        </>
      );
    }

    return this.props.children;
  }
}

const StaticPageFallback = ({ page }: { page: PluginInternalPageManifest }) => (
  <>
    {page.staticPage?.sections?.map((section) => (
      <StaticSection key={section.title} section={section} />
    ))}
  </>
);

const StaticSection = ({ section }: { section: PluginStaticPageSection }) => (
  <section className="mb-6">
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {section.title}
    </h2>

    <div className="divide-y divide-border-main/60 border-y border-border-main/60">
      {section.rows?.map((row) => (
        <StaticRow
          key={`${row.label}:${row.value}`}
          label={row.label}
          value={row.value}
        />
      ))}

      {section.paragraphs?.map((paragraph) => (
        <p key={paragraph} className="py-3 text-text-muted">
          {paragraph}
        </p>
      ))}
    </div>
  </section>
);

const StaticRow = ({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <span className="text-text-muted">{label}</span>
    <span className="font-mono text-xs text-text-main">{value}</span>
  </div>
);

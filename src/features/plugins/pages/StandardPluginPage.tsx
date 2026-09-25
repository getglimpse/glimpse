import type { ReactNode } from "react";
import type {
  GlimpsePlugin,
  PluginInternalPageManifest,
  PluginPageTab,
} from "@/types";
import { ConvertedFilePrefixSettings } from "../components/converter";
import { getPluginRuntime } from "../runtime";
import { StaticRow } from "./PluginPageParts";
import { StandardPluginForm } from "./StandardPluginForm";

export const StandardPluginPage = ({
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
  const hasConverterTab = tabs.some((tab) => tab.type === "converter");
  const items = [
    ...tabs.map((tab) => ({
      id: tab.id,
      title: getStandardTabTitle(tab),
      content: <StandardPluginTab tab={tab} runtime={runtime} />,
    })),
    ...(settings.length > 0 || hasConverterTab
      ? [
          {
            id: "settings",
            title: "Settings",
            content: (
              <StandardPluginSettings
                plugin={plugin}
                runtime={runtime}
                hasConverterTab={hasConverterTab}
              />
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
          tab.inputPlaceholder ?? tab.inputPlaceholderFallback ?? "Enter input"
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
        accept={Array.isArray(tab.accept) ? tab.accept.join(",") : tab.accept}
        multiple={tab.multiple}
        maxBytes={tab.maxBytes}
        maxFiles={tab.maxFiles}
        outputModes={tab.outputModes}
        outputDirectoryPreference={
          tab.outputDirectorySetting ?? "outputDirectory"
        }
        title={getStandardTabTitle(tab)}
        description={tab.description}
        chooseFileLabel={tab.chooseFileLabel}
        emptyLabel={tab.emptyLabel}
        convertingLabel={tab.convertingLabel}
        runLabel={tab.runLabel}
        createModeLabel={tab.createModeLabel}
        overwriteModeLabel={tab.overwriteModeLabel}
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
  hasConverterTab,
}: {
  plugin?: GlimpsePlugin;
  runtime: NonNullable<ReturnType<typeof getPluginRuntime>>;
  hasConverterTab: boolean;
}) => {
  const settings = Object.entries(plugin?.settings ?? {});
  const OutputDirectorySettings = runtime.components.OutputDirectorySettings;

  if (settings.length === 0 && !hasConverterTab) {
    return null;
  }

  return (
    <div className="space-y-4 py-3">
      {settings.map(([key, schema]) => {
        if (key === "convertedFilePrefix") {
          return (
            <ConvertedFilePrefixSettings
              key={key}
              pluginId={runtime.pluginId}
            />
          );
        }
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
            <StaticRow label="Type" value={setting.type || "string"} />
            {setting.description && (
              <StaticRow label="Description" value={setting.description} />
            )}
          </InfoSection>
        );
      })}
      {hasConverterTab &&
        !settings.some(([key]) => key === "convertedFilePrefix") && (
          <ConvertedFilePrefixSettings pluginId={runtime.pluginId} />
        )}
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
        <p className="text-sm leading-6 text-text-muted">
          {plugin.description}
        </p>
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

import {
  Component,
  createElement,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import type {
  PluginInternalPageManifest,
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
  pluginId,
}: {
  page: PluginInternalPageManifest;
  pluginId: string;
}) => {
  const [, forceRuntimeUpdate] = useState(0);
  const runtime = getPluginRuntime(pluginId);
  const runtimeSnapshot = getPluginRuntimeSnapshot(pluginId);
  const { dynamicPage, renderError } = renderPluginPage(page, runtime);

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
) => {
  const pageRenderer = runtime?.pages.get(page.id);

  if (!runtime || !pageRenderer) {
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

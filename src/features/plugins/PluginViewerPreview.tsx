import {
  Component,
  createElement,
  useEffect,
  useState,
  type ErrorInfo,
  type ReactNode,
} from "react";

import type { IndexItem } from "@/types";

import { invokePluginAction } from "./pluginComponents";
import { getPluginViewerContribution } from "./pluginRegistry";
import {
  activatePluginRuntime,
  getPluginRuntime,
  getPluginRuntimeSnapshot,
  subscribeToPluginRuntimeChanges,
  type PluginRuntimeSnapshot,
} from "./pluginRuntime";

export const PluginViewerPreview = ({ item }: { item: IndexItem }) => {
  const [, forceRuntimeUpdate] = useState(0);
  const [renderState, setRenderState] = useState<
    | { status: "idle" | "loading" }
    | { status: "ready"; node: ReactNode }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const preview = item.preview;
  const viewerReference =
    preview.type === "pluginViewer" ? getPluginViewerReference(preview) : null;

  useEffect(
    () =>
      subscribeToPluginRuntimeChanges(() => {
        forceRuntimeUpdate((previous) => previous + 1);
      }),
    [],
  );

  useEffect(() => {
    if (preview.type !== "pluginViewer") {
      return;
    }

    const contribution = viewerReference
      ? getPluginViewerContribution(
          viewerReference.pluginId,
          viewerReference.viewerId,
        )
      : undefined;

    if (!contribution || getPluginRuntime(contribution.plugin.id)) {
      return;
    }

    void activatePluginRuntime(contribution.plugin).catch(() => undefined);
  }, [preview.type, viewerReference?.pluginId, viewerReference?.viewerId]);

  useEffect(() => {
    if (preview.type !== "pluginViewer" || !viewerReference) {
      setRenderState({ status: "idle" });
      return;
    }

    const runtime = getPluginRuntime(viewerReference.pluginId);
    const runtimeSnapshot = getPluginRuntimeSnapshot(viewerReference.pluginId);
    const viewer = runtime?.viewers.get(viewerReference.viewerId);

    if (!runtime || !viewer || runtimeSnapshot.status !== "active") {
      return;
    }

    let cancelled = false;

    setRenderState({ status: "loading" });

    try {
      const result = viewer({
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
        sourcePath: item.sourcePath,
      });

      Promise.resolve(result as ReactNode | Promise<ReactNode>)
        .then((node) => {
          if (!cancelled) {
            setRenderState({ status: "ready", node });
          }
        })
        .catch((error) => {
          if (!cancelled) {
            setRenderState({
              status: "error",
              message: error instanceof Error ? error.message : String(error),
            });
          }
        });
    } catch (error) {
      setRenderState({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }

    return () => {
      cancelled = true;
    };
  }, [
    item.id,
    item.sourcePath,
    preview.type,
    viewerReference?.pluginId,
    viewerReference?.viewerId,
    getPluginRuntimeSnapshot(viewerReference?.pluginId ?? "").updatedAt,
  ]);

  if (preview.type !== "pluginViewer") {
    return null;
  }

  if (!viewerReference) {
    return (
      <PluginViewerMessage
        title="Plugin viewer is not available"
        message="This file is missing plugin viewer metadata."
        tone="error"
      />
    );
  }

  const contribution = getPluginViewerContribution(
    viewerReference.pluginId,
    viewerReference.viewerId,
  );
  const runtime = getPluginRuntime(viewerReference.pluginId);
  const runtimeSnapshot = getPluginRuntimeSnapshot(viewerReference.pluginId);

  if (!contribution) {
    return (
      <PluginViewerMessage
        title="Plugin viewer is not available"
        message={`Enable and trust ${viewerReference.pluginId} to preview this file.`}
        tone="error"
      />
    );
  }

  if (runtimeSnapshot.status === "loading") {
    return (
      <PluginViewerMessage
        title="Loading plugin viewer"
        message={`Glimpse is activating ${contribution.plugin.name}.`}
      />
    );
  }

  if (runtimeSnapshot.status === "error") {
    return (
      <PluginViewerMessage
        title="Plugin viewer failed"
        message={runtimeSnapshot.error ?? "The plugin failed while activating."}
        tone="error"
      />
    );
  }

  const viewer = runtime?.viewers.get(viewerReference.viewerId);

  if (!runtime || !viewer) {
    return (
      <PluginViewerMessage
        title="Plugin viewer is not registered"
        message={`${contribution.plugin.name} did not register viewer ${viewerReference.viewerId}.`}
        tone="error"
      />
    );
  }

  if (renderState.status === "loading" || renderState.status === "idle") {
    return (
      <PluginViewerMessage
        title="Rendering plugin viewer"
        message={`${contribution.plugin.name} is preparing this preview.`}
      />
    );
  }

  if (renderState.status === "error") {
    return (
      <PluginViewerMessage
        title="Plugin viewer render failed"
        message={renderState.message}
        tone="error"
      />
    );
  }

  if (renderState.status !== "ready") {
    return null;
  }

  const renderedNode = renderState.node;

  return (
    <PluginViewerErrorBoundary
      key={`${item.id}:${runtimeSnapshot.updatedAt}`}
      snapshot={runtimeSnapshot}
    >
      {renderedNode}
    </PluginViewerErrorBoundary>
  );
};

const getPluginViewerReference = (
  preview: Extract<IndexItem["preview"], { type: "pluginViewer" }>,
): { pluginId: string; viewerId: string } | null => {
  const legacyPreview = preview as typeof preview & {
    plugin_id?: unknown;
    viewer_id?: unknown;
  };
  const pluginId =
    preview.pluginId ??
    (typeof legacyPreview.plugin_id === "string"
      ? legacyPreview.plugin_id
      : undefined);
  const viewerId =
    preview.viewerId ??
    (typeof legacyPreview.viewer_id === "string"
      ? legacyPreview.viewer_id
      : undefined);

  return pluginId && viewerId ? { pluginId, viewerId } : null;
};

const PluginViewerMessage = ({
  title,
  message,
  tone = "muted",
}: {
  title: string;
  message: string;
  tone?: "muted" | "error";
}) => (
  <div className="flex h-full items-center justify-center p-6 text-sm">
    <div
      className={`w-full max-w-xl border-y py-3 ${
        tone === "error"
          ? "border-red-500/40 text-red-400"
          : "border-border-main/60 text-text-muted"
      }`}
    >
      <div className="font-medium text-text-main">{title}</div>
      <div className="mt-1 text-xs">{message}</div>
    </div>
  </div>
);

class PluginViewerErrorBoundary extends Component<
  { children: ReactNode; snapshot: PluginRuntimeSnapshot },
  { error?: string }
> {
  state: { error?: string } = {};

  static getDerivedStateFromError(error: unknown) {
    return {
      error: error instanceof Error ? error.message : String(error),
    };
  }

  componentDidCatch(error: unknown, _errorInfo: ErrorInfo) {
    console.error("Plugin viewer render failed:", error);
  }

  render() {
    if (this.state.error) {
      return (
        <PluginViewerMessage
          title="Plugin viewer render failed"
          message={this.state.error}
          tone="error"
        />
      );
    }

    return this.props.children;
  }
}

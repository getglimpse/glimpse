import { useEffect, useId, useMemo, useRef, useState } from "react";

import type { MermaidConfig } from "mermaid";

type Props = {
  content: string;
};

type RenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error"; message: string };

const getCssVariable = (name: string, fallback: string) => {
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();

  return value || fallback;
};

const createMermaidConfig = (): MermaidConfig => {
  const background = getCssVariable("--main-bg", "#ffffff");
  const foreground = getCssVariable("--text-main", "#111827");
  const muted = getCssVariable("--text-muted", "#6b7280");
  const accent = getCssVariable("--accent", "#2563eb");
  const border = getCssVariable("--border", "rgba(0, 0, 0, 0.12)");

  return {
    startOnLoad: false,
    securityLevel: "strict",
    theme: "base",
    themeVariables: {
      primaryColor: background,
      primaryTextColor: foreground,
      primaryBorderColor: border,
      lineColor: muted,
      secondaryColor: accent,
      tertiaryColor: background,
      fontFamily: "Geist Variable, sans-serif",
    },
  };
};

const getErrorMessage = (error: unknown) => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

export const MermaidBlock = ({ content }: Props) => {
  const reactId = useId();
  const renderId = useMemo(
    () => `mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/g, "")}`,
    [reactId],
  );
  const [themeVersion, setThemeVersion] = useState(0);
  const [renderState, setRenderState] = useState<RenderState>({
    status: "loading",
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const renderAttemptRef = useRef(0);

  useEffect(() => {
    const observer = new MutationObserver(() => {
      setThemeVersion((version) => version + 1);
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style"],
    });

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const renderDiagram = async () => {
      renderAttemptRef.current += 1;
      const renderAttempt = renderAttemptRef.current;

      setRenderState({ status: "loading" });

      try {
        const { default: mermaid } = await import("mermaid");

        mermaid.initialize(createMermaidConfig());

        const result = await mermaid.render(
          `${renderId}-${themeVersion}-${renderAttempt}`,
          content,
        );

        if (cancelled) {
          return;
        }

        setRenderState({
          status: "ready",
          svg: result.svg,
        });

        window.requestAnimationFrame(() => {
          if (!cancelled && containerRef.current) {
            result.bindFunctions?.(containerRef.current);
          }
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        setRenderState({
          status: "error",
          message: getErrorMessage(error),
        });
      }
    };

    void renderDiagram();

    return () => {
      cancelled = true;
    };
  }, [content, renderId, themeVersion]);

  return (
    <div className="my-4 overflow-x-auto rounded-md border border-border-main bg-main-bg p-4">
      {renderState.status === "loading" && (
        <div className="text-sm text-text-muted">Rendering Mermaid diagram...</div>
      )}

      {renderState.status === "error" && (
        <div className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-text-muted">
          Mermaid render failed: {renderState.message}
        </div>
      )}

      {renderState.status === "ready" && (
        <div
          ref={containerRef}
          className="[&_svg]:mx-auto [&_svg]:h-auto [&_svg]:max-w-full"
          dangerouslySetInnerHTML={{ __html: renderState.svg }}
        />
      )}
    </div>
  );
};

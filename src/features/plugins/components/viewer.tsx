import { useState, type ReactNode } from "react";

import { openerApi } from "@/api/opener";

import { getPluginButtonClassName, type PluginButtonVariant } from "./styles";

export type DeferredFrameProps = {
  src?: string;
  title?: string;
  className?: string;
  label?: ReactNode;
  description?: ReactNode;
  buttonLabel?: string;
};

export type FileOpenButtonProps = {
  sourcePath?: string;
  label?: ReactNode;
  variant?: PluginButtonVariant;
};

export const DeferredFrame = ({
  src,
  title,
  className,
  label = "Preview is paused",
  description,
  buttonLabel = "Load Preview",
}: DeferredFrameProps) => {
  const [loaded, setLoaded] = useState(false);

  if (loaded && src) {
    return (
      <iframe
        key={src}
        src={src}
        title={title}
        sandbox="allow-same-origin allow-scripts"
        referrerPolicy="no-referrer"
        className={className}
      />
    );
  }

  return (
    <div className="flex min-h-80 flex-col items-center justify-center gap-3 border-y border-border-main bg-main-bg px-6 py-8 text-center">
      <div className="text-sm font-semibold text-text-main">{label}</div>
      {description && (
        <div className="max-w-xl text-sm text-text-muted">{description}</div>
      )}
      <button
        type="button"
        onClick={() => setLoaded(true)}
        disabled={!src}
        className={getPluginButtonClassName("default")}
      >
        {buttonLabel}
      </button>
    </div>
  );
};

export const FileOpenButton = ({
  sourcePath,
  label = "Open Externally",
  variant = "secondary",
}: FileOpenButtonProps) => {
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const openFile = async () => {
    if (!sourcePath || running) {
      return;
    }

    setRunning(true);
    setMessage(null);

    try {
      await openerApi.openSourceFileOrReveal(sourcePath);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="inline-flex flex-col items-center gap-1 py-1">
      <button
        type="button"
        onClick={() => void openFile()}
        disabled={!sourcePath || running}
        className={getPluginButtonClassName(variant)}
      >
        {running ? "Opening" : label}
      </button>
      {message && <span className="text-xs text-text-muted">{message}</span>}
    </div>
  );
};

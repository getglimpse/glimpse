import { useEffect, useId, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import type {
  RemotePluginInstallKind,
  RemotePluginInstallState,
  RemotePluginManagementState,
} from "@/features/plugins/remote/viewModel";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryEntry, PluginRegistryItem } from "@/types";
import { RemotePluginDetail } from "./RemotePluginDetail";

export const RemotePluginDetailOverlay = ({
  entry,
  installedPlugin,
  conflictingInstalledPlugin,
  installKind,
  installState,
  managementState,
  error,
  LL,
  locale,
  onInstall,
  onEnabledChange,
  onUninstall,
  onClose,
  panelRef,
}: {
  entry: PluginRegistryEntry;
  installedPlugin?: PluginRegistryItem;
  conflictingInstalledPlugin?: PluginRegistryItem;
  installKind: RemotePluginInstallKind;
  installState?: RemotePluginInstallState;
  managementState?: RemotePluginManagementState;
  error?: string;
  LL: TranslationFunctions;
  locale: string;
  onInstall: () => void;
  onEnabledChange: (plugin: PluginRegistryItem, enabled: boolean) => void;
  onUninstall: (plugin: PluginRegistryItem) => void;
  onClose: () => void;
  panelRef: RefObject<HTMLDivElement | null>;
}) => {
  const titleId = useId();
  const descriptionId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const dialogFocusedRef = useRef(false);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const [panelBounds, setPanelBounds] = useState<{
    height: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);

  useEffect(() => {
    previousActiveElementRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    return () => {
      previousActiveElementRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (panelBounds && !dialogFocusedRef.current) {
      dialogRef.current?.focus();
      dialogFocusedRef.current = true;
    }
  }, [panelBounds]);

  useEffect(() => {
    const panel = panelRef.current;

    if (!panel) {
      return;
    }

    const updatePanelBounds = () => {
      const rect = panel.getBoundingClientRect();

      setPanelBounds({
        height: rect.height,
        left: rect.left,
        top: rect.top,
        width: rect.width,
      });
    };

    updatePanelBounds();
    window.addEventListener("resize", updatePanelBounds);

    if (typeof ResizeObserver === "undefined") {
      return () => {
        window.removeEventListener("resize", updatePanelBounds);
      };
    }

    const observer = new ResizeObserver(updatePanelBounds);

    observer.observe(panel);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updatePanelBounds);
    };
  }, [panelRef]);

  if (!panelBounds) {
    return null;
  }

  return (
    <div
      data-testid="remote-plugin-detail-overlay"
      className="fixed z-40 overflow-y-auto bg-black/10 p-6 supports-backdrop-filter:backdrop-blur-xs"
      onMouseDown={onClose}
      style={{
        height: panelBounds.height,
        left: panelBounds.left,
        top: panelBounds.top,
        width: panelBounds.width,
      }}
    >
      <div className="flex min-h-full items-center justify-center">
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={descriptionId}
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              onClose();
            }
          }}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
          className="relative grid max-h-full w-full max-w-xl gap-4 overflow-y-auto rounded-xl bg-popover p-4 text-sm text-popover-foreground ring-1 ring-foreground/10 outline-none"
        >
          <div className="sr-only">
            <h2 id={titleId}>{entry.name}</h2>
            <p id={descriptionId}>
              {LL.pluginPage.remote.openDetails({ name: entry.name })}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute top-2 right-2 inline-flex size-7 items-center justify-center rounded-[min(var(--radius-md),12px)] text-text-muted hover:bg-muted hover:text-foreground"
          >
            <X size={16} aria-hidden="true" />
          </button>

          <RemotePluginDetail
            entry={entry}
            installedPlugin={installedPlugin}
            conflictingInstalledPlugin={conflictingInstalledPlugin}
            installKind={installKind}
            installState={installState}
            managementState={managementState}
            error={error}
            LL={LL}
            locale={locale}
            onInstall={onInstall}
            onEnabledChange={onEnabledChange}
            onUninstall={onUninstall}
            surface="dialog"
          />
        </div>
      </div>
    </div>
  );
};

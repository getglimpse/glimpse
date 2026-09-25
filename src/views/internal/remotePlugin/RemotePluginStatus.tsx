import type {
  RemotePluginInstallKind,
  RemotePluginInstallState,
  RemotePluginManagementState,
} from "@/features/plugins/remote/viewModel";
import type { TranslationFunctions } from "@/i18n/i18n-types";
import type { PluginRegistryItem } from "@/types";

export const isRemotePluginActionDisabled = (
  installKind: RemotePluginInstallKind,
  installState: RemotePluginInstallState | undefined,
) =>
  Boolean(installState) ||
  installKind === "installed" ||
  installKind === "unsupported";

export const RemotePluginStatusBadge = ({
  failed,
  installKind,
  label,
}: {
  failed: boolean;
  installKind: RemotePluginInstallKind;
  label: string;
}) => (
  <span
    className={`rounded border px-1.5 py-0.5 text-xs ${
      failed || installKind === "unsupported"
        ? "border-red-500/40 text-red-300"
        : installKind === "update-available"
          ? "border-accent/50 text-accent"
          : "border-border-main text-text-muted"
    }`}
  >
    {label}
  </span>
);

export const getRemotePluginStatusLabel = (
  LL: TranslationFunctions,
  installKind: RemotePluginInstallKind,
  installState: RemotePluginInstallState | undefined,
  failed: boolean,
) => {
  if (failed) {
    return LL.pluginPage.remote.states.failed();
  }

  if (installState === "downloading") {
    return LL.pluginPage.remote.states.downloading();
  }

  if (installState === "installing") {
    return LL.pluginPage.remote.states.installing();
  }

  if (installKind === "not-installed") {
    return LL.pluginPage.remote.states.notInstalled();
  }

  if (installKind === "update-available") {
    return LL.pluginPage.remote.states.updateAvailable();
  }

  if (installKind === "unsupported") {
    return LL.pluginPage.remote.states.unsupportedApiVersion();
  }

  return LL.pluginPage.remote.states.installed();
};

export const getRemotePluginActionLabel = (
  LL: TranslationFunctions,
  installKind: RemotePluginInstallKind,
  installState: RemotePluginInstallState | undefined,
) => {
  if (installState === "downloading") {
    return LL.pluginPage.remote.downloading();
  }

  if (installState === "installing") {
    return LL.pluginPage.remote.installing();
  }

  if (installKind === "update-available") {
    return LL.pluginPage.remote.update();
  }

  if (installKind === "installed") {
    return LL.pluginPage.remote.installed();
  }

  if (installKind === "unsupported") {
    return LL.pluginPage.remote.unsupported();
  }

  return LL.pluginPage.remote.install();
};

export const getRemotePluginEnabledActionLabel = (
  LL: TranslationFunctions,
  plugin: PluginRegistryItem,
  managementState: RemotePluginManagementState | undefined,
) => {
  if (managementState === "enabling") {
    return LL.pluginPage.remote.enabling();
  }

  if (managementState === "disabling") {
    return LL.pluginPage.remote.disabling();
  }

  return plugin.enabled
    ? LL.pluginPage.remote.disable()
    : LL.pluginPage.remote.enable();
};

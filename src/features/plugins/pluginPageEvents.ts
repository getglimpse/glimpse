export const OPEN_LOCAL_PLUGIN_INSTALL_EVENT =
  "glimpse:open-local-plugin-install";

export const openLocalPluginInstallDialog = () => {
  window.dispatchEvent(new Event(OPEN_LOCAL_PLUGIN_INSTALL_EVENT));
};

export const assertPluginRegistrationId = (id: string, label: string) => {
  if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id) || id.includes("..")) {
    throw new Error(`invalid plugin ${label} id: ${id}`);
  }
};

export const assertPluginPageId = (pluginId: string, pageId: string) => {
  assertPluginRegistrationId(pageId, "page");

  const expectedPrefix = `plugin:${pluginId}`;

  if (!pageId.startsWith(expectedPrefix)) {
    throw new Error(
      `plugin page id must start with ${expectedPrefix}: ${pageId}`,
    );
  }
};

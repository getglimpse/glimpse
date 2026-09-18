export type PluginConverterExecutionMode = "manual" | "immediate";

type PluginConverterExecutionChange = {
  pluginId: string;
  preference: string;
  execution: PluginConverterExecutionMode;
};

type PluginConverterExecutionListener = (
  change: PluginConverterExecutionChange,
) => void;

const listeners = new Set<PluginConverterExecutionListener>();

export const getConverterExecutionPreference = (tabId: string) =>
  `converter.${tabId}.execution`;

export const isPluginConverterExecutionMode = (
  value: unknown,
): value is PluginConverterExecutionMode =>
  value === "manual" || value === "immediate";

export const publishPluginConverterExecution = (
  change: PluginConverterExecutionChange,
) => {
  for (const listener of listeners) {
    listener(change);
  }
};

export const subscribeToPluginConverterExecution = (
  listener: PluginConverterExecutionListener,
) => {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
};

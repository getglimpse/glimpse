export type PluginPlaygroundExecution = {
  pluginId: string;
  actionId: string;
  input: string;
  result: string;
  error?: boolean;
  source: "search";
};

type PluginPlaygroundExecutionListener = (
  execution: PluginPlaygroundExecution,
) => void;

const executionListeners = new Set<PluginPlaygroundExecutionListener>();

export const publishPluginPlaygroundExecution = (
  execution: PluginPlaygroundExecution,
) => {
  for (const listener of executionListeners) {
    listener(execution);
  }
};

export const subscribeToPluginPlaygroundExecutions = (
  listener: PluginPlaygroundExecutionListener,
) => {
  executionListeners.add(listener);

  return () => {
    executionListeners.delete(listener);
  };
};

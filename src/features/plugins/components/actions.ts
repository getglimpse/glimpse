export type PluginActionHandler = (
  input?: unknown,
) => unknown | Promise<unknown>;

export type PluginActionRegistration =
  | PluginActionHandler
  | {
      handler: PluginActionHandler;
      title?: string;
      description?: string;
    };

export type PluginAction = {
  handler: PluginActionHandler;
  title?: string;
  description?: string;
};

export type PluginActions = Record<string, PluginAction>;

export type PluginActionInvoker = (
  id: string,
  input?: unknown,
) => Promise<unknown>;

export const normalizePluginAction = (
  registration: PluginActionRegistration,
): PluginAction => {
  if (typeof registration === "function") {
    return {
      handler: registration,
    };
  }

  return registration;
};

export const invokePluginAction = async (
  actions: PluginActions,
  id: string,
  input?: unknown,
): Promise<unknown> => {
  const action = actions[id];

  if (!action) {
    throw new Error(`Missing action: ${id}`);
  }

  return action.handler(input);
};

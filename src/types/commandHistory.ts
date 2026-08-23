export type CommandHistoryStatus = "success" | "error";

export type CommandHistoryKind = "pageAction" | "pluginAction" | "command";

export type CommandHistoryEntry = {
  id: string;
  input: string;
  result: string;
  status: CommandHistoryStatus;
  kind: CommandHistoryKind;
  target: string;
  createdAt: string;
};

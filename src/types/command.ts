export type CommandExecutionStatus = "success" | "failed" | "blocked";

export type CommandExecutionStage =
  | "resolve"
  | "validate"
  | "trusted_directory"
  | "policy"
  | "spawn";

export type CommandExecutionLog = {
  timestamp: string;
  itemId: string;
  command: string;
  resolvedPath: string | null;
  args: string[];
  status: CommandExecutionStatus;
  stage: CommandExecutionStage;
  error: string | null;
};
export type PluginButtonVariant = "default" | "secondary" | "danger";

export const getPluginButtonClassName = (
  variant: PluginButtonVariant | undefined,
) => {
  const base = "rounded border px-3 py-2 text-xs disabled:opacity-50";

  switch (variant) {
    case "danger":
      return `${base} border-red-500/50 text-red-300 hover:bg-red-500/10`;
    case "secondary":
      return `${base} border-border-main text-text-muted hover:text-text-main`;
    case "default":
    default:
      return `${base} border-accent/60 text-accent hover:bg-accent/10`;
  }
};

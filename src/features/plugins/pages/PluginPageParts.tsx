import type { ReactNode } from "react";

export const StaticRow = ({
  label,
  value,
}: {
  label: ReactNode;
  value: ReactNode;
}) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <span className="text-text-muted">{label}</span>
    <span className="font-mono text-xs text-text-main">{value}</span>
  </div>
);

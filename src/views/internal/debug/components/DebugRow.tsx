type Props = {
  label: React.ReactNode;
  value: React.ReactNode;
};

export const DebugRow = ({ label, value }: Props) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <span className="text-text-muted">{label}</span>
    <span className="font-mono text-xs text-text-main">{value}</span>
  </div>
);
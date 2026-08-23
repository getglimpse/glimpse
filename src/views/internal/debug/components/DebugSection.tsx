type Props = {
  title: React.ReactNode;
  children: React.ReactNode;
};

export const DebugSection = ({ title, children }: Props) => (
  <section className="mb-6">
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h2>

    <div className="divide-y divide-border-main/60 border-y border-border-main/60">
      {children}
    </div>
  </section>
);
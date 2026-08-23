type Props = {
  title: string;
  description: string;
  children: React.ReactNode;
};

export const SettingsSection = ({
  title,
  description,
  children,
}: Props) => {
  return (
    <div className="mb-8">
      <div className="mb-4">
        <h2 className="text-base font-semibold">{title}</h2>

        <p className="mt-1 text-xs text-text-muted">
          {description}
        </p>
      </div>

      {children}
    </div>
  );
};
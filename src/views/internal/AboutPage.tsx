import { useEffect, useState } from "react";

import { aboutApi } from "@/api/about";
import { useI18nContext } from "@/i18n/I18nProvider";
import { AboutInfo } from "@/types";

const FEATURES = [
  "Tantivy + Lindera search",
  "Incremental search",
  "Fuzzy fallback",
  "Markdown indexing",
  "JSON index files",
  "Target groups",
  "Global search",
  "Command launcher",
  "PATH lookup",
  "Trusted directories",
  "Command execution logs",
  "Internal pages",
];

export const AboutPage = () => {
  const { LL } = useI18nContext();
  const [about, setAbout] = useState<AboutInfo | null>(null);

  useEffect(() => {
    aboutApi.get().then(setAbout);
  }, []);

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className=" mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{LL.aboutPage.title()}</h1>
          <p className="mt-1 text-sm text-text-muted">
            {LL.aboutPage.subtitle()}
          </p>
        </header>

        <Section title={LL.aboutPage.overview.title()}>
          <p className="mb-2 text-text-muted">
            {LL.aboutPage.overview.description1()}
          </p>

          <p className="mb-4 text-text-muted">
            {LL.aboutPage.overview.description2()}
          </p>

          <div className="flex flex-col gap-1 text-sm">
            <a
              href="https://github.com/cromon-code/glimpse"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              {LL.aboutPage.overview.githubHomepage()}
            </a>

            <a
              href="https://github.com/cromon-code/glimpse/issues"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--accent)] hover:underline"
            >
              {LL.aboutPage.overview.reportIssue()}
            </a>
          </div>
        </Section>

        <Section title={LL.aboutPage.application()}>
          <InfoRow label={LL.aboutPage.labels.name()} value="Glimpse" />
          <InfoRow label="Status" value="MVP" />
          <InfoRow
            label={LL.aboutPage.labels.version()}
            value={about?.version ?? "-"}
          />
          <InfoRow
            label={LL.aboutPage.labels.build()}
            value={about?.build ?? "-"}
          />
          <InfoRow
            label={LL.aboutPage.labels.license()}
            value={about?.license ?? "-"}
          />
          <InfoRow label="Configuration" value="settings.json" />
          <InfoRow label="Data model" value="Local-first" />
        </Section>

        <Section title={LL.aboutPage.technicalDetails()}>
          <InfoRow
            label={LL.aboutPage.labels.frontend()}
            value="React / Vite"
          />
          <InfoRow label={LL.aboutPage.labels.desktopRuntime()} value="Tauri" />
          <InfoRow
            label={LL.aboutPage.labels.searchEngine()}
            value="Tantivy + Lindera"
          />
          <InfoRow
            label={LL.aboutPage.labels.indexFormats()}
            value="Markdown / JSON / Raw"
          />
          <InfoRow
            label={LL.aboutPage.labels.commandExecution()}
            value="No shell passthrough"
          />
          <InfoRow
            label={LL.aboutPage.labels.security()}
            value="Policy + trusted directories"
          />
        </Section>

        <Section title={LL.aboutPage.features()}>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1">
            {FEATURES.map((feature) => (
              <div key={feature} className="py-1 text-text-muted">
                {feature}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </div>
  );
};

const Section = ({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="mb-6">
    <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h2>
    <div className="divide-y divide-border-main/60 border-y border-border-main/60">
      {children}
    </div>
  </section>
);

const InfoRow = ({
  label,
  value,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <span className="text-text-muted">{label}</span>
    <span className="font-mono text-xs text-text-main">{value}</span>
  </div>
);

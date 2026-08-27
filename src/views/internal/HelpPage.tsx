import React from "react";

import { useI18nContext } from "@/i18n/I18nProvider";

export const HelpPage = () => {
  const { LL } = useI18nContext();

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">{LL.helpPage.title()}</h1>

          <p className="mt-2 text-text-muted">{LL.helpPage.description()}</p>
        </header>

        <SectionGroup title={LL.helpPage.groups.usage()}>
          <Section title={LL.helpPage.search.title()}>
            <HelpRow
              command="keyword"
              description={LL.helpPage.search.currentGroup()}
            />
            <HelpRow command="#tag" description={LL.helpPage.search.tag()} />
            <HelpRow
              command="!keyword"
              description={LL.helpPage.search.hidden()}
            />
            <HelpRow
              command="item > args"
              description={LL.helpPage.search.commandArgs()}
            />
          </Section>

          <Section title={LL.helpPage.targetGroups.title()}>
            <HelpRow
              command="Current Target Group"
              description={LL.helpPage.targetGroups.current()}
            />
            <HelpRow
              command="Active Target Group"
              description={LL.helpPage.targetGroups.active()}
            />
            <HelpRow
              command="Inactive Target Group"
              description={LL.helpPage.targetGroups.inactive()}
            />
            <HelpRow
              command="Ctrl+R"
              description={LL.helpPage.targetGroups.switch()}
            />
            <HelpRow
              command=":settings"
              description={LL.helpPage.targetGroups.settings()}
            />
          </Section>

          <Section title={LL.helpPage.internalPages.title()}>
            <HelpRow
              command=":help"
              description={LL.helpPage.internalPages.help()}
            />
            <HelpRow
              command=":settings"
              description={LL.helpPage.internalPages.settings()}
            />
            <HelpRow
              command=":shortcuts"
              description={LL.helpPage.internalPages.shortcuts()}
            />
            <HelpRow
              command=":metadata"
              description={LL.helpPage.internalPages.metadata()}
            />
            <HelpRow
              command=":plugin"
              description={LL.helpPage.internalPages.plugin()}
            />
            <HelpRow
              command=":tags"
              description={LL.helpPage.internalPages.tagCloud()}
            />
            <HelpRow
              command=":history"
              description={LL.helpPage.internalPages.commandHistory()}
            />
            <HelpRow
              command=":debug"
              description={LL.helpPage.internalPages.debug()}
            />
            <HelpRow
              command=":about"
              description={LL.helpPage.internalPages.about()}
            />
          </Section>

          <Section title={LL.helpPage.shortcuts.title()}>
            <HelpRow
              command="Enter"
              description={LL.helpPage.shortcuts.open()}
            />
            <HelpRow
              command="Ctrl+B"
              description={LL.helpPage.shortcuts.sidebar()}
            />
            <HelpRow
              command="Ctrl+R"
              description={LL.helpPage.shortcuts.switchGroup()}
            />
            <HelpRow
              command="Ctrl+Alt+I"
              description={LL.helpPage.shortcuts.inspector()}
            />
          </Section>
        </SectionGroup>
      </div>
    </div>
  );
};

const SectionGroup = ({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) => (
  <div className="mb-8">
    <h2 className="mb-4 border-b border-border-main pb-2 text-base font-semibold text-text-main">
      {title}
    </h2>

    {children}
  </div>
);

const Section = ({
  title,
  children,
}: {
  title: React.ReactNode;
  children: React.ReactNode;
}) => (
  <section className="mb-6">
    <h3 className="mb-2 font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h3>

    <div className="divide-y divide-border-main/60 border-y border-border-main/60">
      {children}
    </div>
  </section>
);

const HelpRow = ({
  command,
  description,
}: {
  command: string;
  description: React.ReactNode;
}) => (
  <div className="flex items-center justify-between gap-4 py-2">
    <code className="shrink-0 font-mono text-text-main">{command}</code>
    <span className="text-right text-text-muted">{description}</span>
  </div>
);

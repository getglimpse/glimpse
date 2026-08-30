import React from "react";
import {
  ArrowDownUp,
  Command,
  EyeOff,
  Hash,
  Slash,
  StarOff,
  type LucideIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
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
            <HelpRow
              command={<SearchBadge icon={Hash} label="tag" syntax="#tag" />}
              description={LL.helpPage.search.tag()}
            />
            <HelpRow
              command={
                <SearchBadge icon={StarOff} label="unstar" syntax="*keyword" />
              }
              description={LL.helpPage.search.unstar()}
            />
            <HelpRow
              command={
                <SearchBadge icon={EyeOff} label="hidden" syntax="!keyword" />
              }
              description={LL.helpPage.search.hidden()}
            />
            <HelpRow
              command={
                <SearchBadge
                  icon={ArrowDownUp}
                  label="reverse"
                  syntax="^keyword"
                />
              }
              description={LL.helpPage.search.reverse()}
            />
            <HelpRow
              command={
                <SearchBadge icon={Command} label="internal" syntax=":query" />
              }
              description={LL.helpPage.search.internal()}
            />
            <HelpRow
              command={
                <SearchBadge
                  icon={Slash}
                  label="playground"
                  syntax="/query"
                />
              }
              description={LL.helpPage.search.pluginPlayground()}
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
  command: React.ReactNode;
  description: React.ReactNode;
}) => {
  const commandNode =
    typeof command === "string" ? (
      <code className="font-mono text-text-main">{command}</code>
    ) : (
      command
    );

  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="shrink-0">{commandNode}</div>
      <span className="text-right text-text-muted">{description}</span>
    </div>
  );
};

const SearchBadge = ({
  icon: Icon,
  label,
  syntax,
}: {
  icon: LucideIcon;
  label: string;
  syntax: string;
}) => (
  <div className="flex items-center gap-2">
    <Badge
      variant="outline"
      className="h-6 rounded-md border-primary/40 bg-primary/10 px-2 text-xs font-medium text-text-main"
    >
      <Icon size={12} aria-hidden="true" />
      <span>{label}</span>
    </Badge>
    <code className="font-mono text-text-main">{syntax}</code>
  </div>
);

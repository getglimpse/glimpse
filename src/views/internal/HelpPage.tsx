import React from "react";

import { CodeSnippet } from "../preview/CodeSnippet";
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
            command="*keyword"
            description={LL.helpPage.search.global()}
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

        <Section title={LL.helpPage.metadata.title()}>
          <p className="mb-3 text-text-muted">
            {LL.helpPage.metadata.description()}
          </p>

          <HelpRow
            command="title"
            description={LL.helpPage.metadata.fields.title()}
          />
          <HelpRow
            command="tags"
            description={LL.helpPage.metadata.fields.tags()}
          />
          <HelpRow
            command="aliases"
            description={LL.helpPage.metadata.fields.aliases()}
          />
          <HelpRow
            command="star"
            description={LL.helpPage.metadata.fields.star()}
          />
          <HelpRow
            command="hidden"
            description={LL.helpPage.metadata.fields.hidden()}
          />
          <HelpRow
            command="open.type: command"
            description={LL.helpPage.metadata.fields.commandOpenType()}
          />
          <HelpRow
            command="open.path"
            description={LL.helpPage.metadata.fields.openPath()}
          />
          <HelpRow
            command="open.type: external"
            description={LL.helpPage.metadata.fields.externalOpenType()}
          />
          <HelpRow
            command="open.url"
            description={LL.helpPage.metadata.fields.openUrl()}
          />
          <HelpRow
            command="unknown fields"
            description={LL.helpPage.metadata.fields.unknown()}
          />
        </Section>

        <Section title={LL.helpPage.metadataExample.title()}>
          <CodeSnippet language="yaml">{`---
title: VS Code
tags:
  - editor
  - development
aliases:
  - code
  - vscode
star: true
open.type: command
open.path: code
---

# VS Code

Searchable markdown body becomes the preview.`}</CodeSnippet>
        </Section>

        <Section title={LL.helpPage.commands.title()}>
          <p className="mb-3 text-text-muted">
            {LL.helpPage.commands.description()}
          </p>

          <HelpRow
            command="python > --version"
            description={LL.helpPage.commands.runExample({
              command: "python --version",
            })}
          />
          <HelpRow
            command="code > ."
            description={LL.helpPage.commands.runExample({ command: "code ." })}
          />
          <HelpRow
            command="cargo > test"
            description={LL.helpPage.commands.runExample({
              command: "cargo test",
            })}
          />
        </Section>

        <Section title={LL.helpPage.jsonIndex.title()}>
          <p className="mb-3 text-text-muted">
            {LL.helpPage.jsonIndex.description()}
          </p>

          <HelpRow
            command="*.gjson"
            description={LL.helpPage.jsonIndex.extension()}
          />
          <HelpRow
            command="items[]"
            description={LL.helpPage.jsonIndex.items()}
          />
          <HelpRow
            command="title"
            description={LL.helpPage.jsonIndex.itemTitle()}
          />
          <HelpRow
            command="url"
            description={LL.helpPage.jsonIndex.itemUrl()}
          />
          <HelpRow
            command="desc"
            description={LL.helpPage.jsonIndex.itemDesc()}
          />
          <HelpRow
            command="metadata.tags"
            description={LL.helpPage.jsonIndex.metadataTags()}
          />
          <HelpRow
            command="metadata.aliases"
            description={LL.helpPage.jsonIndex.metadataAliases()}
          />
          <HelpRow
            command="metadata.star"
            description={LL.helpPage.jsonIndex.metadataStar()}
          />
          <HelpRow
            command="metadata.hidden"
            description={LL.helpPage.jsonIndex.metadataHidden()}
          />
          <HelpRow
            command="iframe"
            description={LL.helpPage.jsonIndex.iframe()}
          />
          <HelpRow
            command="open"
            description={LL.helpPage.jsonIndex.openOverride()}
          />
        </Section>

        <Section title={LL.helpPage.jsonExample.title()}>
          <CodeSnippet language="json">{`{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org/book/",
      "desc": "Official Rust documentation",
      "metadata": {
        "tags": ["rust", "docs"],
        "aliases": ["rustbook"],
        "star": true
      },
      "iframe": false
    },
    {
      "title": "VS Code",
      "desc": "Open a workspace in VS Code",
      "metadata": {
        "tags": ["editor"]
      },
      "open": {
        "type": "command",
        "path": "code"
      }
    }
  ]
}`}</CodeSnippet>
        </Section>

        <Section title={LL.helpPage.shortcuts.title()}>
          <HelpRow command="Enter" description={LL.helpPage.shortcuts.open()} />
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
    <h2 className="mb-2 font-semibold uppercase tracking-wide text-text-muted">
      {title}
    </h2>

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

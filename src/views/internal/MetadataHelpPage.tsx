import React from "react";

import { CodeSnippet } from "../preview/CodeSnippet";
import { useI18nContext } from "@/i18n/I18nProvider";

export const MetadataHelpPage = () => {
  const { LL } = useI18nContext();

  return (
    <div className="h-full w-full overflow-y-auto p-6 text-sm text-text-main">
      <div className="mx-auto max-w-3xl">
        <header className="mb-6">
          <h1 className="text-xl font-semibold">
            {LL.metadataHelpPage.title()}
          </h1>

          <p className="mt-2 text-text-muted">
            {LL.metadataHelpPage.description()}
          </p>
        </header>

        <Section title={LL.metadataHelpPage.metadata.title()}>
          <p className="mb-3 text-text-muted">
            {LL.metadataHelpPage.metadata.description()}
          </p>

          <HelpRow
            command="title"
            description={LL.metadataHelpPage.metadata.fields.title()}
          />
          <HelpRow
            command="tags"
            description={LL.metadataHelpPage.metadata.fields.tags()}
          />
          <HelpRow
            command="aliases"
            description={LL.metadataHelpPage.metadata.fields.aliases()}
          />
          <HelpRow
            command="star"
            description={LL.metadataHelpPage.metadata.fields.star()}
          />
          <HelpRow
            command="hidden"
            description={LL.metadataHelpPage.metadata.fields.hidden()}
          />
          <HelpRow
            command="command"
            description={LL.metadataHelpPage.metadata.fields.commandOpenType()}
          />
          <HelpRow
            command="defaultAction: command"
            description={LL.metadataHelpPage.metadata.fields.openPath()}
          />
          <HelpRow
            command="url"
            description={LL.metadataHelpPage.metadata.fields.externalOpenType()}
          />
          <HelpRow
            command="iframe"
            description={LL.metadataHelpPage.metadata.fields.openUrl()}
          />
          <HelpRow
            command="unknown fields"
            description={LL.metadataHelpPage.metadata.fields.unknown()}
          />
        </Section>

        <Section title={LL.metadataHelpPage.metadataExample.title()}>
          <CodeSnippet language="yaml">{`---
title: VS Code
tags:
  - editor
  - development
aliases:
  - code
  - vscode
star: true
command: code .
---

# VS Code

Searchable markdown body becomes the preview.`}</CodeSnippet>
        </Section>

        <Section title={LL.metadataHelpPage.commands.title()}>
          <p className="mb-3 text-text-muted">
            {LL.metadataHelpPage.commands.description()}
          </p>

          <HelpRow
            command="python > --version"
            description={LL.metadataHelpPage.commands.runExample({
              command: "python --version",
            })}
          />
          <HelpRow
            command="code > ."
            description={LL.metadataHelpPage.commands.runExample({
              command: "code .",
            })}
          />
          <HelpRow
            command="cargo > test"
            description={LL.metadataHelpPage.commands.runExample({
              command: "cargo test",
            })}
          />
        </Section>

        <Section title={LL.metadataHelpPage.jsonIndex.title()}>
          <p className="mb-3 text-text-muted">
            {LL.metadataHelpPage.jsonIndex.description()}
          </p>

          <HelpRow
            command="*.gjson"
            description={LL.metadataHelpPage.jsonIndex.extension()}
          />
          <HelpRow
            command="items[]"
            description={LL.metadataHelpPage.jsonIndex.items()}
          />
          <HelpRow
            command="title"
            description={LL.metadataHelpPage.jsonIndex.itemTitle()}
          />
          <HelpRow
            command="url"
            description={LL.metadataHelpPage.jsonIndex.itemUrl()}
          />
          <HelpRow
            command="desc"
            description={LL.metadataHelpPage.jsonIndex.itemDesc()}
          />
          <HelpRow
            command="tags"
            description={LL.metadataHelpPage.jsonIndex.metadataTags()}
          />
          <HelpRow
            command="aliases"
            description={LL.metadataHelpPage.jsonIndex.metadataAliases()}
          />
          <HelpRow
            command="star"
            description={LL.metadataHelpPage.jsonIndex.metadataStar()}
          />
          <HelpRow
            command="hidden"
            description={LL.metadataHelpPage.jsonIndex.metadataHidden()}
          />
          <HelpRow
            command="iframe"
            description={LL.metadataHelpPage.jsonIndex.iframe()}
          />
          <HelpRow
            command="command"
            description={LL.metadataHelpPage.jsonIndex.openOverride()}
          />
        </Section>

        <Section title={LL.metadataHelpPage.jsonExample.title()}>
          <CodeSnippet language="json">{`{
  "items": [
    {
      "title": "Rust Book",
      "url": "https://doc.rust-lang.org/book/",
      "desc": "Official Rust documentation",
      "tags": ["rust", "docs"],
      "aliases": ["rustbook"],
      "star": true,
      "iframe": false
    },
    {
      "title": "VS Code",
      "desc": "Open a workspace in VS Code",
      "tags": ["editor"],
      "command": "code ."
    }
  ]
}`}</CodeSnippet>
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

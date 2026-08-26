import { describe, expect, it } from "vitest";

import {
  extractMarkdownMetadataTitle,
  parseMarkdownMetadata,
} from "./markdownMetadata";

describe("markdownMetadata", () => {
  it("parses leading frontmatter metadata and strips it from body", () => {
    expect(
      parseMarkdownMetadata(`---
title: New Title
tags:
  - rust
  - tauri
aliases: ["docs", "note"]
star: true
hidden: true
url: https://example.com/docs
iframe: true
defaultAction: url
---

# Body
`),
    ).toEqual({
      title: "New Title",
      tags: ["rust", "tauri"],
      aliases: ["docs", "note"],
      star: true,
      hidden: true,
      url: "https://example.com/docs",
      iframe: true,
      defaultAction: "url",
      body: "# Body",
    });
  });

  it("lets description win over desc", () => {
    expect(
      parseMarkdownMetadata(`---
desc: short
description: long
---
body
`).desc,
    ).toBe("long");
  });

  it("extracts a quoted title", () => {
    expect(
      extractMarkdownMetadataTitle(`---
title: "New Title"
---
`),
    ).toBe("New Title");
  });

  it("ignores non-leading metadata", () => {
    expect(
      extractMarkdownMetadataTitle(`# Body

---
title: New Title
---
`),
    ).toBeNull();
  });

  it("ignores nested title-like lines", () => {
    expect(
      extractMarkdownMetadataTitle(`---
tags:
  title: Nested
---
`),
    ).toBeNull();
  });

  it("requires a closing frontmatter delimiter", () => {
    const content = `---
title: New Title
`;

    expect(extractMarkdownMetadataTitle(content)).toBeNull();
    expect(parseMarkdownMetadata(content).body).toBe(content);
  });
});

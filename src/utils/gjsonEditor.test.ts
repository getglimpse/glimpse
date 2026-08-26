import { describe, expect, it } from "vitest";

import {
  parseGjsonEditorDocument,
  serializeGjsonEditorDocument,
} from "./gjsonEditor";

describe("gjsonEditor", () => {
  it("parses editable gjson metadata into card items", () => {
    const document = parseGjsonEditorDocument(`{
      "items": [
        {
          "title": "Rust Book",
          "description": "Long description",
          "desc": "Short description",
          "url": "https://doc.rust-lang.org/book/",
          "tags": "rust",
          "aliases": ["book", "rustbook"],
          "star": true,
          "hidden": true,
          "iframe": false,
          "command": "rustup doc --book",
          "defaultAction": "url"
        }
      ]
    }`);

    expect(document.items[0]).toMatchObject({
      title: "Rust Book",
      desc: "Long description",
      url: "https://doc.rust-lang.org/book/",
      tags: "rust",
      aliases: "book, rustbook",
      star: true,
      hidden: true,
      iframe: false,
      command: "rustup doc --book",
      defaultAction: "url",
    });
  });

  it("serializes cards while preserving unknown root and item fields", () => {
    const document = parseGjsonEditorDocument(`{
      "version": 1,
      "items": [
        {
          "title": "Old",
          "description": "Legacy",
          "viewer": "custom",
          "tags": ["docs", "rust"]
        }
      ]
    }`);

    document.items[0] = {
      ...document.items[0],
      title: "New",
      desc: "Updated",
      tags: "rust",
      aliases: "rs, rustlang",
      star: false,
      iframe: true,
      defaultAction: "command",
    };

    expect(JSON.parse(serializeGjsonEditorDocument(document))).toEqual({
      version: 1,
      items: [
        {
          title: "New",
          desc: "Updated",
          viewer: "custom",
          tags: "rust",
          aliases: ["rs", "rustlang"],
          defaultAction: "command",
        },
      ],
    });
  });

  it("rejects broken gjson documents", () => {
    expect(() => parseGjsonEditorDocument(`{"items":[{"title":""}]}`)).toThrow(
      "items[0].title must be a non-empty string",
    );
  });

  it("drops empty placeholder cards when serializing", () => {
    const document = parseGjsonEditorDocument(`{
      "items": [
        { "title": "Keep" }
      ]
    }`);

    document.items.push({
      ...document.items[0],
      id: "placeholder",
      title: "",
      raw: {},
    });

    expect(JSON.parse(serializeGjsonEditorDocument(document))).toEqual({
      items: [{ title: "Keep" }],
    });
  });

  it("keeps iframe false because gjson defaults iframe to true", () => {
    const document = parseGjsonEditorDocument(`{
      "items": [
        { "title": "Local", "iframe": false }
      ]
    }`);

    expect(JSON.parse(serializeGjsonEditorDocument(document))).toEqual({
      items: [{ title: "Local", iframe: false }],
    });
  });
});

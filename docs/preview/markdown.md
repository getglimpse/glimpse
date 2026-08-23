# Markdown Preview

Glimpse lets you preview Markdown documents directly within the application.

When you select a search result, the Preview updates automatically, allowing you to read the document without opening it in an editor.

## Live Preview

As you move through the search results with the arrow keys:

```text id="w4p8yr"
Search Results       Preview

Rust          →      Rust.md

Markdown      →      Markdown.md

Commands      →      Commands.md
```

the Preview updates in real time.

There is no need to press `Enter` to open the file.

## Supported Markdown

Glimpse supports the most common Markdown syntax.

### Headings

```md id="j2i2gu"
# Heading 1

## Heading 2

### Heading 3
```

Heading levels are preserved when rendered.

### Lists

```md id="vrg2vr"
- Apple
- Orange
- Banana
```

Ordered lists are also supported.

```md id="y8ppg7"
1. First
2. Second
3. Third
```

### Blockquotes

```md id="i7k56t"
> This is quote.
```

Blockquotes are rendered as quoted text.

### Tables

```md id="5wvj2i"
| Name | Language |
|------|----------|
| Rust | Systems |
| Python | Script |
```

Tables are rendered in a formatted layout.

### Inline Code

```md id="8eg4pg"
Use `cargo build`.
```

Inline code is highlighted within the text.

### Code Blocks

````md id="0s9t9z"
```rust
fn main() {
    println!("Hello");
}
```
````

Code blocks are rendered with syntax highlighting.

### Images

Markdown images are also supported.

```md id="d6cixg"
![sample](sample.png)
```

If the referenced image file exists, it is displayed directly in the Preview.

## Metadata

Markdown frontmatter is used for indexing and search, but it is not displayed in the Markdown Preview.

For example:

```yaml id="wbgs0t"
---
title: Rust
tags:
  - rust

aliases:
  - rs
---

# Rust
```

Only the document body is rendered:

```md id="l71b4i"
# Rust
```

If you want to view the frontmatter, use **Raw Preview**.

## Markdown Preview vs. Raw Preview

| Preview          | Description                           |
| ---------------- | ------------------------------------- |
| Markdown Preview | Renders Markdown with formatting      |
| Raw Preview      | Displays the original Markdown source |

For example:

```yaml id="b34fut"
---
title: Rust
---

# Rust
```

In **Markdown Preview**, it is rendered as:

```text id="y17vr2"
Rust
```

In **Raw Preview**, the original Markdown—including the frontmatter—is displayed exactly as written.

## Preview Tabs

Press `Ctrl + T` to keep the current Preview open as a Preview Tab.

Pinned Preview Tabs remain available even after you change the current search result.

## Summary

Markdown Preview is the default way to view documents in Glimpse.

Combined with Preview Tabs and Raw Preview, it provides a fast workflow for browsing multiple documents while still allowing you to inspect the original Markdown source when needed.

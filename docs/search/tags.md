# Tag Search

Tag Search lets you filter search results using tags defined in document metadata.

Even if you manage a large number of documents, tags make it easy to find related documents by category.

## Adding Tags

Define tags in a Markdown document's frontmatter.

```yaml
---
title: Rust

tags:
  - rust
  - programming
  - systems
---

# Rust

Rust is a systems programming language.
```

A document can have multiple tags.

## Standard Search

Tags are included in standard searches.

For example, searching for:

```text
rust
```

searches the following fields:

* Title
* Aliases
* Document content
* Tags

Therefore, a document containing:

```yaml
---
tags:
  - rust
---
```

will also appear in the search results for a standard search.

## Tag Search

To search only by tags, prefix the query with `#`.

```text
#rust
```

Only documents tagged with `rust` are returned.

### Example

Suppose you have the following documents.

```yaml
---
title: Rust Book
tags:
  - rust
  - study
---
```

```yaml
---
title: Rust API
tags:
  - rust
  - work
---
```

```yaml
---
title: Meeting Notes
tags:
  - work
---
```

Searching for:

```text
#rust
```

returns:

```text
Rust Book
Rust API
```

Searching for:

```text
#work
```

returns:

```text
Rust API
Meeting Notes
```

## Standard Search vs. Tag Search

| Query   | Behavior                                    |
| ------- | ------------------------------------------- |
| `rust`  | Searches titles, content, tags, and aliases |
| `#rust` | Returns only documents tagged with `rust`   |

## Common Uses for Tags

### Organize by Purpose

```yaml
tags:
  - work
```

```yaml
tags:
  - personal
```

```yaml
tags:
  - study
```

### Organize by Technology

```yaml
tags:
  - rust
```

```yaml
tags:
  - react
```

```yaml
tags:
  - tauri
```

### Track Document Status

```yaml
tags:
  - todo
```

```yaml
tags:
  - draft
```

```yaml
tags:
  - archive
```

## Target Groups

Tag Search searches only within the current Target Group.

For example, if the current Target Group is **Work**, then:

```text
#rust
```

returns only documents tagged with `rust` in the **Work** group.

To search another Target Group, switch to that group or use Global Search.

## Summary

In a standard search, tags are searched alongside titles, document content, and aliases.

Tag Search, on the other hand, searches only the tag field, making it an effective way to narrow search results by category.

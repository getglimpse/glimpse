# Query Syntax

In addition to standard keyword search, Glimpse supports a small set of prefixes for common workflows.

## Standard Search

```text
rust
```

Standard search matches titles, body text, tags, aliases, and other indexed text. Multiple words are combined, so `rust async` narrows the result set.

## Tag Search

Use `#` to search by tag.

```text
#rust
```

You can combine text and tags:

```text
async #rust
```

## Global Search

Use `*` to search across all Target Groups instead of only the current one.

```text
*rust
```

## Hidden Search

Use `!` to search items marked with `hidden: true`.

```text
!rust
```

Hidden search returns hidden items instead of normal visible items. Combine it with global search when needed:

```text
*!rust
```

## Internal Pages

Use `:` to search built-in Internal Pages and trusted plugin pages.

```text
:settings
:help
:plugin
```

Internal Pages appear in the result list and can be previewed like documents.

Use `/` to search plugin playground pages only.

```text
/calculator
```

## Arguments

Use `>` to pass arguments to the selected item.

For calculator-style pages:

```text
numeric calculator > 1 + 2
```

For command launcher items:

```text
Git > status
```

Everything to the right of `>` is passed as the argument string when you press `Enter`.

## Summary

| Query                        | Description                                |
| ---------------------------- | ------------------------------------------ |
| `rust`                       | Search the current Target Group            |
| `#rust`                      | Tag search                                 |
| `*rust`                      | Search all Target Groups                   |
| `!rust`                      | Search hidden items                        |
| `*!rust`                     | Search hidden items in all Target Groups   |
| `:settings`                  | Search Internal Pages                      |
| `/plugin`                    | Search plugin playground pages             |
| `numeric calculator > 1 + 2` | Pass arguments to the selected page/action |

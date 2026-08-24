# Target Groups

Target Groups organize search sources into separate groups.

Each Target Group contains one or more folders. Standard search uses the current Target Group.

## Why Use Target Groups?

Target Groups let you keep different collections separate:

```text
Work
Personal
Study
```

For example:

```text
Work
  ~/Projects
  ~/Documents/Work

Personal
  ~/Documents/Notes

Study
  ~/Documents/Study
```

## Creating A Target Group

Open **Settings -> Target Groups**, then:

1. Enter a group name.
2. Add one or more search source folders.
3. Save your changes.

## Switching Target Groups

Press `Ctrl + R` to switch to the next Active Target Group.

The search query stays the same while the current Target Group changes.

## Supported Files

A Target Group can contain Markdown files, `.gjson` indexes, images, and other files.

```text
Work
  API.md
  Meeting.md
  links.gjson
  tools.gjson
  diagram.png
```

Markdown files and `.gjson` indexes are added to the same search index, allowing them to be searched and previewed in a consistent way.

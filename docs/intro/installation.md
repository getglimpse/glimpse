# Installation

This page explains how to install Glimpse.

## System Requirements

Glimpse is designed for Windows, macOS, and Linux.

Tested environments:

- Windows 11
- Fedora Linux

macOS support is planned, but it has not yet been fully tested.

## Download

Download the appropriate package for your operating system from the GitHub Releases page.

### Windows

Use the Windows installer:

```text
Glimpse_x.x.x_x64-setup.exe
```

Run the installer and follow the on-screen instructions.

### Linux

A `.deb` package is available for Debian-based distributions such as Ubuntu.

```text
Glimpse_x.x.x_amd64.deb
```

Install it with:

```bash
sudo dpkg -i Glimpse_x.x.x_amd64.deb
```

If dependency errors occur, run:

```bash
sudo apt install -f
```

## First Launch

When you launch Glimpse for the first time, it creates a default workspace in your Documents folder.

```text
Glimpse/
|-- Welcome.md
|-- Getting Started.md
|-- Markdown.md
|-- Metadata.md
|-- Commands.md
`-- Examples/
```

These files introduce Glimpse's basic search, preview, Markdown, and metadata features.

## Updating

To update Glimpse, install the latest version.

Your settings, workspace, and search index are normally preserved during the update.

# Settings Page

The Settings page lets you customize Glimpse's behavior and appearance.

## Appearance

Customize the look and feel of the application.

### Theme

Switch between available themes.

* Built-in Themes
* Custom Themes

Custom themes are managed as CSS files. Click **Open Theme Folder** to open the theme directory.

Any `.css` file placed in this folder is automatically added to the list of available themes.

## Target Groups

Manage the directories that Glimpse searches.

You can create and remove Target Groups, and each Target Group can contain multiple search source directories.

The current Target Group used for standard searches can be switched with `Ctrl + R` by default. Only Active Target Groups participate in that cycle.

## UI

Configure the user interface.

### Compact List

Display search results in a more compact layout.

### Language

Change the application language.

Supported languages:

* Japanese
* English

## Security

Configure the rules used by the Command Launcher.

### Command Policy

Choose how command execution is controlled.

* None
* Whitelist
* Blacklist

### Allowed Commands

Manage the commands that are allowed when **Whitelist** mode is enabled.

### Blocked Commands

Manage the commands that are blocked when **Blacklist** mode is enabled.

## Experimental

Try features that may depend on operating-system or application-specific behavior.

### Use selected text as query

When enabled, Glimpse tries to read the selected text from the foreground app when the main window is opened with the global shortcut.

If text is found, it is placed in the search box as the query. If no text can be read, Glimpse opens normally and keeps the current query.

This option is disabled by default because selected-text access depends on Windows UI Automation support in the foreground app.

## Advanced

Configure advanced settings.

### Settings File

Open and edit the settings file directly.

For most users, changing settings through the Settings page is recommended.

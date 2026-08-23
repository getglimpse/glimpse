# FAQ

Here are answers to some of the most frequently asked questions about Glimpse.

## Search

### My files don't appear in the search results.

Check the following:

* The folder has been added to a Target Group.
* Indexing has completed.
* The file is located in a searchable source.

If the problem persists, run **Full Scan**.

### I updated a file, but the search results didn't change.

Normally, changes are indexed automatically.

If they don't appear immediately, wait a few seconds and then run **Full Scan**.

### Can I change the search ranking?

Yes.

You can influence search ranking by using Metadata.

For more information, see **Metadata**.

## Preview

### Can I pin the current Preview?

Yes.

Press **Ctrl + T** to add the current Preview as a Preview Tab.

### Can I open multiple Preview Tabs?

Yes.

You can keep multiple Preview Tabs open and switch between them at any time.

### Markdown isn't rendering correctly.

Check that your document uses supported Markdown syntax.

Unsupported Markdown extensions may be displayed as plain text.

## Metadata

### Is Metadata required?

No.

Search and Preview work even if a document does not define any Metadata.

### What are `aliases` and `tags` used for?

They make documents easier to find.

For more information, see **Metadata**.

### Do I need to restart Glimpse after changing Metadata?

No.

Saving the document automatically updates the search index.

## Target Groups

### How do I add a new folder?

Open **Settings → Target Groups** and add the folder there.

### If I remove a folder, are the original files deleted?

No.

Only the search index is updated. Your original files remain untouched.

## Settings

### Can I change the theme?

Yes.

You can change the theme from **Settings → Theme**.

### How do I add a custom theme?

Click **Open Theme Folder** in **Settings → Theme**, then place your `.css` file in the theme directory.

The new theme will automatically appear in the theme list.

### Can I change the application language?

Yes.

You can change it from **Settings → Language**.

## Security

### I can't run a command.

Check your Security settings.

If you're using **Whitelist** or **Blacklist** mode, make sure the command is permitted by the current policy.

## Troubleshooting

### What should I do if the search results seem incorrect?

Try the following steps:

1. Run **Full Scan**.
2. Verify your Target Groups.
3. Restart Glimpse.

### Glimpse feels slow.

The initial indexing process may take some time.

After the initial scan is complete, Glimpse updates only changed files, so day-to-day indexing is typically very fast.

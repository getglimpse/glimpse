import { useEffect, useRef, useState } from "react";
import { FilePlus, Pencil, Save, X } from "lucide-react";

import { fileApi } from "@/api/file";
import { useI18nContext } from "@/i18n/I18nProvider";
import { toast } from "@/utils/toast";

import type { FileEditorTabState } from "@/types";

type SaveResult = {
  filePath: string;
  title: string;
  body: string;
};

type Props = {
  editor: FileEditorTabState;
  active?: boolean;
  onChange: (patch: Partial<FileEditorTabState>) => void;
  onClose: (options?: { force?: boolean }) => void;
  onSaved: (result: SaveResult) => void;
};

const resolveDisplayTitle = (title: string, untitledLabel: string) =>
  title.trim() ? title.trim() : untitledLabel;

const isNativeEditableShortcut = (event: React.KeyboardEvent) => {
  const key = event.key.toLowerCase();

  return (
    (event.ctrlKey || event.metaKey) &&
    ["a", "c", "v", "x", "y", "z"].includes(key)
  );
};

export const FileEditorPanel = ({
  editor,
  active,
  onChange,
  onClose,
  onSaved,
}: Props) => {
  const [title, setTitle] = useState(editor.initialTitle);
  const [body, setBody] = useState(editor.initialBody);
  const [saving, setSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { LL } = useI18nContext();

  useEffect(() => {
    setTitle(editor.initialTitle);
    setBody(editor.initialBody);
  }, [editor.filePath, editor.initialTitle, editor.initialBody]);

  useEffect(() => {
    if (!active) return;

    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
  }, [active, editor.mode, editor.filePath]);

  useEffect(() => {
    const dirty =
      editor.mode === "create"
        ? title.trim() !== "" || body !== ""
        : title.trim() !== editor.initialTitle.trim() ||
          body !== editor.initialBody;

    onChange({
      title: resolveDisplayTitle(title, LL.fileEditor.untitled()),
      dirty,
    });
  }, [
    body,
    editor.initialBody,
    editor.initialTitle,
    editor.mode,
    LL,
    onChange,
    title,
  ]);

  const save = async (closeAfterSave: boolean) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      toast.error(LL.fileEditor.titleRequired());
      return;
    }

    if (editor.mode === "edit" && !editor.filePath) {
      toast.error(LL.fileEditor.filePathMissing());
      return;
    }

    const titleChanged = trimmedTitle !== editor.initialTitle.trim();
    const bodyChanged = body !== editor.initialBody;

    if (editor.mode === "edit" && !titleChanged && !bodyChanged) {
      toast.success(LL.fileEditor.noChanges());
      return;
    }

    try {
      setSaving(true);

      let savedPath: string;

      if (editor.mode === "create") {
        savedPath = await fileApi.createMarkdownFile({
          title: trimmedTitle,
          body,
        });
      } else {
        savedPath = editor.filePath!;

        if (titleChanged) {
          savedPath = await fileApi.updateMarkdownFileTitle(
            savedPath,
            trimmedTitle,
          );
        }

        if (bodyChanged) {
          await fileApi.updateMarkdownFileBody(savedPath, body);
        }
      }

      toast.success(LL.fileEditor.fileSaved());
      onSaved({ filePath: savedPath, title: trimmedTitle, body });

      if (closeAfterSave) {
        onClose({ force: true });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (event: React.KeyboardEvent) => {
    const isSave =
      event.key.toLowerCase() === "s" && (event.ctrlKey || event.metaKey);

    if (isSave) {
      event.preventDefault();
      event.stopPropagation();

      void save(event.shiftKey);
      return;
    }

    if (isNativeEditableShortcut(event)) {
      event.stopPropagation();
    }
  };

  const EditorIcon = editor.mode === "create" ? FilePlus : Pencil;

  return (
    <main className="flex min-w-0 flex-1 flex-col overflow-hidden border-l border-border-main bg-main-bg text-text-main">
      <header className="relative flex flex-shrink-0 items-center justify-between border-b border-border-main bg-glass-bg px-4 py-2 backdrop-blur-md">
        {active && (
          <div className="absolute left-0 top-0 h-0.5 w-full bg-accent" />
        )}

        <div className="flex min-w-0 items-center gap-2">
          <EditorIcon className="h-4 w-4 shrink-0 text-text-muted" />
          <span className="truncate text-sm font-semibold tracking-wide">
            {editor.mode === "create"
              ? LL.fileEditor.createFile()
              : LL.fileEditor.editFile()}
          </span>
          <span className="truncate text-xs text-text-muted">
            {resolveDisplayTitle(title, LL.fileEditor.untitled())}
            {editor.dirty ? " *" : ""}
          </span>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void save(false)}
            disabled={saving}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-item-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-50"
            title={LL.common.save()}
            tabIndex={-1}
          >
            <Save className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => onClose()}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-item-hover hover:text-text-main"
            title={LL.common.close()}
            tabIndex={-1}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4"
        onKeyDown={handleKeyDown}
      >
        <label className="flex flex-col gap-2 text-sm">
          <span className="font-medium text-text-main">
            {LL.fileEditor.title()}
          </span>
          <input
            ref={titleInputRef}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={saving}
            className="rounded-md border border-border bg-glass-bg px-3 py-2 text-sm text-text-main outline-none placeholder:text-placeholder focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            placeholder={LL.fileEditor.fileTitlePlaceholder()}
          />
        </label>

        <label className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden text-sm">
          <span className="font-medium text-text-main">
            {LL.fileEditor.body()}
          </span>
          <textarea
            value={body}
            onChange={(event) => setBody(event.target.value)}
            disabled={saving}
            className="min-h-0 flex-1 resize-none rounded-md border border-border bg-app-bg px-3 py-2 font-mono text-sm text-text-main outline-none placeholder:text-placeholder focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
            placeholder={LL.fileEditor.bodyPlaceholder()}
          />
        </label>

        <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
          <span>{LL.fileEditor.shortcutsHint()}</span>
          {saving && <span>{LL.fileEditor.saving()}</span>}
        </div>
      </div>
    </main>
  );
};

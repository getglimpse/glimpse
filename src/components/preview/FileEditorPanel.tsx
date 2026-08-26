import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  CircleHelp,
  FilePlus,
  Pencil,
  Save,
  X,
} from "lucide-react";

import { fileApi } from "@/api/file";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useI18nContext } from "@/i18n/I18nProvider";
import { toast } from "@/utils/toast";
import {
  createEmptyGjsonDocument,
  isEmptyGjsonCardItem,
  isEmptyGjsonDocument,
  serializeGjsonEditorDocument,
} from "@/utils/gjsonEditor";

import type { FileEditorTabState } from "@/types";
import { GjsonCardEditor } from "./GjsonCardEditor";

type SaveResult = {
  filePath: string;
  previousFilePath?: string;
  title: string;
  body: string;
  contentMode: FileEditorTabState["contentMode"];
  gjsonDocument?: FileEditorTabState["gjsonDocument"];
};

type Props = {
  editor: FileEditorTabState;
  active?: boolean;
  onChange: (patch: Partial<FileEditorTabState>) => void;
  onClose: (options?: { force?: boolean }) => void;
  onHelp: () => void;
  onSaved: (result: SaveResult) => void;
};

const resolveDisplayTitle = (title: string, untitledLabel: string) =>
  title.trim() ? title.trim() : untitledLabel;

const existingFileErrorPrefix = "file already exists:";

const existingFilePathFromError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);

  if (!message.startsWith(existingFileErrorPrefix)) {
    return null;
  }

  return message.slice(existingFileErrorPrefix.length).trim();
};

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
  onHelp,
  onSaved,
}: Props) => {
  const [title, setTitle] = useState(editor.initialTitle);
  const [body, setBody] = useState(editor.initialBody);
  const [gjsonDocument, setGjsonDocument] = useState(
    editor.gjsonDocument ?? createEmptyGjsonDocument(),
  );
  const [saving, setSaving] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const lastNotifiedRef = useRef<{ title: string; dirty: boolean } | null>(
    null,
  );
  const { LL } = useI18nContext();

  useEffect(() => {
    setTitle(editor.initialTitle);
    setBody(editor.initialBody);
    setGjsonDocument(editor.gjsonDocument ?? createEmptyGjsonDocument());
  }, [
    editor.filePath,
    editor.initialTitle,
    editor.initialBody,
    editor.gjsonDocument,
  ]);

  useEffect(() => {
    if (!active) return;

    requestAnimationFrame(() => {
      titleInputRef.current?.focus();
    });
  }, [active, editor.mode, editor.filePath]);

  useEffect(() => {
    const currentBody =
      editor.contentMode === "gjsonCards"
        ? serializeGjsonEditorDocument(gjsonDocument)
        : body;
    const dirty =
      editor.mode === "create"
        ? title.trim() !== "" ||
          body !== "" ||
          !isEmptyGjsonDocument(gjsonDocument)
        : title.trim() !== editor.initialTitle.trim() ||
          currentBody !== editor.initialBody;

    const nextTitle = resolveDisplayTitle(title, LL.fileEditor.untitled());
    const lastNotified = lastNotifiedRef.current;

    if (lastNotified?.title === nextTitle && lastNotified.dirty === dirty) {
      return;
    }

    lastNotifiedRef.current = { title: nextTitle, dirty };

    onChange({
      title: nextTitle,
      dirty,
    });
  }, [
    body,
    gjsonDocument,
    editor.contentMode,
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
    const savedBody =
      editor.contentMode === "gjsonCards"
        ? serializeGjsonEditorDocument(gjsonDocument)
        : body;
    const bodyChanged = savedBody !== editor.initialBody;

    if (editor.mode === "edit" && !titleChanged && !bodyChanged) {
      toast.success(LL.fileEditor.noChanges());
      return;
    }

    try {
      setSaving(true);

      let savedPath: string;

      if (editor.mode === "create") {
        if (editor.contentMode === "gjsonCards") {
          const missingTitle =
            !isEmptyGjsonDocument(gjsonDocument) &&
            gjsonDocument.items.some(
              (item) => !item.title.trim() && !isEmptyGjsonCardItem(item),
            );

          if (missingTitle) {
            toast.error(LL.fileEditor.gjson.missingItemTitle());
            return;
          }
        }

        savedPath = await fileApi.createTextFile({
          title: trimmedTitle,
          body: savedBody,
          extension: editor.extension === "gjson" ? "gjson" : "md",
        });
      } else {
        savedPath = editor.filePath!;

        if (titleChanged) {
          savedPath = await fileApi.updateTextFileTitle(
            savedPath,
            trimmedTitle,
          );
        }

        if (bodyChanged) {
          if (editor.contentMode === "gjsonCards") {
            const missingTitle =
              !isEmptyGjsonDocument(gjsonDocument) &&
              gjsonDocument.items.some(
                (item) => !item.title.trim() && !isEmptyGjsonCardItem(item),
              );

            if (missingTitle) {
              toast.error(LL.fileEditor.gjson.missingItemTitle());
              return;
            }
          }

          await fileApi.updateTextFileBody(savedPath, savedBody);
        }
      }

      toast.success(LL.fileEditor.fileSaved());
      onSaved({
        filePath: savedPath,
        previousFilePath: editor.mode === "edit" ? editor.filePath : undefined,
        title: trimmedTitle,
        body: savedBody,
        contentMode: editor.contentMode,
        gjsonDocument:
          editor.contentMode === "gjsonCards" ? gjsonDocument : undefined,
      });

      if (closeAfterSave) {
        onClose({ force: true });
      }
    } catch (error) {
      const existingPath = existingFilePathFromError(error);

      if (existingPath) {
        toast.error(LL.fileEditor.fileAlreadyExists({ path: existingPath }));
      } else {
        toast.error(error instanceof Error ? error.message : String(error));
      }
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
  const canChangeExtension =
    editor.mode === "create" &&
    body === "" &&
    isEmptyGjsonDocument(gjsonDocument);

  const selectExtension = (extension: "md" | "gjson") => {
    if (!canChangeExtension) return;

    onChange({
      extension,
      extensionLabel: extension === "gjson" ? ".gjson" : ".md",
      contentMode: extension === "gjson" ? "gjsonCards" : "markdown",
      gjsonDocument:
        extension === "gjson" ? gjsonDocument : createEmptyGjsonDocument(),
      dirty: title.trim() !== "",
    });
  };

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
            onClick={onHelp}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-text-muted hover:bg-item-hover hover:text-text-main"
            title={LL.previewPanel.openHelp()}
            tabIndex={-1}
          >
            <CircleHelp className="h-4 w-4" />
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
          <div className="flex min-w-0">
            <input
              ref={titleInputRef}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              disabled={saving}
              className="min-w-0 flex-1 rounded-l-md border border-border bg-glass-bg px-3 py-2 text-sm text-text-main outline-none placeholder:text-placeholder focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={LL.fileEditor.fileTitlePlaceholder()}
            />
            <ExtensionDropdown
              label={editor.extensionLabel}
              disabled={saving || !canChangeExtension}
              value={editor.extension === "gjson" ? "gjson" : "md"}
              onChange={selectExtension}
            />
          </div>
        </label>

        {editor.contentMode === "gjsonCards" ? (
          <GjsonCardEditor
            items={gjsonDocument.items}
            disabled={saving}
            onChange={(items) =>
              setGjsonDocument((current) => ({ ...current, items }))
            }
          />
        ) : (
          <label className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden text-sm">
            <span className="font-medium text-text-main">
              {LL.fileEditor.body()}
            </span>
            {editor.gjsonParseError && (
              <span className="rounded-md border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
                {editor.gjsonParseError}
              </span>
            )}
            <textarea
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={saving}
              className="min-h-0 flex-1 resize-none rounded-md border border-border bg-app-bg px-3 py-2 font-mono text-sm text-text-main outline-none placeholder:text-placeholder focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              placeholder={LL.fileEditor.bodyPlaceholder()}
            />
          </label>
        )}

        <div className="flex items-center justify-between gap-3 text-xs text-text-muted">
          <span>{LL.fileEditor.shortcutsHint()}</span>
          {saving && <span>{LL.fileEditor.saving()}</span>}
        </div>
      </div>
    </main>
  );
};

type ExtensionDropdownProps = {
  label: string;
  value: "md" | "gjson";
  disabled: boolean;
  onChange: (extension: "md" | "gjson") => void;
};

const ExtensionDropdown = ({
  label,
  value,
  disabled,
  onChange,
}: ExtensionDropdownProps) => {
  const button = (
    <button
      type="button"
      disabled={disabled}
      className="inline-flex h-[38px] min-w-24 items-center justify-center gap-1 rounded-r-md border border-l-0 border-border bg-glass-bg px-3 text-sm text-text-muted hover:bg-item-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-70"
      tabIndex={-1}
    >
      {label}
      <ChevronDown className="h-3.5 w-3.5" />
    </button>
  );

  if (disabled) {
    return button;
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => onChange("md")}
          className={value === "md" ? "bg-item-hover" : undefined}
        >
          .md
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => onChange("gjson")}
          className={value === "gjson" ? "bg-item-hover" : undefined}
        >
          .gjson
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

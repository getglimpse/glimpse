import {
  forwardRef,
  startTransition,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { toast } from "@/utils/toast";
import { convertFileSrc } from "@tauri-apps/api/core";

import { fileApi } from "@/api/file";
import { useI18nContext } from "@/i18n/I18nProvider";
import { CodeBlock } from "@/views/preview/CodeBlock";
import { MermaidBlock } from "@/views/preview/MermaidBlock";
import { copyMarkdownCodeBlock } from "@/utils/clipboard";
import {
  extractMarkdownCodeBlocks,
  remarkSoftLineBreaks,
} from "@/utils/markdown";
import {
  extractMarkdownTasks,
  remarkTaskIndex,
  shouldIgnoreTaskToggle,
  toggleMarkdownTask,
} from "@/utils/markdownTasks";

type Props = {
  id: string;
  content: string;
  sourcePath?: string | null;
  rawFallbackDelay?: number;
};

export type MarkdownPreviewHandle = {
  scrollDown: () => void;
  scrollUp: () => void;
  scrollToTop: () => void;
  copyCodeBlock: (index: number) => Promise<boolean>;
};

const AUDIO_MIME_TYPES: Record<string, string> = {
  aac: "audio/aac",
  aif: "audio/aiff",
  aiff: "audio/aiff",
  flac: "audio/flac",
  m4a: "audio/mp4",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  opus: "audio/ogg",
  wav: "audio/wav",
  weba: "audio/webm",
};

const VIDEO_MIME_TYPES: Record<string, string> = {
  avi: "video/x-msvideo",
  flv: "video/x-flv",
  m4v: "video/mp4",
  mkv: "video/x-matroska",
  mov: "video/quicktime",
  mp4: "video/mp4",
  mpeg: "video/mpeg",
  mpg: "video/mpeg",
  ogv: "video/ogg",
  webm: "video/webm",
  wmv: "video/x-ms-wmv",
};

const normalizeLocalFilePath = (src: string) => {
  let path = src;

  path = path.replace(/^file:\/\/\/?/, "");
  path = decodeURIComponent(path);

  path = path.replace(/^\/\/\?\//, "");
  path = path.replace(/^\\\\\?\\/, "");

  path = path.replace(/\\/g, "/");

  return path;
};

const getExtension = (src: string): string => {
  const withoutQuery = src.split(/[?#]/, 1)[0] ?? src;
  const filename = withoutQuery.split(/[\\/]/).pop() ?? "";
  const lastDotIndex = filename.lastIndexOf(".");

  if (lastDotIndex <= 0 || lastDotIndex === filename.length - 1) {
    return "";
  }

  return filename.slice(lastDotIndex + 1).toLowerCase();
};

const isLocalFileUrl = (src?: string | null): src is string =>
  typeof src === "string" && src.startsWith("file://");

const isNestedTaskClick = (
  target: EventTarget | null,
  currentTarget: HTMLElement,
) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target.closest("li[data-task-index]") !== currentTarget;
};

export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, Props>(
  ({ id, content, sourcePath, rawFallbackDelay = 50 }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const latestContentRef = useRef(content);
    const { LL } = useI18nContext();

    const [renderContent, setRenderContent] = useState(content);
    const [showMarkdown, setShowMarkdown] = useState(false);
    const [showRaw, setShowRaw] = useState(false);
    const [taskCheckedOverrides, setTaskCheckedOverrides] = useState<
      Record<number, boolean>
    >({});

    useEffect(() => {
      latestContentRef.current = content;
      setRenderContent(content);
      setTaskCheckedOverrides({});
    }, [content]);

    const codeBlocks = useMemo(
      () => extractMarkdownCodeBlocks(renderContent),
      [renderContent],
    );

    const tasks = useMemo(
      () => extractMarkdownTasks(renderContent),
      [renderContent],
    );

    const copyCodeBlockByIndex = useCallback(
      (index: number) => copyMarkdownCodeBlock(renderContent, index),
      [renderContent],
    );

    const copyCodeBlockWithToast = useCallback(
      async (index: number) => {
        try {
          const copied = await copyCodeBlockByIndex(index);

          if (copied) {
            toast.success(
              LL.markdownPreview.copiedCodeBlock({ index: index + 1 }),
            );
          } else {
            toast.error(
              LL.markdownPreview.codeBlockNotFound({ index: index + 1 }),
            );
          }

          return copied;
        } catch (error) {
          toast.error(
            LL.markdownPreview.copyCodeBlockFailed({
              error: String(error),
            }),
          );
          return false;
        }
      },
      [LL, copyCodeBlockByIndex],
    );

    const toggleTask = useCallback(
      async (taskIndex: number) => {
        if (!sourcePath) {
          toast.error(LL.markdownPreview.sourceFileNotFound());
          return;
        }

        const currentContent = latestContentRef.current;
        const currentTasks = extractMarkdownTasks(currentContent);
        const task = currentTasks[taskIndex];

        if (!task) {
          toast.error(LL.markdownPreview.taskNotFound());
          return;
        }

        const nextChecked = !task.checked;
        const nextContent = toggleMarkdownTask(currentContent, task);

        latestContentRef.current = nextContent;

        setTaskCheckedOverrides((prev) => ({
          ...prev,
          [taskIndex]: nextChecked,
        }));

        try {
          await fileApi.updateMarkdownFileBody(sourcePath, nextContent);
        } catch (error) {
          latestContentRef.current = currentContent;

          setTaskCheckedOverrides((prev) => {
            const next = { ...prev };
            delete next[taskIndex];
            return next;
          });

          toast.error(
            LL.markdownPreview.updateTaskFailed({ error: String(error) }),
          );
        }
      },
      [LL, sourcePath],
    );

    useEffect(() => {
      setShowMarkdown(false);
      setShowRaw(false);

      const rawTimer = window.setTimeout(() => {
        setShowRaw(true);
      }, rawFallbackDelay);

      const markdownTimer = window.setTimeout(() => {
        startTransition(() => {
          setShowMarkdown(true);
        });
      }, 0);

      return () => {
        clearTimeout(rawTimer);
        clearTimeout(markdownTimer);
      };
    }, [renderContent, rawFallbackDelay]);

    const scrollByViewport = (direction: 1 | -1) => {
      const el = containerRef.current;
      if (!el) return;

      const amount = el.clientHeight * 0.2;

      el.scrollBy({
        top: amount * direction,
        behavior: "smooth",
      });
    };

    useImperativeHandle(ref, () => ({
      scrollDown: () => scrollByViewport(1),

      scrollUp: () => scrollByViewport(-1),

      scrollToTop: () => {
        containerRef.current?.scrollTo({
          top: 0,
          behavior: "auto",
        });
      },

      copyCodeBlock: copyCodeBlockByIndex,
    }));

    const hasSelectedText = () => {
      const selection = window.getSelection();

      return Boolean(selection && !selection.isCollapsed);
    };

    return (
      <div
        key={id}
        ref={containerRef}
        className="h-full w-full overflow-y-auto"
      >
        <div className="mx-auto max-w-3xl px-6 py-5">
          {!showMarkdown && showRaw && (
            <pre className="select-text whitespace-pre-wrap break-words font-mono text-sm leading-7 opacity-80">
              {renderContent}
            </pre>
          )}

          {showMarkdown && (
            <article
              className="
                prose max-w-none select-text break-words
                prose-headings:text-text-main
                prose-p:text-text-main
                prose-strong:text-text-main
                prose-em:text-text-main
                prose-li:text-text-main
                prose-ol:text-text-main
                prose-ul:text-text-main
                prose-blockquote:text-text-muted
                prose-blockquote:border-accent
                prose-hr:border-border-main
                prose-th:text-text-main
                prose-td:text-text-main
                prose-code:text-text-main
                prose-code:before:content-none
                prose-code:after:content-none
                prose-pre:bg-transparent
                prose-a:text-accent
                hover:prose-a:underline
              "
            >
              <ReactMarkdown
                remarkPlugins={[
                  remarkGfm,
                  remarkTaskIndex,
                  remarkSoftLineBreaks,
                ]}
                urlTransform={(url) => url}
                components={{
                  a: ({ node, ...props }) => (
                    <a
                      {...props}
                      className="text-accent hover:underline"
                      target="_blank"
                      rel="noopener noreferrer"
                    />
                  ),

                  img: ({ src, alt, ...props }) => {
                    if (isLocalFileUrl(src)) {
                      const extension = getExtension(src);
                      const fileSrc = convertFileSrc(
                        normalizeLocalFilePath(src),
                      );
                      const label = alt ?? "";

                      if (extension === "pdf") {
                        return (
                          <iframe
                            title={label || "PDF preview"}
                            src={fileSrc}
                            className="not-prose h-[75vh] min-h-96 w-full rounded-lg border border-border-main bg-main-bg"
                          />
                        );
                      }

                      if (extension in AUDIO_MIME_TYPES) {
                        return (
                          <figure className="not-prose my-4 border-y border-border-main py-4">
                            {label && (
                              <figcaption className="mb-3 break-words text-sm font-medium text-text-main">
                                {label}
                              </figcaption>
                            )}
                            <audio
                              controls
                              preload="metadata"
                              className="w-full"
                            >
                              <source
                                src={fileSrc}
                                type={AUDIO_MIME_TYPES[extension]}
                              />
                            </audio>
                          </figure>
                        );
                      }

                      if (extension in VIDEO_MIME_TYPES) {
                        return (
                          <figure className="not-prose my-4 bg-black">
                            <video
                              controls
                              preload="metadata"
                              playsInline
                              title={label || "Video preview"}
                              className="max-h-[75vh] w-full bg-black"
                            >
                              <source
                                src={fileSrc}
                                type={VIDEO_MIME_TYPES[extension]}
                              />
                            </video>
                            {label && (
                              <figcaption className="border-y border-border-main bg-main-bg px-3 py-2 break-words text-sm text-text-muted">
                                {label}
                              </figcaption>
                            )}
                          </figure>
                        );
                      }

                      return (
                        <img
                          {...props}
                          src={fileSrc}
                          alt={label}
                          className="max-h-[70vh] max-w-full rounded-lg object-contain"
                          loading="lazy"
                        />
                      );
                    }

                    return (
                      <img
                        {...props}
                        src={src}
                        alt={alt ?? ""}
                        className="max-h-[70vh] max-w-full rounded-lg object-contain"
                        loading="lazy"
                      />
                    );
                  },

                  li: ({ node, children, ...props }) => {
                    const taskIndexValue = (props as any)["data-task-index"];

                    if (taskIndexValue === undefined) {
                      return <li {...props}>{children}</li>;
                    }

                    const taskIndex = Number(taskIndexValue);

                    if (taskIndexValue === undefined) {
                      return <li {...props}>{children}</li>;
                    }

                    return (
                      <li
                        {...props}
                        className="list-none -ml-7 cursor-pointer"
                        onClick={(event) => {
                          if (hasSelectedText()) {
                            return;
                          }

                          if (shouldIgnoreTaskToggle(event.target)) {
                            return;
                          }

                          if (
                            isNestedTaskClick(
                              event.target,
                              event.currentTarget,
                            )
                          ) {
                            return;
                          }

                          void toggleTask(taskIndex);
                        }}
                      >
                        {React.Children.map(children, (child) => {
                          if (
                            React.isValidElement(child) &&
                            child.type === "input" &&
                            (child.props as any).type === "checkbox"
                          ) {
                            const fallbackChecked =
                              tasks[taskIndex]?.checked ??
                              Boolean((child.props as any).checked);

                            return React.cloneElement(
                              child as React.ReactElement<any>,
                              {
                                disabled: false,
                                checked:
                                  taskCheckedOverrides[taskIndex] ??
                                  fallbackChecked,
                                onChange: () => {
                                  void toggleTask(taskIndex);
                                },
                                onClick: (event: React.MouseEvent) => {
                                  event.stopPropagation();
                                },
                                className: "cursor-pointer mr-1",
                              },
                            );
                          }

                          return child;
                        })}
                      </li>
                    );
                  },

                  code({ children, className, ...props }: any) {
                    return (
                      <code className={className} {...props}>
                        {children}
                      </code>
                    );
                  },

                  pre({ children }) {
                    const child = React.Children.toArray(children)[0];

                    if (!React.isValidElement(child)) {
                      return <pre>{children}</pre>;
                    }

                    const props = child.props as {
                      className?: string;
                      children?: React.ReactNode;
                    };

                    const match = /language-(\w+)/.exec(props.className || "");
                    const language = match?.[1] ?? "text";
                    const code = String(props.children ?? "").replace(
                      /\n$/,
                      "",
                    );

                    const block =
                      codeBlocks.find(
                        (block) =>
                          block.content === code &&
                          (block.language ?? "text") === language,
                      ) ?? codeBlocks.find((block) => block.content === code);

                    if (
                      (block?.language ?? language).toLowerCase() === "mermaid"
                    ) {
                      return <MermaidBlock content={block?.content ?? code} />;
                    }

                    return (
                      <CodeBlock
                        index={block?.index ?? 0}
                        language={block?.language ?? language}
                        content={block?.content ?? code}
                        onCopy={copyCodeBlockWithToast}
                      />
                    );
                  },
                }}
              >
                {renderContent}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>
    );
  },
);

MarkdownPreview.displayName = "MarkdownPreview";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { openerApi } from "@/api/opener";
import { pluginsApi } from "@/api/plugins";
import type { TranslationFunctions } from "@/i18n/i18n-types";

export const usePluginReadme = (pluginId: string, LL: TranslationFunctions) => {
  const [readmeState, setReadmeState] = useState<{
    content: string;
    error: string | null;
    loading: boolean;
  }>({
    content: "",
    error: null,
    loading: false,
  });

  useEffect(() => {
    let cancelled = false;

    setReadmeState({ content: "", error: null, loading: true });

    void pluginsApi
      .getReadmeSource(pluginId)
      .then((readme) => {
        if (!cancelled) {
          setReadmeState({
            content: readme.source,
            error: null,
            loading: false,
          });
        }
      })
      .catch((error) => {
        if (cancelled) {
          return;
        }

        const message = String(error);

        setReadmeState({
          content: "",
          error: isPluginReadmeMissing(message)
            ? null
            : LL.pluginPage.installed.readmeLoadError(),
          loading: false,
        });
      });

    return () => {
      cancelled = true;
    };
  }, [LL, pluginId]);

  return readmeState;
};

const isPluginReadmeMissing = (message: string) =>
  message.toLowerCase().includes("plugin readme not found");

export const PluginReadmeMarkdown = ({
  content,
  baseUrl,
}: {
  content: string;
  baseUrl?: string;
}) => (
  <div
    className="
      prose prose-sm mt-3 max-w-none select-text break-words text-sm
      [--tw-prose-body:var(--text-main)]
      [--tw-prose-headings:var(--text-main)]
      [--tw-prose-links:var(--accent)]
      [--tw-prose-bold:var(--text-main)]
      [--tw-prose-counters:var(--text-muted)]
      [--tw-prose-bullets:var(--text-muted)]
      [--tw-prose-hr:var(--border)]
      [--tw-prose-quotes:var(--text-main)]
      [--tw-prose-quote-borders:var(--accent)]
      [--tw-prose-code:var(--text-main)]
      [--tw-prose-pre-code:var(--text-main)]
      [--tw-prose-pre-bg:var(--main-bg)]
      prose-headings:mt-4 prose-headings:mb-2
      prose-p:my-2 prose-li:text-text-main
      prose-code:before:content-none prose-code:after:content-none
      prose-pre:bg-main-bg prose-a:text-accent
    "
  >
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        a: ({ href, children }) => {
          const resolvedHref = resolvePluginReadmeLink(href, baseUrl);

          return (
            <button
              type="button"
              onClick={() => {
                if (resolvedHref) {
                  openPluginReadmeLink(resolvedHref);
                }
              }}
              disabled={!resolvedHref}
              className="text-left text-accent hover:underline disabled:text-text-muted"
            >
              {children}
            </button>
          );
        },
        img: ({ alt }) =>
          alt ? <span className="text-text-muted">{alt}</span> : null,
      }}
    >
      {content}
    </ReactMarkdown>
  </div>
);

const resolvePluginReadmeLink = (
  href: string | undefined,
  baseUrl: string | undefined,
) => {
  if (!href) {
    return null;
  }

  try {
    const url = baseUrl ? new URL(href, baseUrl) : new URL(href);

    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
};

const openPluginReadmeLink = (url: string) => {
  void openerApi.openExternalUrl(url).catch((openError) => {
    console.warn("Failed to open plugin README URL:", openError);
  });
};

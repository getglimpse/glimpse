import { Copy } from "lucide-react";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";

type Props = {
  index: number;
  displayIndex?: number;
  language: string | null;
  content: string;
  onCopy: (index: number) => Promise<boolean>;
};

export const CodeBlock = ({
  index,
  displayIndex = index,
  language,
  content,
  onCopy,
}: Props) => {
  const shortcutLabel =
    displayIndex >= 0 && displayIndex < 4
      ? `Copy Codeblock (Ctrl+${displayIndex + 1})`
      : undefined;

  return (
    <div className="relative group my-1 overflow-hidden rounded-md border border-border-main">
      <div className="absolute right-2 top-2 z-10 flex items-center gap-2 opacity-80 group-hover:opacity-100 transition-opacity">
        <button
          type="button"
          className="rounded bg-main-bg/90 px-2 py-0.5 text-[10px] font-mono text-text-muted border border-border-main backdrop-blur hover:text-text-main"
          title={shortcutLabel}
          onClick={() => {
            void onCopy(index);
          }}
        >
          <Copy className="h-3 w-3" />
          <span>#{displayIndex + 1}</span>
        </button>
      </div>

      <SyntaxHighlighter
        style={nord}
        language={language ?? "text"}
        PreTag="div"
        customStyle={{
          margin: 0,
        }}
      >
        {content}
      </SyntaxHighlighter>
    </div>
  );
};
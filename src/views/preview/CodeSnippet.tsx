import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { nord } from "react-syntax-highlighter/dist/esm/styles/prism";

type Props = {
  language?: string;
  children: string;
};

export const CodeSnippet = ({
  language = "text",
  children,
}: Props) => {
  return (
    <div className="my-1 overflow-hidden rounded-md border border-border-main">
      <SyntaxHighlighter
        style={nord}
        language={language}
        PreTag="div"
        customStyle={{
          margin: 0,
        }}
      >
        {children.trim()}
      </SyntaxHighlighter>
    </div>
  );
};
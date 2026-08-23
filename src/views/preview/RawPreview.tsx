import { forwardRef, useImperativeHandle, useRef, useState } from "react";

type Props = {
  id: string;
  content: string;
};

export type RawPreviewHandle = {
  scrollDown: () => void;
  scrollUp: () => void;
  scrollToTop: () => void;
  revealRange: (range: { startByte: number; endByte: number }) => void;
};

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), max);

const utf8ByteLength = (codePoint: number) => {
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
};

const byteOffsetToStringIndex = (text: string, byteOffset: number) => {
  const target = Math.max(0, byteOffset);
  let bytes = 0;
  let index = 0;

  while (index < text.length) {
    const codePoint = text.codePointAt(index);

    if (codePoint === undefined) {
      break;
    }

    const charLength = codePoint > 0xffff ? 2 : 1;
    const nextBytes = bytes + utf8ByteLength(codePoint);

    if (nextBytes > target) {
      break;
    }

    bytes = nextBytes;
    index += charLength;
  }

  return index;
};

export const byteRangeToStringRange = (
  text: string,
  range: { startByte: number; endByte: number },
) => {
  const startByte = clamp(range.startByte, 0, Number.MAX_SAFE_INTEGER);
  const endByte = clamp(range.endByte, startByte, Number.MAX_SAFE_INTEGER);
  const start = byteOffsetToStringIndex(text, startByte);
  const end = Math.max(start, byteOffsetToStringIndex(text, endByte));

  return { start, end };
};

export const RawPreview = forwardRef<RawPreviewHandle, Props>(
  ({ id, content }, ref) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const highlightRef = useRef<HTMLElement>(null);
    const [highlightRange, setHighlightRange] = useState<{
      start: number;
      end: number;
    } | null>(null);

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

      revealRange: (range) => {
        setHighlightRange(byteRangeToStringRange(content, range));

        window.requestAnimationFrame(() => {
          highlightRef.current?.scrollIntoView({
            block: "center",
            behavior: "smooth",
          });
        });
      },
    }));

    const renderContent = () => {
      if (!highlightRange || highlightRange.start >= highlightRange.end) {
        return content;
      }

      return (
        <>
          {content.slice(0, highlightRange.start)}
          <mark
            ref={highlightRef}
            className="rounded-sm bg-accent/35 px-0.5 text-text-main"
          >
            {content.slice(highlightRange.start, highlightRange.end)}
          </mark>
          {content.slice(highlightRange.end)}
        </>
      );
    };

    return (
      <div
        key={id}
        ref={containerRef}
        className="w-full h-full overflow-y-auto"
      >
        <div className="p-10 max-w-4xl mx-auto">
          <pre className="font-mono text-sm whitespace-pre-wrap select-text break-words opacity-90 leading-7">
            {renderContent()}
          </pre>
        </div>
      </div>
    );
  },
);

RawPreview.displayName = "RawPreview";

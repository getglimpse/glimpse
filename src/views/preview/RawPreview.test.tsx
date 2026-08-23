// @vitest-environment jsdom

import { createRef } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RawPreview, byteRangeToStringRange } from "./RawPreview";
import type { RawPreviewHandle } from "./RawPreview";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RawPreview", () => {
  it("maps UTF-8 byte ranges to JavaScript string ranges", () => {
    expect(
      byteRangeToStringRange("abcあなたdef", {
        startByte: 3,
        endByte: 12,
      }),
    ).toEqual({
      start: 3,
      end: 6,
    });

    expect(
      byteRangeToStringRange("a😀b", {
        startByte: 1,
        endByte: 5,
      }),
    ).toEqual({
      start: 1,
      end: 3,
    });
  });

  it("reveals and highlights a UTF-8 byte range", async () => {
    const scrollIntoView = vi.fn();
    const animationFrames: FrameRequestCallback[] = [];

    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    Object.defineProperty(window, "requestAnimationFrame", {
      configurable: true,
      value: (callback: FrameRequestCallback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      },
    });

    const ref = createRef<RawPreviewHandle>();

    render(<RawPreview ref={ref} id="raw" content="abcあなたdef" />);

    await act(async () => {
      ref.current?.revealRange({
        startByte: 3,
        endByte: 12,
      });
    });

    await waitFor(() => {
      expect(screen.getByText("あなた").tagName.toLowerCase()).toBe("mark");
    });

    await act(async () => {
      animationFrames.splice(0).forEach((callback) => callback(0));
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });
});

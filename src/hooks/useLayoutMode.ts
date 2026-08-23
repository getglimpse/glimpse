import { useState } from "react";

export type LayoutMode = "launcher" | "normal" | "wide";

export const useLayoutMode = (initialMode: LayoutMode = "normal") => {
  const [layoutMode, setLayoutMode] = useState<LayoutMode>(initialMode);

  const showItemList =
    layoutMode === "normal" || layoutMode === "launcher";

  const showPreview =
    layoutMode === "normal" || layoutMode === "wide";

  const togglePreviewLayout = () => {
    setLayoutMode((prev) => {
      if (prev === "launcher") return "normal";
      if (prev === "normal") return "wide";
      return "normal";
    });
  };

  const toggleLauncherLayout = () => {
    setLayoutMode((prev) => {
      if (prev === "launcher") return "normal";
      return "launcher";
    });
  };

  return {
    layoutMode,
    setLayoutMode,
    showItemList,
    showPreview,
    togglePreviewLayout,
    toggleLauncherLayout,
  };
};
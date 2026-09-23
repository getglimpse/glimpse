import { useEffect, useRef } from "react";
import type { Dispatch, SetStateAction } from "react";

import { previewApi } from "@/api/preview";
import type { SearchResult } from "@/types";

export type LoadedPreview = {
  itemId: string;
  preview: SearchResult["item"]["preview"];
};

export const useSelectedItemPreview = (
  itemId: string | null,
  setLoadedPreview: Dispatch<SetStateAction<LoadedPreview | null>>,
) => {
  const generationRef = useRef(0);

  useEffect(() => {
    const generation = ++generationRef.current;
    setLoadedPreview(null);
    if (!itemId) return;

    const timer = window.setTimeout(() => {
      void previewApi
        .getPreview(itemId)
        .then((preview) => {
          if (preview && generation === generationRef.current) {
            setLoadedPreview({ itemId, preview });
          }
        })
        .catch((error) => {
          console.error("Failed to load preview:", error);
        });
    }, 80);

    return () => {
      window.clearTimeout(timer);
      generationRef.current += 1;
    };
  }, [itemId, setLoadedPreview]);
};

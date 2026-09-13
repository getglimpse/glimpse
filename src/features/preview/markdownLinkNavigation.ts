import type { MarkdownLinkResolution } from "@/api/search";
import type { ExternalToast } from "@/utils/toast";
import type { IndexItem, Preview } from "@/types";

type ToastApi = {
  error: (message: string, data?: ExternalToast) => void;
  warning: (message: string, data?: ExternalToast) => void;
};

type OpenFileCreatorTabParams = {
  filePath?: string;
  initialTitle?: string;
  extension?: "md" | "gjson";
  initialBody?: string;
};

type OpenMarkdownLinkParams = {
  sourcePath: string | null | undefined;
  href: string;
  sourceFileNotFoundMessage: string;
  resolveMarkdownLink: (
    sourcePath: string,
    href: string,
  ) => Promise<MarkdownLinkResolution>;
  getPreview: (id: string) => Promise<Preview | null>;
  openPreviewTab: (item: IndexItem) => void;
  openFileCreatorTab: (params?: OpenFileCreatorTabParams) => void;
  toast: ToastApi;
};

const titleFromPath = (filePath: string) => {
  const name = filePath.split(/[\\/]/).pop() ?? "";

  return name.includes(".") ? name.replace(/\.[^.]+$/, "") : name;
};

const extensionFromPath = (filePath: string) => {
  const name = filePath.split(/[\\/]/).pop() ?? "";
  const extension = name.includes(".") ? name.split(".").pop() : undefined;

  return extension?.toLowerCase() ?? "";
};

export const missingMarkdownLinkCreatorParams = (
  filePath: string,
): OpenFileCreatorTabParams => {
  const extension = extensionFromPath(filePath) === "gjson" ? "gjson" : "md";

  return {
    filePath,
    initialTitle: titleFromPath(filePath),
    extension,
  };
};

export const openMarkdownLink = async ({
  sourcePath,
  href,
  sourceFileNotFoundMessage,
  resolveMarkdownLink,
  getPreview,
  openPreviewTab,
  openFileCreatorTab,
  toast,
}: OpenMarkdownLinkParams) => {
  if (!sourcePath) {
    toast.error(sourceFileNotFoundMessage);
    return;
  }

  try {
    const resolution = await resolveMarkdownLink(sourcePath, href);

    if (resolution.status === "found" && resolution.item) {
      const preview = await getPreview(resolution.item.id);
      openPreviewTab({
        ...resolution.item,
        preview: preview ?? resolution.item.preview,
      });
      return;
    }

    if (resolution.status === "existsUnindexed") {
      toast.warning(`Link target exists but is not indexed yet: ${href}`);
      return;
    }

    if (resolution.createPath) {
      toast.warning(`Link target not found: ${href}`, {
        action: {
          label: "Create",
          onClick: () =>
            openFileCreatorTab(
              missingMarkdownLinkCreatorParams(resolution.createPath!),
            ),
        },
      });
      return;
    }

    toast.warning(`Link target not found: ${href}`);
  } catch (error) {
    toast.error(`Failed to open link: ${String(error)}`);
  }
};

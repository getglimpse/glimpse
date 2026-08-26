import { isValidElement, type ReactNode } from "react";
import { CopyIcon } from "lucide-react";
import { toast as sonnerToast, type ExternalToast } from "sonner";

import { copyText } from "@/utils/clipboard";

type ToastMessage = ReactNode | (() => ReactNode);
type ToastOptions = ExternalToast & {
  copy?: boolean;
};

const toastCopyAction = (message: ToastMessage) => ({
  label: (
    <span className="inline-flex items-center">
      <CopyIcon className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Copy</span>
    </span>
  ),
  onClick: () => {
    void copyToastMessage(message);
  },
});

const resolveToastOptions = (
  message: ToastMessage,
  data: ToastOptions | undefined,
  copyByDefault: boolean,
): ExternalToast => {
  const { copy = copyByDefault, ...toastOptions } = data ?? {};

  if (!copy || toastOptions.action) {
    return toastOptions;
  }

  return {
    ...toastOptions,
    action: toastCopyAction(message),
  };
};

const copyToastMessage = async (message: ToastMessage) => {
  const text = getToastText(message);

  if (!text) {
    return;
  }

  try {
    await copyText(text);
  } catch (error) {
    console.warn("Failed to copy toast text", error);
  }
};

const getToastText = (message: ToastMessage): string => {
  if (typeof message === "function") {
    return getToastText(message());
  }

  if (typeof message === "string" || typeof message === "number") {
    return String(message);
  }

  if (Array.isArray(message)) {
    return message.map(getToastText).join("");
  }

  if (isValidElement<{ children?: ReactNode }>(message)) {
    return getToastText(message.props.children ?? "");
  }

  return "";
};

const toastWithOptionalCopy = Object.assign(
  (message: ToastMessage, data?: ToastOptions) =>
    sonnerToast(message, resolveToastOptions(message, data, false)),
  {
    success: (message: ToastMessage, data?: ToastOptions) =>
      sonnerToast.success(message, resolveToastOptions(message, data, false)),
    info: (message: ToastMessage, data?: ToastOptions) =>
      sonnerToast.info(message, resolveToastOptions(message, data, false)),
    warning: (message: ToastMessage, data?: ToastOptions) =>
      sonnerToast.warning(message, resolveToastOptions(message, data, false)),
    error: (message: ToastMessage, data?: ToastOptions) =>
      sonnerToast.error(message, resolveToastOptions(message, data, true)),
    message: (message: ToastMessage, data?: ToastOptions) =>
      sonnerToast.message(message, resolveToastOptions(message, data, false)),
    loading: (message: ToastMessage, data?: ToastOptions) =>
      sonnerToast.loading(message, resolveToastOptions(message, data, false)),
    custom: sonnerToast.custom,
    promise: sonnerToast.promise,
    dismiss: sonnerToast.dismiss,
    getHistory: sonnerToast.getHistory,
    getToasts: sonnerToast.getToasts,
  },
);

export { toastWithOptionalCopy as toast };
export type { ToastOptions as ExternalToast };

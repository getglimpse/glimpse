import { isValidElement, type ReactNode } from "react";
import { CopyIcon } from "lucide-react";
import { toast as sonnerToast, type ExternalToast } from "sonner";

import { copyText } from "@/utils/clipboard";

type ToastMessage = ReactNode | (() => ReactNode);

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

const withCopyAction = (
  message: ToastMessage,
  data?: ExternalToast,
): ExternalToast => ({
  ...data,
  action: toastCopyAction(message),
});

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

const toastWithCopy = Object.assign(
  (message: ToastMessage, data?: ExternalToast) =>
    sonnerToast(message, withCopyAction(message, data)),
  {
    success: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.success(message, withCopyAction(message, data)),
    info: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.info(message, withCopyAction(message, data)),
    warning: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.warning(message, withCopyAction(message, data)),
    error: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.error(message, withCopyAction(message, data)),
    message: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.message(message, withCopyAction(message, data)),
    loading: (message: ToastMessage, data?: ExternalToast) =>
      sonnerToast.loading(message, withCopyAction(message, data)),
    custom: sonnerToast.custom,
    promise: sonnerToast.promise,
    dismiss: sonnerToast.dismiss,
    getHistory: sonnerToast.getHistory,
    getToasts: sonnerToast.getToasts,
  },
);

export { toastWithCopy as toast };
export type { ExternalToast };

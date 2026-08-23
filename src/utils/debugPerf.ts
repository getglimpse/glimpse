/**
 * デバッグ用スニペット。
 * 無効化したい場合は下記をコードに追加:
 * 
 * ```ts
 * localStrage.removeItem("glimpse:debug:perf")
 * ```
 * 
 * 有効化したい場合は、次をコードに追加：
 * ```ts
 * localStorage.setItem("glimpse:debug:perf", "1")
 * ```
 */
const isEnabled = () =>
  import.meta.env.DEV &&
  localStorage.getItem("glimpse:debug:perf") === "1";

let actionId = 0;

export const perf = {
  begin(name: string) {
    if (!isEnabled()) return;

    actionId++;

    console.log("");
    console.log(
      `========== [${actionId}] ${name} ==========`);
  },

  end() {
    if (!isEnabled()) return;

    console.log(
      "===================================="
    );
    console.log("");
  },

  start(label: string) {
    if (!isEnabled()) return;

    console.time(`[perf] ${label}`);
  },

  stop(label: string) {
    if (!isEnabled()) return;

    console.timeEnd(`[perf] ${label}`);
  },

  log(label: string, value?: unknown) {
    if (!isEnabled()) return;

    console.log(
      `[perf] ${label}:`,
      value ?? ""
    );
  },
};
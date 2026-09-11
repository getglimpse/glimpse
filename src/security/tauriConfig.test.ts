import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const loadTauriConfig = () =>
  JSON.parse(
    readFileSync(path.join(process.cwd(), "src-tauri", "tauri.conf.json"), {
      encoding: "utf8",
    }),
  ) as {
    app?: {
      security?: {
        assetProtocol?: {
          scope?: {
            allow?: string[];
            deny?: string[];
          };
        };
      };
    };
  };

describe("Tauri security config", () => {
  it("does not expose installed plugin files through the asset protocol", () => {
    const config = loadTauriConfig();
    const scope = config.app?.security?.assetProtocol?.scope;

    expect(scope?.allow).toEqual(["$RESOURCE/**/*"]);
    expect(scope?.deny ?? []).not.toEqual(
      expect.arrayContaining([expect.stringContaining("$APPDATA/plugins")]),
    );
  });
});

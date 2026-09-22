import { afterEach, describe, expect, it } from "vitest";

import type { GlimpsePlugin, PluginInternalPageManifest } from "@/types";

import { localizeInternalPage, setCurrentPluginLocale } from "./i18n";

afterEach(() => {
  setCurrentPluginLocale("en");
});

describe("pluginI18n", () => {
  it("leaves app-owned converter mode labels to Glimpse", () => {
    const plugin: GlimpsePlugin = {
      id: "file-converter-plugin",
      name: "File Converter",
      version: "0.2.0",
      apiVersion: "0.2.0",
    };
    const page: PluginInternalPageManifest = {
      id: "plugin:file-converter-plugin",
      title: "File Converter",
      pageDefinition: {
        id: "plugin:file-converter-plugin",
        tabs: [
          {
            id: "converter",
            type: "converter",
            action: "convertFile",
          },
        ],
      },
    };

    const [tab] = localizeInternalPage(plugin, page).pageDefinition?.tabs ?? [];

    expect(tab).toMatchObject({
      type: "converter",
      createModeLabel: undefined,
      overwriteModeLabel: undefined,
    });
  });

  it("localizes v0.2 converter tab labels", () => {
    const plugin: GlimpsePlugin = {
      id: "file-converter-plugin",
      name: "File Converter",
      version: "0.2.0",
      apiVersion: "0.2.0",
      i18n: {
        ja: {
          "tabs.converter.title": "Converter",
          "pages.converter.drop.description": "日本語の説明",
          "pages.converter.drop.empty": "ここにファイルをドロップ",
          "pages.converter.drop.chooseFile": "ファイルを選択",
          "pages.converter.drop.converting": "変換中",
          "pages.converter.actions.run": "実行",
          "pages.converter.actions.create": "新規作成",
          "pages.converter.actions.overwrite": "上書き",
          "pages.converter.results.title": "結果",
          "pages.converter.results.reveal": "表示",
          "pages.converter.results.clear": "クリア",
          "pages.converter.results.columns.file": "ファイル",
          "pages.converter.results.columns.size": "サイズ",
          "pages.converter.results.columns.path": "パス",
          "pages.converter.results.empty": "出力はまだありません",
        },
      },
    };
    const page: PluginInternalPageManifest = {
      id: "plugin:file-converter-plugin",
      title: "File Converter",
      pageDefinition: {
        id: "plugin:file-converter-plugin",
        tabs: [
          {
            id: "converter",
            type: "converter",
            titleKey: "tabs.converter.title",
            titleFallback: "Converter",
            action: "convertFile",
            descriptionKey: "pages.converter.drop.description",
            descriptionFallback: "Drop files.",
            emptyLabelKey: "pages.converter.drop.empty",
            emptyLabelFallback: "Drop files here",
            chooseFileLabelKey: "pages.converter.drop.chooseFile",
            chooseFileLabelFallback: "Choose Files",
            convertingLabelKey: "pages.converter.drop.converting",
            convertingLabelFallback: "Converting",
            runLabelKey: "pages.converter.actions.run",
            runLabelFallback: "Run",
            createModeLabelKey: "pages.converter.actions.create",
            createModeLabelFallback: "Create new",
            overwriteModeLabelKey: "pages.converter.actions.overwrite",
            overwriteModeLabelFallback: "Overwrite",
            resultsLabelKey: "pages.converter.results.title",
            resultsLabelFallback: "Results",
            revealLabelKey: "pages.converter.results.reveal",
            revealLabelFallback: "Reveal",
            clearLabelKey: "pages.converter.results.clear",
            clearLabelFallback: "Clear",
            fileColumnLabelKey: "pages.converter.results.columns.file",
            fileColumnLabelFallback: "File",
            sizeColumnLabelKey: "pages.converter.results.columns.size",
            sizeColumnLabelFallback: "Size",
            pathColumnLabelKey: "pages.converter.results.columns.path",
            pathColumnLabelFallback: "Path",
            emptyResultsLabelKey: "pages.converter.results.empty",
            emptyResultsLabelFallback: "No output yet",
          },
        ],
      },
    };

    setCurrentPluginLocale("ja");

    const [tab] = localizeInternalPage(plugin, page).pageDefinition?.tabs ?? [];

    expect(tab).toMatchObject({
      title: "Converter",
      description: "日本語の説明",
      emptyLabel: "ここにファイルをドロップ",
      chooseFileLabel: "ファイルを選択",
      convertingLabel: "変換中",
      runLabel: "実行",
      createModeLabel: "新規作成",
      overwriteModeLabel: "上書き",
      resultsLabel: "結果",
      revealLabel: "表示",
      clearLabel: "クリア",
      fileColumnLabel: "ファイル",
      sizeColumnLabel: "サイズ",
      pathColumnLabel: "パス",
      emptyResultsLabel: "出力はまだありません",
    });
  });

  it("localizes Form result copy labels", () => {
    const plugin: GlimpsePlugin = {
      id: "password-generator-plugin",
      name: "Password Generator",
      version: "0.2.0",
      apiVersion: "0.2.0",
      i18n: {
        ja: {
          "tabs.generator.result.copy": "パスワードをコピー",
          "tabs.generator.result.copied": "コピーしました",
          "tabs.generator.result.saveLatest": "直近の結果を保存",
          "tabs.generator.result.saveAll": "すべての結果を保存",
          "tabs.generator.result.reset": "結果をリセット",
        },
      },
    };
    const page: PluginInternalPageManifest = {
      id: "plugin:password-generator-plugin",
      title: "Password Generator",
      pageDefinition: {
        id: "plugin:password-generator-plugin",
        tabs: [
          {
            id: "generator",
            type: "form",
            action: "generatePassword",
            result: {
              type: "text",
              copy: true,
              copyLabelKey: "tabs.generator.result.copy",
              copyLabelFallback: "Copy password",
              copiedLabelKey: "tabs.generator.result.copied",
              copiedLabelFallback: "Copied",
              saveLatestLabelKey: "tabs.generator.result.saveLatest",
              saveLatestLabelFallback: "Save latest result",
              saveAllLabelKey: "tabs.generator.result.saveAll",
              saveAllLabelFallback: "Save all results",
              resetLabelKey: "tabs.generator.result.reset",
              resetLabelFallback: "Reset results",
            },
          },
        ],
      },
    };

    setCurrentPluginLocale("ja");

    const [tab] = localizeInternalPage(plugin, page).pageDefinition?.tabs ?? [];

    expect(tab).toMatchObject({
      type: "form",
      result: {
        copy: true,
        copyLabel: "パスワードをコピー",
        copiedLabel: "コピーしました",
        saveLatestLabel: "直近の結果を保存",
        saveAllLabel: "すべての結果を保存",
        resetLabel: "結果をリセット",
      },
    });
  });
});

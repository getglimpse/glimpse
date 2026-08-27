import type { Translation } from "../i18n-types";

const ja = {
  previewPanel: {
    notFound: {
      title: "見つかりません",
      description: "辞書内に一致する項目がありません。",
    },
    unknownPreviewType: "不明なプレビュー種別: {type}",
    debouncing: "更新中...",
    openLink: "リンクを開く",
    inspectItem: "項目を調査",
    toggleViewMode: "表示モード切替",
    copyContent: "本文をコピー",
    openHelp: "ヘルプを開く",
    openSettingsFile: "settings.json を開く",
    loadHtmlPreview: "読み込む",
    loadedHtmlPreview: "読み込み済み",
    openHtmlPreview: "開く",
    textCopied: "テキストをコピーしました",
    noTextToCopy: "コピーするテキストがありません",
    noSourceFilePath: "ソースファイルのパスがありません。",
    openFileFallback: "ファイルを開けなかったため、親フォルダを開きました。",
  },
  searchBar: {
    placeholder: "検索...",
    fullScan: "フルスキャン",
    indexRefreshed: "インデックスを更新しました",
    refreshIndexFailed: "インデックスの更新に失敗しました",
  },
  itemList: {
    searching: "検索中...",
    scanningDictionary: "辞書をスキャンしています",
    noResults: "結果が見つかりません",
    noResultsHint: "別のキーワードを試すか、入力を確認してください。",
    today: "今日",
    yesterday: "昨日",
    daysAgo: "{count}日前",
    snippetSources: {
      body: "本文",
      title: "タイトル",
      alias: "別名",
      tag: "タグ",
    },
  },
  common: {
    close: "閉じる",
    save: "保存",
    reload: "再読み込み",
    command: "コマンド",
    description: "説明",
  },
  appMessages: {
    failedReloadThemes: "テーマの再読み込みに失敗しました。",
    failedRefreshSavedFile: "保存済みファイルの更新に失敗しました: {error}",
    failedReadFile: "ファイルの読み込みに失敗しました: {error}",
    noTargetGroupsConfigured: "ターゲットグループが設定されていません",
    noOtherActiveTargetGroups:
      "切り替え先のアクティブなターゲットグループがありません。",
    switchedTargetGroup: "ターゲットグループを切り替えました: {name}",
    switchTargetGroupFailed:
      "ターゲットグループの切り替えに失敗しました: {error}",
    ranItem: "実行しました: {title}",
    launchedItem: "起動しました: {title}",
    openContainingFolderFailed: "親フォルダを開けませんでした: {error}",
    copyTextFailed: "テキストのコピーに失敗しました: {error}",
  },
  statusBar: {
    indexedItems: "{count} 件表示中",
    target: "ターゲット",
    switchTarget: "ターゲット切替",
    startupWarm: "Warm",
    startupWarmRunning: "{name} {completed}/{total}",
  },
  queryInspector: {
    title: "クエリ情報",
  },
  itemInspector: {
    title: "アイテム情報",
  },

  /**
   * Internal Pages
   */
  aboutPage: {
    title: "Glimpse について",
    subtitle: "ローカル優先の検索・コマンドランチャーです。",
    overview: {
      title: "概要",
      description1:
        "Glimpse はローカル辞書の検索、参照の表示、信頼済みコマンドの実行を行う軽量ランチャーです。",
      description2:
        "高速なキーボード操作、ローカル優先のインデックス、Markdown / JSON ベースのシンプルなコンテンツを前提に設計されています。",
      githubHomepage: "GitHub Homepage",
      reportIssue: "Issue を報告",
    },
    application: "アプリケーション",
    technicalDetails: "技術情報",
    features: "機能",
    labels: {
      name: "名前",
      version: "バージョン",
      build: "ビルド",
      license: "ライセンス",
      frontend: "フロントエンド",
      desktopRuntime: "デスクトップランタイム",
      searchEngine: "検索エンジン",
      indexFormats: "インデックス形式",
      commandExecution: "コマンド実行",
      security: "セキュリティ",
    },
  },
  convertPage: {
    title: "単位変換",
    description: "{command} と入力して Enter を押します。",
    help: "現在対応しているのは、長さ(mm, cm,m, km, in, inch, ft)、重さ(mg, g, kg, lb)、温度、データサイズ(b, kb, mb, gb, tb)、時間(s, sec, min, h, year, day)です。",
    errors: {
      unsupportedConversion: "対応していない変換形式です",
      unsupportedUnit: "対応していない単位です",
      incompatibleUnits: "互換性のない単位です",
    },
    dialog: {
      title: "単位変換",
      description: "異なる単位へ変換します。",
      examples: "使用例",
      commandsTitle: "コマンド",
      commands: {
        mm: "ミリメートル",
        cm: "センチメートル",
      },
    },
  },
  datePage: {
    title: "日付計算",
    description: "{command} と入力して Enter を押します。",
    help: "現在対応: today, today + 7d, today - 7d",
    errors: {
      unsupportedExpression: "未対応の日付式です",
    },
    dialog: {
      title: "日付計算",

      description: "日付の加算・減算を行います。",

      examples: "使用例",
      commandsTitle: "コマンド",
      commands: {
        today: "今日の日付",
      },
    },
  },
  numericPage: {
    title: "数値計算",
    description: "{command} と入力して Enter を押します。",
    help: "対応: 四則演算、sqrt、pow、abs、round、floor、ceil、min、max、pi、e",
    errors: {
      importDisabled: "import は無効です",
      createUnitDisabled: "createUnit は無効です",
      invalidResult: "無効な計算結果です",
    },
    dialog: {
      title: "電卓",
      description:
        "計算ページです。数式を入力して Enter を押すと結果を表示します。",
      examples: "使用例",
      commandsTitle: "コマンド",
      commands: {
        abs: "絶対値",
        sqrt: "平方根",
        pi: "円周率",
      },
    },
  },
  debugPage: {
    title: "デバッグ",
    subtitle: "内部診断情報です。",
    loading: "デバッグ情報を読み込んでいます...",
    loadError: "デバッグ情報の読み込みに失敗しました: {error}",
    sections: {
      index: "インデックス",
      previewTypes: "プレビュー種別",
      openActions: "Open Action",
      indexer: "インデクサー",
      filters: "フィルター",
      ignorePatterns: "無視パターン",
      commandExecutionLogs: "コマンド実行ログ",
    },
    labels: {
      totalItems: "総アイテム数",
      starItems: "スター",
      taggedItems: "タグ付き",
      aliasItems: "エイリアス付き",
      markdown: "Markdown",
      raw: "Raw",
      external: "外部",
      commandItems: "コマンド項目",
      externalOpenItems: "外部オープン項目",
      indexedItems: "インデックス済み項目",
      watchStatus: "監視状態",
      lastScan: "最終スキャン",
      startupWarmStatus: "起動時 warm",
      startupWarmCurrent: "現在の warm 対象",
      startupWarmProgress: "warm 進捗",
      startupWarmError: "warm エラー",
      ignoreHiddenFiles: "隠しファイルを無視",
      maxFileSize: "最大ファイルサイズ",
    },
    values: {
      notAvailable: "N/A",
      unlimited: "無制限",
      bytes: "{value} bytes",
    },
    messages: {
      noIgnorePatterns: "無視パターンはありません",
      noCommandLogs: "コマンドログはありません",
      details: "詳細",
      openLogsFolder: "ログフォルダを開く",
    },
  },
  commandHistoryPage: {
    title: "コマンド履歴",
    empty: "まだ実行履歴はありません。",
    copyResult: "コマンド結果をコピー",
    details: "詳細",
    target: "対象",
    input: "入力",
    status: {
      success: "成功",
      error: "エラー",
    },
    kind: {
      command: "コマンド",
      pageAction: "ページアクション",
      pluginAction: "プラグインアクション",
    },
  },
  shortcutsPage: {
    title: "キーボードショートカット",
    subtitle: "Glimpse で現在利用できるキーボードショートカットです。",
    groups: {
      search: "検索",
      navigation: "ナビゲーション",
      files: "ファイル",
      preview: "プレビュー",
      codeCopy: "コードコピー",
      view: "表示",
      internal: "内部機能",
      plugin: "プラグイン",
    },
    actions: {
      focusSearch: "検索欄にフォーカス",
      moveDown: "選択を下へ移動",
      moveUp: "選択を上へ移動",
      openSelected: "選択中の項目を開く",
      revealSelected: "選択中の項目を表示",
      scrollPreviewDown: "プレビューを下へスクロール",
      scrollPreviewUp: "プレビューを上へスクロール",
      pinPreview: "現在のプレビューを固定",
      nextPreviewTab: "次のプレビュータブへ移動",
      previousPreviewTab: "前のプレビュータブへ移動",
      closePreviewTab: "プレビュータブを閉じる",
      togglePreviewMode: "Markdown / Raw 表示を切り替え",
      toggleSidebar: "サイドバーを切り替え",
      toggleCompactMode: "コンパクトモードを切り替え",
      switchTargetGroup: "ターゲットグループを切り替え",
      openQueryInspector: "Query Inspector を開く",
      openItemHelp: "現在のページのヘルプを開く",
      openHelp: "ヘルプを開く",
      moveDownPage: "1ページ下へ移動",
      moveUpPage: "1ページ上へ移動",
      openSourceFile: "ソースファイルを開く",
      revealSourceDirectory: "ソースフォルダを表示",
      createFile: "ファイルを作成",
      editActivePage: "現在のページを編集",
      closePreview: "プレビューを閉じる",
      copyCodeBlock: "コードブロック #{index} をコピー",
      showHideWindow: "ウィンドウを表示 / 非表示",
      openSettingsFile: "settings.json を開く",
      copyPreviewContent: "プレビュー本文をコピー",
    },
    messages: {
      loading: "ショートカットを読み込んでいます...",
      failedToUpdate: "ショートカットの更新に失敗しました",
      removeShortcut: "ショートカットを削除",
      addShortcut: "ショートカットを追加",
      pressShortcut: "ショートカットを入力",
    },
  },
  pluginPage: {
    title: "プラグイン管理",
    subtitle:
      "インストール済みの Glimpse プラグインと Internal Page contribution を管理します。",
    sections: {
      installedPlugins: "インストール済みプラグイン",
      pluginModel: "プラグインモデル",
      capabilities: "機能",
      featurePages: "Feature Pages",
    },
    installed: {
      enabledSummary: "{total} 件中 {enabled} 件が有効",
      loadedFromConfig: "config plugins から読み込み",
      loadError: "プラグインの読み込みに失敗しました: {error}",
      empty: "プラグインは見つかりませんでした。",
      installPlaceholder: "ローカルプラグインフォルダのパス（1行に1つ）",
      installDropHint:
        "1つ以上のローカルプラグインフォルダをここにドロップするか、下にパスを貼り付けてください。",
      installReplaceHint:
        "manifest.json の id がインストール済みプラグインと同じ場合は自動で置き換えます。",
      replace: "置き換え",
      install: "インストール",
      installing: "インストール中",
      openFolder: "フォルダを開く",
      installSuccess:
        "{pluginId} をインストールしました。有効化する前に信頼してください。",
      installFailed: "インストールに失敗しました: {error}",
      searchPlaceholder: "インストール済みプラグインを検索",
      noSearchResults: "一致するプラグインはありません。",
      reloadAll: "すべて再読み込み",
    },
    pluginModel: {
      package: {
        label: "パッケージ",
        value: "配布単位",
      },
      capability: {
        label: "Capability",
        value: "Viewer, extractor, thumbnailer, block, template",
      },
      runtime: {
        label: "Runtime",
        value: "frontend, worker",
      },
      permissionScope: {
        label: "権限スコープ",
        value: "Capability 単位の宣言",
      },
    },
    capabilities: {
      viewer: {
        name: "Viewer",
        description:
          "PDF、音声、動画、Office preview などのファイル表示を提供します。",
      },
      extractor: {
        name: "Extractor",
        description:
          "テキスト、メタデータ、章、キャプション、検索可能な内容を抽出します。",
      },
      thumbnailer: {
        name: "Thumbnailer",
        description:
          "表紙画像、ページサムネイル、動画キーフレーム、波形を生成します。",
      },
      pageBlock: {
        name: "Page Block",
        description:
          "ユーザー作成の Feature Page で使える再利用可能なブロックを提供します。",
      },
      featureTemplate: {
        name: "Feature Template",
        description:
          "コレクション、プレイリスト、ドキュメントハブなどのカスタムページの雛形を提供します。",
      },
    },
    featurePages: {
      description:
        "Feature Page は Core が所有し、プラグインは page block と template を提供します。これにより、各プラグインにページ全体の制御を渡さずに、カスタムページを組み合わせられます。",
    },
    pluginRow: {
      internalPageCount: "Internal Page {count} 件",
      enabled: "有効",
      disabled: "無効",
      trusted: "信頼済み",
      untrusted: "未信頼",
      trustRequired:
        "このプラグインを信頼するまで、Glimpse はコードを読み込みません。",
      trust: "信頼する",
      revokeTrust: "信頼を解除",
      trusting: "信頼設定を更新中",
      uninstall: "アンインストール",
      uninstalling: "アンインストール中",
      uninstallConfirm:
        "{name} をアンインストールしますか？ インストール済みプラグインディレクトリを削除します。",
      uninstallSuccess: "{pluginId} をアンインストールしました。",
      uninstallFailed: "アンインストールに失敗しました: {error}",
      on: "ON",
      off: "OFF",
      toggleLabel: "{name} を切り替え",
    },
  },
  settingsPage: {
    title: "設定",
    subtitle: "Glimpse の動作を設定します。",
    appearance: {
      title: "外観",
      description: "Glimpse の見た目を変更します。",
      noCustomThemes: "カスタムテーマはありません。",
      openThemesFolder: "テーマフォルダを開く",
      reloadThemes: "テーマを再読み込み",
      selectTheme: "テーマを選択",
      noThemeSelected: "テーマが選択されていません",
      searchTheme: "テーマを検索...",
      noThemesFound: "テーマは見つかりませんでした。",
      builtInTheme: "組み込み",
      customTheme: "カスタム",
    },
    targetGroups: {
      title: "ターゲットグループ",
      description: "検索対象ディレクトリを管理します。",
      create: "ターゲットグループの作成",
      edit: "ターゲットグループの編集",
      none: "ターゲットグループは設定されていません。",
      addGroup: "グループを追加",
      addHint: "検索パスを管理するにはターゲットグループを追加してください。",
      targetGroupName: "ターゲットグループ名",
      active: "アクティブ",
      inactive: "非アクティブ",
      current: "現在使用中",
      makeCurrent: "切り替え",
      activeToggle: "{name} を Ctrl+R のサイクルに含める",
      removeTargetGroup: "ターゲットグループを削除",
      addPathPlaceholder: "パスを入力して Enter",
      addPath: "フォルダを選択",
      noPaths: "パスはありません",
      pathFor: "{name} のパス",
      removePath: "パスを削除",
    },
    ui: {
      title: "UI",
      description: "表示密度と言語を調整します。",
      compactListItems: "リスト項目をコンパクトにする",
      compactListItemsDescription: "検索結果の行を詰めて表示します。",
      language: "言語",
      languageDescription: "インターフェースの言語を変更します。",
    },
    experimental: {
      title: "実験的機能",
      description: "アプリや OS の挙動に依存する機能を試します。",
      captureSelectedTextOnActivation: "選択テキストをクエリに使う",
      captureSelectedTextOnActivationDescription:
        "別のアプリから Glimpse を開いたとき、選択中のテキストを読み取って検索欄に入れます。",
    },
    security: {
      title: "セキュリティ",
      description: "実行できるコマンド項目を制御します。",
      commandPolicy: "コマンドポリシー",
      commandPolicyDescription:
        "Glimpse がコマンド実行可否を判断する方法を選びます。",
      whitelistCommands: "許可コマンド",
      whitelistDescription: "Whitelist モードで許可されるコマンドです。",
      blacklistCommands: "拒否コマンド",
      blacklistDescription: "Blacklist モードで拒否されるコマンドです。",
      add: "追加",
      noCommands: "コマンドはありません",
    },
    advanced: {
      title: "詳細設定",
      description: "生の settings.json を開きます。",
      openSettings: "settings.json を開く",
    },
    messages: {
      invalidTargetGroupName:
        "ターゲットグループ名に使えるのは、文字、数字、スペース、'-'、'_' のみです。",
      duplicateTargetGroupName: "同じ名前のターゲットグループが既にあります。",
      addTargetGroupFailed: "ターゲットグループの追加に失敗しました。",
      renameTargetGroupFailed: "ターゲットグループ名の変更に失敗しました。",
      removeTargetGroupFailed: "ターゲットグループの削除に失敗しました。",
      currentTargetGroupMustBeActive:
        "現在使用中のターゲットグループは非アクティブにできません。",
      updateTargetGroupActiveFailed:
        "ターゲットグループのアクティブ状態の更新に失敗しました。",
      makeCurrentTargetGroupFailed:
        "このターゲットグループを現在使用中にできませんでした。",
      duplicateTargetPath: "このパスは既に登録されています。",
      addTargetPathFailed: "ターゲットパスの追加に失敗しました。",
      emptyTargetPath: "ターゲットパスは空にできません。",
      updateTargetPathFailed: "ターゲットパスの更新に失敗しました。",
      removeTargetPathFailed: "ターゲットパスの削除に失敗しました。",
    },
  },
  helpPage: {
    title: "ヘルプ",
    description:
      "Glimpse の検索、ターゲットグループ、内部ページ、ショートカットのクイックリファレンスです。",
    groups: {
      usage: "検索、ターゲットグループ、内部ページ、ショートカット",
    },

    search: {
      title: "検索",
      description: "キーワードでインデックス済み項目を検索します。",
      currentGroup: "Current Target Group を検索",
      tag: "タグで絞り込み",
      hidden: "Current Target Group の hidden 項目を検索",
      global: "すべてのターゲットグループを検索",
      commandArgs: "選択中のコマンド項目に引数を渡す",
    },

    open: {
      title: "open",
      file: "ソースファイルを開く",
      url: "外部 URL を開く",
      command: "コマンドを実行",
      path: "コマンドパス",
      openUrl: "URL",
      openCommand: "コマンドパス",
    },

    internalPages: {
      title: "内部ページ",
      help: "ヘルプを開く",
      settings: "設定を開く",
      about: "About を開く",
      debug: "Debug を開く",
      shortcuts: "キーボードショートカットを開く",
      metadata: "メタデータヘルプを開く",
      commandHistory: "Command History を開く",
      tagCloud: "Tag Cloud を開く",
      plugin: "Plugins を開く",
    },

    targetGroups: {
      title: "ターゲットグループ",
      current: "通常検索で使用するターゲットグループです",
      active: "Ctrl+R のサイクルに含まれます",
      inactive: "設定には残りますが Ctrl+R のサイクルからは外れます",
      switch: "Active Target Group の中で Current Target Group を切り替えます",
      settings: "ターゲットグループと対象フォルダを編集します",
      globalSearch: "すべてのターゲットグループを検索",
    },

    shortcuts: {
      title: "ショートカット",
      open: "選択中の項目を開く、または実行",
      sidebar: "サイドバーを切り替え",
      inspector: "Query Inspector を開く",
      switchGroup: "Current Target Group を切り替え",
    },

    more: {
      title: "さらに詳しく",
      shortcuts: ":shortcuts で全ショートカットを確認できます。",
      settings: ":settings で設定項目を確認できます。",
      metadata: ":metadata で Markdown メタデータと .gjson 項目を確認できます。",
      about: ":about でバージョンと技術情報を確認できます。",
    },
  },
  metadataHelpPage: {
    title: "メタデータ",
    description:
      "Markdown frontmatter、.gjson index、コマンド項目、open 動作のリファレンスです。",

    metadata: {
      title: "Markdown メタデータ",
      description:
        "Markdown ファイルの先頭に小さな YAML frontmatter を追加して、検索メタデータと Enter 実行時の動作を制御できます。",
      fields: {
        title: "検索結果に表示するタイトル",
        tags: "検索タグ。複数指定できます",
        aliases: "別名や略称。検索対象になります",
        star: "true の場合、検索結果で優先されます",
        hidden: "通常検索から隠し、! 検索でのみ表示します",
        commandOpenType: "Enter でコマンドを実行します",
        externalOpenType: "Enter で外部 URL を開きます",
        openPath: "command で使うコマンド文字列",
        openUrl: "url で開く URL",
        unknown: "Markdown メタデータパーサーでは無視されます",
      },
    },

    metadataExample: {
      title: "Markdown メタデータ例",
    },

    commands: {
      title: "コマンド",
      description:
        "コマンド項目では、検索バーの > 以降をコマンドライン引数として渡せます。コマンドはシェルを介さず直接実行されます。",
      security: "コマンドはシェルを介さず直接実行されます。",
      runExample: "{command} を実行",
    },

    jsonIndex: {
      title: ".gjson index",
      description:
        ".gjson ファイルでは、1 つの JSON ファイルから複数の検索項目を生成できます。",
      extension:
        "複数項目の JSON index パーサーを使うのは .gjson ファイルのみです",
      items: "items 配列を検索項目の一覧として扱います",
      itemTitle: "各 item の title を使います",
      itemUrl: "外部プレビューと Enter の既定動作に使う URL",
      itemDesc: "検索対象になる説明文と Markdown プレビュー本文",
      metadataTags: "#tag フィルターで使うタグ",
      metadataAliases: "検索対象になる別名",
      metadataStar: "true の場合、検索結果で優先されます",
      metadataHidden: "通常検索から隠し、! 検索でのみ表示します",
      iframe:
        "true なら URL を iframe でプレビューし、false なら Markdown テキストを表示します",
      openOverride:
        "外部 URL やコマンドパスなど、Enter 動作を任意で上書きできます",
    },

    jsonExample: {
      title: ".gjson index 例",
    },
  },
  fileEditor: {
    createFile: "ファイルを作成",
    editFile: "ファイルを編集",
    untitled: "無題",
    title: "タイトル",
    body: "本文",
    fileTitlePlaceholder: "ファイルタイトル",
    bodyPlaceholder: "Markdown を入力...",
    shortcutsHint: "Ctrl+S で保存 / Ctrl+Shift+S で保存して閉じる",
    saving: "保存中...",
    titleRequired: "タイトルは必須です",
    filePathMissing: "ファイルパスがありません",
    noChanges: "変更はありません",
    fileSaved: "ファイルを保存しました",
    fileAlreadyExists: "そのパスにはすでにファイルがあります: {path}",
    gjson: {
      items: "項目",
      addItem: "項目を追加",
      untitledItem: "無題",
      removeItem: "項目を削除",
      missingItemTitle: ".gjson の各項目にはタイトルが必要です。",
      fields: {
        title: "タイトル",
        url: "URL",
        desc: "説明",
        command: "コマンド",
        tags: "タグ",
        aliases: "別名",
        defaultAction: "既定アクション",
      },
      placeholders: {
        tags: "rust, docs",
        aliases: "book, rustbook",
      },
      defaultActionOptions: {
        auto: "自動",
        command: "コマンド",
        url: "URL",
      },
    },
  },
  markdownPreview: {
    copiedCodeBlock: "コードブロック #{index} をコピーしました",
    codeBlockNotFound: "コードブロック #{index} が見つかりません",
    copyCodeBlockFailed: "コードブロックのコピーに失敗しました: {error}",
    sourceFileNotFound: "ソースファイルが見つかりません",
    taskNotFound: "タスクが見つかりません",
    updateTaskFailed: "タスクの更新に失敗しました: {error}",
  },
  tagCloudPage: {
    title: "タグクラウド",
    tags: "{count} 件のタグ",
    tagAssignments: "{count} 件のタグ付け",
    sortByName: "名前順に並べ替え",
    sortByCount: "件数順に並べ替え",
    filterPlaceholder: "タグを絞り込み",
    loadError: "タグの読み込みに失敗しました: {error}",
    searchTag: "#{tag} を検索",
    empty: "タグは見つかりませんでした。",
  },
} satisfies Translation;

export default ja;

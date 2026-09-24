use super::*;

#[test]
fn removes_duplicate_commands() {
    let mut settings = AppSettings::default();

    settings.commands.whitelist = vec!["python".into(), "python".into(), "".into()];

    let settings = normalize_settings(settings);

    assert_eq!(settings.commands.whitelist, vec!["python"]);
}

#[test]
fn normalizes_indexing_extensions_and_migrates_legacy_media_exclusions() {
    let mut settings = AppSettings::default();

    settings.indexing.excluded_extensions = vec![
        "exe".into(),
        "dll".into(),
        "zip".into(),
        "7z".into(),
        "MP4".into(),
        "mov".into(),
        "db".into(),
        "sqlite".into(),
        "sqlite3".into(),
        ".TMP".into(),
        "tmp".into(),
    ];

    let settings = normalize_settings(settings);

    assert!(!settings
        .indexing
        .excluded_extensions
        .contains(&"mp4".to_string()));
    assert!(!settings
        .indexing
        .excluded_extensions
        .contains(&"mov".to_string()));
    assert!(settings
        .indexing
        .excluded_extensions
        .contains(&"tmp".to_string()));
    assert_eq!(
        settings
            .indexing
            .excluded_extensions
            .iter()
            .filter(|extension| extension.as_str() == "tmp")
            .count(),
        1
    );
}

#[test]
fn removes_invalid_target_groups() {
    let settings = AppSettings {
        target_groups: vec![
            TargetGroup {
                id: "".into(),
                name: "Invalid".into(),
                paths: vec![],
                active: true,
            },
            TargetGroup {
                id: "work".into(),
                name: "Work".into(),
                paths: vec![],
                active: true,
            },
        ],
        ..AppSettings::default()
    };

    let settings = normalize_settings(settings);

    assert_eq!(settings.target_groups.len(), 1);
}

#[test]
fn fixes_invalid_current_target_group() {
    let settings = AppSettings {
        target_groups: vec![TargetGroup {
            id: "work".into(),
            name: "Work".into(),
            paths: vec![],
            active: true,
        }],
        current_target_group_id: Some("unknown".into()),
        ..AppSettings::default()
    };

    let settings = normalize_settings(settings);

    assert_eq!(settings.current_target_group_id, Some("work".into()));
}

#[test]
fn keeps_current_target_group_active() {
    let settings = AppSettings {
        target_groups: vec![TargetGroup {
            id: "work".into(),
            name: "Work".into(),
            paths: vec![],
            active: false,
        }],
        current_target_group_id: Some("work".into()),
        ..AppSettings::default()
    };

    let settings = normalize_settings(settings);

    assert!(settings.target_groups[0].active);
}

#[test]
fn removes_duplicate_trusted_directories() {
    let mut settings = AppSettings::default();

    settings.commands.trusted_directories = vec!["/usr/bin".into(), "/usr/bin".into(), "".into()];

    let settings = normalize_settings(settings);

    assert_eq!(settings.commands.trusted_directories, vec!["/usr/bin"]);
}

#[test]
fn fixes_invalid_ui_language() {
    let mut settings = AppSettings::default();

    settings.ui.language = "unknown".into();

    let settings = normalize_settings(settings);

    assert_eq!(settings.ui.language, "en");
}

#[test]
fn removes_invalid_plugin_trust_records() {
    let mut settings = AppSettings::default();

    settings.plugins.insert(
        "sample-plugin".into(),
        crate::models::settings::PluginSettings {
            trust: Some(crate::models::settings::PluginTrustRecord {
                trusted_at: Some("2026-07-26T00:00:00Z".into()),
                manifest_fingerprint: Some("abc".into()),
                version: Some("1.0.0".into()),
            }),
            ..Default::default()
        },
    );
    settings.plugins.insert(
        "../escape".into(),
        crate::models::settings::PluginSettings {
            trust: Some(crate::models::settings::PluginTrustRecord {
                trusted_at: Some("2026-07-26T00:00:00Z".into()),
                manifest_fingerprint: Some("abc".into()),
                version: Some("1.0.0".into()),
            }),
            ..Default::default()
        },
    );
    settings.plugins.insert(
        "missing-fingerprint".into(),
        crate::models::settings::PluginSettings {
            trust: Some(crate::models::settings::PluginTrustRecord {
                trusted_at: Some("2026-07-26T00:00:00Z".into()),
                manifest_fingerprint: None,
                version: Some("1.0.0".into()),
            }),
            ..Default::default()
        },
    );

    let settings = normalize_settings(settings);

    assert!(settings.plugins["sample-plugin"].trust.is_some());
    assert!(!settings.plugins.contains_key("../escape"));
    assert!(!settings.plugins.contains_key("missing-fingerprint"));
}

#[test]
fn normalizes_plugin_search_result_copy_settings() {
    let mut settings = AppSettings::default();

    settings.plugins.insert(
        "date-calculator-plugin".into(),
        crate::models::settings::PluginSettings {
            copy_successful_search_results: std::collections::HashMap::from([
                ("calculate".into(), true),
                ("".into(), true),
                ("../escape".into(), true),
                ("disabled".into(), false),
            ]),
            ..Default::default()
        },
    );
    settings.plugins.insert(
        "../escape".into(),
        crate::models::settings::PluginSettings {
            copy_successful_search_results: std::collections::HashMap::from([(
                "calculate".into(),
                true,
            )]),
            ..Default::default()
        },
    );

    let settings = normalize_settings(settings);
    let action_settings =
        &settings.plugins["date-calculator-plugin"].copy_successful_search_results;

    assert_eq!(action_settings.len(), 1);
    assert_eq!(action_settings.get("calculate"), Some(&true));
    assert!(!settings.plugins.contains_key("../escape"));
}

#[test]
fn does_not_migrate_legacy_plugin_settings_shape() {
    let settings_dir = unique_test_dir("legacy_plugins");
    let settings_path = settings_dir.join("settings.json");

    fs::create_dir_all(&settings_dir).unwrap();
    fs::write(
        &settings_path,
        r#"{
  "theme": "nord",
  "plugins": {
    "trustedPlugins": {
      "sample-plugin": {
        "trusted": true,
        "trustedAt": "2026-07-26T00:00:00Z",
        "manifestFingerprint": "abc",
        "version": "1.0.0"
      }
    },
    "copySuccessfulPlaygroundResults": {
      "sample-plugin": {
        "calculate": true
      }
    }
  }
}"#,
    )
    .unwrap();

    let settings = load_settings(&settings_path);

    assert!(settings.plugins.is_empty());

    fs::remove_dir_all(settings_dir).ok();
}

#[test]
fn merges_keybindings_with_defaults() {
    let mut settings = AppSettings::default();

    settings.keybindings.clear();
    settings.keybindings.insert(
        "focusSearch".into(),
        KeybindingValue::Many(vec!["Ctrl+Space".into()]),
    );

    let settings = normalize_settings(settings);

    assert!(settings.keybindings.contains_key("openActiveItem"));

    match settings.keybindings.get("focusSearch").unwrap() {
        KeybindingValue::Many(keys) => {
            assert_eq!(keys, &vec!["Ctrl+Space".to_string()]);
        }
        _ => panic!("expected many keybindings"),
    }
}

#[test]
fn empty_keybinding_list_disables_default_keybinding() {
    let mut settings = AppSettings::default();

    settings
        .keybindings
        .insert("switchTargetGroup".into(), KeybindingValue::Many(vec![]));

    let settings = normalize_settings(settings);

    match settings.keybindings.get("switchTargetGroup").unwrap() {
        KeybindingValue::Many(keys) => {
            assert!(keys.is_empty());
        }
        _ => panic!("expected disabled keybinding list"),
    }
}

#[test]
fn removes_legacy_home_end_search_navigation_keybindings() {
    let mut settings = AppSettings::default();

    settings.keybindings.insert(
        "selectFirstItem".into(),
        KeybindingValue::One("Home".into()),
    );
    settings
        .keybindings
        .insert("selectLastItem".into(), KeybindingValue::One("End".into()));

    let settings = normalize_settings(settings);

    assert!(!settings.keybindings.contains_key("selectFirstItem"));
    assert!(!settings.keybindings.contains_key("selectLastItem"));
}

#[test]
fn disables_legacy_copy_preview_content_ctrl_c_keybinding() {
    let mut settings = AppSettings::default();

    settings.keybindings.insert(
        "copyActivePreviewContent".into(),
        KeybindingValue::One("Ctrl+C".into()),
    );

    let settings = normalize_settings(settings);

    match settings
        .keybindings
        .get("copyActivePreviewContent")
        .unwrap()
    {
        KeybindingValue::Many(keys) => {
            assert!(keys.is_empty());
        }
        _ => panic!("expected disabled keybinding list"),
    }
}

#[test]
fn preserves_custom_copy_preview_content_keybinding() {
    let mut settings = AppSettings::default();

    settings.keybindings.insert(
        "copyActivePreviewContent".into(),
        KeybindingValue::One("Ctrl+Shift+C".into()),
    );

    let settings = normalize_settings(settings);

    match settings
        .keybindings
        .get("copyActivePreviewContent")
        .unwrap()
    {
        KeybindingValue::One(key) => {
            assert_eq!(key, "Ctrl+Shift+C");
        }
        _ => panic!("expected custom keybinding"),
    }
}

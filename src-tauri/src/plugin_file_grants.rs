//! Short-lived, window-scoped file capabilities for plugin converters.
//!
//! Paths supplied by the renderer are never sufficient authority: input files
//! must first appear in a native drop event, and output directories must be
//! selected by the backend dialog (or be the app's default Downloads folder).
//! Output files are created relative to a verified directory handle.

use cap_std::ambient_authority;
use cap_std::fs::Dir;
use serde::Serialize;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use uuid::Uuid;

const DROP_CLAIM_WINDOW: Duration = Duration::from_secs(30);
const GRANT_LIFETIME: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginFileGrant {
    pub path: String,
    pub token: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Input,
    OutputDirectory,
}

struct Grant {
    path: PathBuf,
    window: String,
    kind: Kind,
    identity: Option<FileIdentity>,
    issued_at: Instant,
}

#[derive(Clone, Copy, PartialEq, Eq)]
struct FileIdentity(u64, u64);

struct PendingDrop {
    paths: Vec<PathBuf>,
    received_at: Instant,
}

#[derive(Default)]
struct Inner {
    grants: HashMap<String, Grant>,
    pending: HashMap<String, PendingDrop>,
}

#[derive(Default)]
pub struct PluginFileGrants(Mutex<Inner>);

impl PluginFileGrants {
    pub fn register_drop(&self, window: &str, paths: &[PathBuf]) {
        let canonical = paths
            .iter()
            .filter_map(|path| canonical_input(path).ok())
            .collect();
        if let Ok(mut inner) = self.0.lock() {
            inner.pending.insert(
                window.to_owned(),
                PendingDrop {
                    paths: canonical,
                    received_at: Instant::now(),
                },
            );
        }
    }

    pub fn claim_drop(
        &self,
        window: &str,
        paths: &[String],
    ) -> Result<Vec<PluginFileGrant>, String> {
        if paths.is_empty() || paths.len() > 100 {
            return Err("invalid dropped file count".into());
        }
        let canonical = paths
            .iter()
            .map(canonical_input)
            .collect::<Result<Vec<_>, _>>()?;
        let mut inner = self.0.lock().map_err(|error| error.to_string())?;
        let pending = inner
            .pending
            .get(window)
            .ok_or("no native file drop is pending")?;
        if pending.received_at.elapsed() > DROP_CLAIM_WINDOW
            || canonical.iter().any(|path| !pending.paths.contains(path))
        {
            return Err("files were not provided by the recent native drop".into());
        }
        inner.pending.remove(window);
        insert_input_grants(&mut inner, window, canonical)
    }

    /// Called only after the backend's native file picker returns paths.
    pub fn grant_picked_inputs(
        &self,
        window: &str,
        paths: &[PathBuf],
    ) -> Result<Vec<PluginFileGrant>, String> {
        if paths.is_empty() || paths.len() > 100 {
            return Err("invalid selected file count".into());
        }
        let canonical = paths
            .iter()
            .map(canonical_input)
            .collect::<Result<Vec<_>, _>>()?;
        let mut inner = self.0.lock().map_err(|error| error.to_string())?;
        insert_input_grants(&mut inner, window, canonical)
    }

    pub fn grant_output(&self, window: &str, path: &Path) -> Result<PluginFileGrant, String> {
        let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
        let directory =
            Dir::open_ambient_dir(&path, ambient_authority()).map_err(|error| error.to_string())?;
        let identity = directory_identity(&directory)?;
        let mut inner = self.0.lock().map_err(|error| error.to_string())?;
        prune_expired(&mut inner);
        Ok(insert_grant(
            &mut inner,
            window,
            path,
            Kind::OutputDirectory,
            Some(identity),
        ))
    }

    pub fn existing_output(
        &self,
        window: &str,
        directory: &Path,
    ) -> Result<Option<PluginFileGrant>, String> {
        let Ok(canonical) = std::fs::canonicalize(directory) else {
            return Ok(None);
        };
        let mut inner = self.0.lock().map_err(|error| error.to_string())?;
        prune_expired(&mut inner);
        let existing = inner.grants.iter().find_map(|(token, grant)| {
            if grant.window == window
                && grant.kind == Kind::OutputDirectory
                && grant.path == canonical
            {
                Some((token.clone(), grant.identity?))
            } else {
                None
            }
        });
        if let Some((token, identity)) = existing {
            if current_directory_identity(&canonical)? != identity {
                return Ok(None);
            }
            return Ok(Some(PluginFileGrant {
                path: canonical.to_string_lossy().into_owned(),
                token,
            }));
        }
        Ok(None)
    }

    pub fn authorize(&self, window: &str, token: &str, kind: &str) -> Result<PathBuf, String> {
        let expected = match kind {
            "input" => Kind::Input,
            "output" => Kind::OutputDirectory,
            _ => return Err("invalid file grant kind".into()),
        };
        let mut inner = self.0.lock().map_err(|error| error.to_string())?;
        prune_expired(&mut inner);
        let grant = inner.grants.get(token).ok_or("invalid plugin file grant")?;
        if grant.window != window
            || grant.kind != expected
            || grant.issued_at.elapsed() >= GRANT_LIFETIME
        {
            return Err("plugin file grant is not valid for this operation".into());
        }
        let path = grant.path.clone();
        let identity = grant.identity;
        drop(inner);
        let canonical = std::fs::canonicalize(&path).map_err(|error| error.to_string())?;
        if canonical != path {
            return Err("plugin file grant target has changed".into());
        }
        if expected == Kind::OutputDirectory
            && Some(current_directory_identity(&canonical)?) != identity
        {
            return Err("plugin output directory has been replaced since selection".into());
        }
        Ok(canonical)
    }

    pub fn open_output(&self, window: &str, token: &str) -> Result<(PathBuf, Dir), String> {
        let path = self.authorize(window, token, "output")?;
        let directory =
            Dir::open_ambient_dir(&path, ambient_authority()).map_err(|error| error.to_string())?;
        let actual_identity = directory_identity(&directory)?;
        let mut inner = self.0.lock().map_err(|error| error.to_string())?;
        prune_expired(&mut inner);
        let grant = inner.grants.get(token).ok_or("invalid plugin file grant")?;
        if grant.window != window
            || grant.kind != Kind::OutputDirectory
            || grant.issued_at.elapsed() >= GRANT_LIFETIME
            || grant.identity != Some(actual_identity)
        {
            return Err("plugin output grant is not valid for this window".into());
        }
        Ok((path, directory))
    }

    pub fn open_input(
        &self,
        window: &str,
        token: &str,
        write: bool,
    ) -> Result<(PathBuf, File), String> {
        let mut inner = self.0.lock().map_err(|error| error.to_string())?;
        prune_expired(&mut inner);
        let grant = inner.grants.get(token).ok_or("invalid plugin file grant")?;
        if grant.window != window
            || grant.kind != Kind::Input
            || grant.issued_at.elapsed() >= GRANT_LIFETIME
        {
            return Err("plugin input grant is not valid for this window".into());
        }
        let path = grant.path.clone();
        let expected = grant.identity.ok_or("input grant has no file identity")?;
        drop(inner);
        if std::fs::canonicalize(&path).map_err(|error| error.to_string())? != path {
            return Err("plugin input grant target has changed".into());
        }
        let file = OpenOptions::new()
            .read(!write)
            .write(write)
            .open(&path)
            .map_err(|error| error.to_string())?;
        if file_identity(&file)? != expected {
            return Err("plugin input file has been replaced since it was dropped".into());
        }
        Ok((path, file))
    }
}

fn insert_input_grants(
    inner: &mut Inner,
    window: &str,
    paths: Vec<PathBuf>,
) -> Result<Vec<PluginFileGrant>, String> {
    prune_expired(inner);
    paths
        .into_iter()
        .map(|path| {
            let identity = file_identity(&File::open(&path).map_err(|error| error.to_string())?)?;
            Ok(insert_grant(
                inner,
                window,
                path,
                Kind::Input,
                Some(identity),
            ))
        })
        .collect()
}

fn directory_identity(directory: &Dir) -> Result<FileIdentity, String> {
    let file = directory
        .try_clone()
        .map_err(|error| error.to_string())?
        .into_std_file();
    file_identity(&file)
}

fn current_directory_identity(path: &Path) -> Result<FileIdentity, String> {
    let directory =
        Dir::open_ambient_dir(path, ambient_authority()).map_err(|error| error.to_string())?;
    directory_identity(&directory)
}

fn prune_expired(inner: &mut Inner) {
    inner
        .grants
        .retain(|_, grant| grant.issued_at.elapsed() < GRANT_LIFETIME);
}

#[cfg(windows)]
fn file_identity(file: &File) -> Result<FileIdentity, String> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    unsafe {
        GetFileInformationByHandle(HANDLE(file.as_raw_handle()), &mut info)
            .map_err(|error| error.to_string())?;
    }
    Ok(FileIdentity(
        info.dwVolumeSerialNumber as u64,
        ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64,
    ))
}

#[cfg(unix)]
fn file_identity(file: &File) -> Result<FileIdentity, String> {
    use std::os::unix::fs::MetadataExt;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    Ok(FileIdentity(metadata.dev(), metadata.ino()))
}

#[cfg(not(any(windows, unix)))]
fn file_identity(_file: &File) -> Result<FileIdentity, String> {
    Err("plugin file grants are unsupported on this platform".into())
}

fn canonical_input(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = std::fs::canonicalize(path).map_err(|error| error.to_string())?;
    if !path.is_file()
        || !matches!(
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some("txt" | "md" | "markdown")
        )
    {
        return Err("only text and Markdown files can be dropped".into());
    }
    Ok(path)
}

fn insert_grant(
    inner: &mut Inner,
    window: &str,
    path: PathBuf,
    kind: Kind,
    identity: Option<FileIdentity>,
) -> PluginFileGrant {
    let token = Uuid::new_v4().to_string();
    let result = PluginFileGrant {
        path: path.to_string_lossy().into_owned(),
        token: token.clone(),
    };
    inner.grants.insert(
        token,
        Grant {
            path,
            window: window.to_owned(),
            kind,
            identity,
            issued_at: Instant::now(),
        },
    );
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_recent_native_drops_can_authorize_inputs() {
        let dir = std::env::temp_dir().join(format!("glimpse-grants-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let allowed = dir.join("allowed.txt");
        let denied = dir.join("denied.txt");
        std::fs::write(&allowed, "allowed").unwrap();
        std::fs::write(&denied, "denied").unwrap();
        let grants = PluginFileGrants::default();
        assert!(grants
            .claim_drop("main", &[allowed.to_string_lossy().into_owned()])
            .is_err());
        grants.register_drop("main", std::slice::from_ref(&allowed));
        assert!(grants
            .claim_drop("main", &[denied.to_string_lossy().into_owned()])
            .is_err());
        let claimed = grants
            .claim_drop("main", &[allowed.to_string_lossy().into_owned()])
            .unwrap();
        assert_eq!(
            grants
                .authorize("main", &claimed[0].token, "input")
                .unwrap(),
            allowed.canonicalize().unwrap()
        );
        assert!(grants
            .authorize("other", &claimed[0].token, "input")
            .is_err());
        assert!(grants
            .authorize("main", &claimed[0].token, "output")
            .is_err());
        assert!(grants.open_input("main", &claimed[0].token, false).is_ok());
        std::fs::rename(&allowed, dir.join("moved.txt")).unwrap();
        std::fs::write(&allowed, "replacement").unwrap();
        assert!(grants.open_input("main", &claimed[0].token, false).is_err());
        assert!(grants
            .claim_drop("main", &[allowed.to_string_lossy().into_owned()])
            .is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn output_grants_cover_only_selected_directory() {
        let dir = std::env::temp_dir().join(format!("glimpse-grants-{}", Uuid::new_v4()));
        let selected = dir.join("selected");
        let other = dir.join("other");
        std::fs::create_dir_all(&selected).unwrap();
        std::fs::create_dir(&other).unwrap();
        let grants = PluginFileGrants::default();
        assert!(grants.existing_output("main", &other).unwrap().is_none());
        let grant = grants.grant_output("main", &selected).unwrap();
        assert_eq!(
            grants.authorize("main", &grant.token, "output").unwrap(),
            selected.canonicalize().unwrap()
        );
        assert_eq!(
            grants
                .existing_output("main", &selected)
                .unwrap()
                .unwrap()
                .token,
            grant.token
        );
        assert!(grants
            .existing_output("other", &selected)
            .unwrap()
            .is_none());
        let (output_path, output_dir) = grants.open_output("main", &grant.token).unwrap();
        let first = crate::store::file::write_text_file_in_granted_directory(
            &output_dir,
            &output_path,
            "result.txt".into(),
            "first".into(),
        )
        .unwrap();
        let second = crate::store::file::write_text_file_in_granted_directory(
            &output_dir,
            &output_path,
            "result.txt".into(),
            "second".into(),
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(first).unwrap(), "first");
        assert_eq!(std::fs::read_to_string(second).unwrap(), "second");
        drop(output_dir);
        drop(grants);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn expired_grants_cannot_be_used_or_refreshed() {
        let dir = std::env::temp_dir().join(format!("glimpse-grants-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let input = dir.join("input.txt");
        std::fs::write(&input, "input").unwrap();
        let grants = PluginFileGrants::default();
        let input_grant = grants.grant_picked_inputs("main", &[input]).unwrap();
        let output_grant = grants.grant_output("main", &dir).unwrap();
        {
            let mut inner = grants.0.lock().unwrap();
            for grant in inner.grants.values_mut() {
                grant.issued_at = Instant::now() - GRANT_LIFETIME - Duration::from_secs(1);
            }
        }

        assert!(grants
            .open_input("main", &input_grant[0].token, false)
            .is_err());
        assert!(grants.open_output("main", &output_grant.token).is_err());
        assert!(grants.existing_output("main", &dir).unwrap().is_none());
        drop(grants);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn replaced_output_directory_cannot_receive_a_granted_write() {
        let dir = std::env::temp_dir().join(format!("glimpse-grants-{}", Uuid::new_v4()));
        let selected = dir.join("selected");
        let moved = dir.join("moved");
        std::fs::create_dir_all(&selected).unwrap();
        let grants = PluginFileGrants::default();
        let grant = grants.grant_output("main", &selected).unwrap();

        std::fs::rename(&selected, &moved).unwrap();
        std::fs::create_dir(&selected).unwrap();
        assert!(grants.open_output("main", &grant.token).is_err());
        assert!(grants.existing_output("main", &selected).unwrap().is_none());

        drop(grants);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn output_creation_stays_on_original_directory_handle_after_path_swap() {
        let dir = std::env::temp_dir().join(format!("glimpse-grants-{}", Uuid::new_v4()));
        let selected = dir.join("selected");
        let moved = dir.join("moved");
        std::fs::create_dir_all(&selected).unwrap();
        let grants = PluginFileGrants::default();
        let grant = grants.grant_output("main", &selected).unwrap();
        let (output_path, output_dir) = grants.open_output("main", &grant.token).unwrap();
        std::fs::rename(&selected, &moved).unwrap();
        std::fs::create_dir(&selected).unwrap();

        crate::store::file::write_text_file_in_granted_directory(
            &output_dir,
            &output_path,
            "result.txt".into(),
            "selected content".into(),
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(moved.join("result.txt")).unwrap(),
            "selected content"
        );
        assert!(!selected.join("result.txt").exists());
        assert!(grants.open_output("main", &grant.token).is_err());
        drop(output_dir);
        drop(grants);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn native_picker_grants_selected_text_file_without_a_drop() {
        let dir = std::env::temp_dir().join(format!("glimpse-picker-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let selected = dir.join("selected.md");
        let rejected = dir.join("rejected.bin");
        std::fs::write(&selected, "# selected").unwrap();
        std::fs::write(&rejected, "binary").unwrap();
        let grants = PluginFileGrants::default();
        assert!(grants.grant_picked_inputs("main", &[rejected]).is_err());
        let picked = grants
            .grant_picked_inputs("main", std::slice::from_ref(&selected))
            .unwrap();
        assert_eq!(picked.len(), 1);
        assert!(grants.open_input("main", &picked[0].token, false).is_ok());
        assert!(grants.open_input("main", &picked[0].token, true).is_ok());
        assert!(grants.open_input("other", &picked[0].token, false).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn file_outside_target_group_requires_an_explicit_native_grant() {
        let dir = std::env::temp_dir().join(format!("glimpse-grants-{}", Uuid::new_v4()));
        let target = dir.join("target-group");
        let outside = dir.join("outside-target-group");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::create_dir(&outside).unwrap();
        let selected = outside.join("selected.txt");
        std::fs::write(&selected, "selected outside target group").unwrap();
        let grants = PluginFileGrants::default();

        assert!(grants
            .claim_drop("main", &[selected.to_string_lossy().into_owned()])
            .is_err());
        assert!(grants
            .open_input("main", &selected.to_string_lossy(), false)
            .is_err());
        let picked = grants.grant_picked_inputs("main", &[selected]).unwrap();
        assert!(grants.open_input("main", &picked[0].token, false).is_ok());
        assert!(grants.open_input("other", &picked[0].token, false).is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn symlink_retargeting_after_selection_cannot_redirect_input_grant() {
        let dir = std::env::temp_dir().join(format!("glimpse-grants-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let original = dir.join("original.txt");
        let other = dir.join("other.txt");
        let link = dir.join("chosen.txt");
        std::fs::write(&original, "original").unwrap();
        std::fs::write(&other, "other").unwrap();
        std::os::unix::fs::symlink(&original, &link).unwrap();
        let grants = PluginFileGrants::default();
        let picked = grants.grant_picked_inputs("main", &[link.clone()]).unwrap();

        std::fs::remove_file(&link).unwrap();
        std::os::unix::fs::symlink(&other, &link).unwrap();
        let (resolved, _) = grants.open_input("main", &picked[0].token, false).unwrap();
        assert_eq!(resolved, original.canonicalize().unwrap());
        std::fs::remove_dir_all(dir).unwrap();
    }
}

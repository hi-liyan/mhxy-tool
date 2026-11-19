use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const LEGACY_DIR: &str = "com.chenjinliang.mhxy-ledger";
const DEFAULT_DIR: &str = "com.iyucode.mhxy-tools";

/// 窗口位置插件（tauri-plugin-window-state）的状态文件。插件把它写在 %APPDATA%\<identifier>，
/// 而 identifier 与旧数据目录同名，所以只有这个文件的旧目录是插件建的，不是旧数据目录。
const WINDOW_STATE_FILE: &str = ".window-state.json";

/// 旧目录存在时优先使用，包括空目录及新旧目录同时存在的情况；只含窗口位置文件的除外。
/// 访问失败时返回错误，避免误建新目录而让用户以为历史数据丢失。
pub(crate) fn resolve_data_dir(base: &Path) -> io::Result<PathBuf> {
    let legacy = base.join(LEGACY_DIR);
    let dir = if is_legacy_data_dir(&legacy)? {
        legacy
    } else {
        base.join(DEFAULT_DIR)
    };
    fs::create_dir_all(&dir)?;
    Ok(dir)
}

fn is_legacy_data_dir(legacy: &Path) -> io::Result<bool> {
    if !legacy.try_exists()? {
        return Ok(false);
    }
    let mut window_state_only = false;
    for entry in fs::read_dir(legacy)? {
        if entry?.file_name() != WINDOW_STATE_FILE {
            return Ok(true);
        }
        window_state_only = true;
    }
    Ok(!window_state_only)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    static NEXT_ID: AtomicUsize = AtomicUsize::new(0);

    struct TestDir(PathBuf);

    impl TestDir {
        fn new() -> Self {
            let dir = std::env::temp_dir().join(format!(
                "mhxy-data-path-{}-{}",
                std::process::id(),
                NEXT_ID.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for TestDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn fresh_install_creates_new_directory() {
        let base = TestDir::new();
        let dir = resolve_data_dir(&base.0).unwrap();
        assert_eq!(dir, base.0.join(DEFAULT_DIR));
        assert!(dir.is_dir());
        assert!(!base.0.join(LEGACY_DIR).exists());
        fs::write(dir.join("data.json"), "new data").unwrap();
        assert_eq!(resolve_data_dir(&base.0).unwrap(), dir);
        assert_eq!(
            fs::read_to_string(dir.join("data.json")).unwrap(),
            "new data"
        );
    }

    #[test]
    fn existing_legacy_directory_keeps_all_files() {
        let base = TestDir::new();
        let legacy = base.0.join(LEGACY_DIR);
        fs::create_dir_all(legacy.join("backups")).unwrap();
        for name in ["data.json", "cbg_session.json", "backups/data-old.json"] {
            fs::write(legacy.join(name), name).unwrap();
        }
        assert_eq!(resolve_data_dir(&base.0).unwrap(), legacy);
        assert!(!base.0.join(DEFAULT_DIR).exists());
        for name in ["data.json", "cbg_session.json", "backups/data-old.json"] {
            assert_eq!(fs::read_to_string(legacy.join(name)).unwrap(), name);
        }
    }

    #[test]
    fn empty_legacy_directory_wins_even_when_new_directory_exists() {
        let base = TestDir::new();
        let legacy = base.0.join(LEGACY_DIR);
        fs::create_dir(&legacy).unwrap();
        assert_eq!(resolve_data_dir(&base.0).unwrap(), legacy);
        let new = base.0.join(DEFAULT_DIR);
        fs::create_dir(&new).unwrap();
        fs::write(new.join("data.json"), "new data").unwrap();
        assert_eq!(resolve_data_dir(&base.0).unwrap(), legacy);
        assert_eq!(
            fs::read_to_string(new.join("data.json")).unwrap(),
            "new data"
        );
    }

    #[test]
    fn legacy_directory_with_only_window_state_is_ignored() {
        // 窗口位置插件在 %APPDATA%\<identifier> 下建的目录，identifier 恰好与旧数据目录同名
        let base = TestDir::new();
        let legacy = base.0.join(LEGACY_DIR);
        fs::create_dir(&legacy).unwrap();
        fs::write(legacy.join(".window-state.json"), "{}").unwrap();
        let new = base.0.join(DEFAULT_DIR);
        fs::create_dir(&new).unwrap();
        fs::write(new.join("data.json"), "new data").unwrap();
        assert_eq!(resolve_data_dir(&base.0).unwrap(), new);
        assert_eq!(
            fs::read_to_string(legacy.join(".window-state.json")).unwrap(),
            "{}"
        );
    }

    #[test]
    fn legacy_directory_with_data_and_window_state_still_wins() {
        let base = TestDir::new();
        let legacy = base.0.join(LEGACY_DIR);
        fs::create_dir(&legacy).unwrap();
        fs::write(legacy.join(".window-state.json"), "{}").unwrap();
        fs::write(legacy.join("data.json"), "old data").unwrap();
        fs::create_dir(base.0.join(DEFAULT_DIR)).unwrap();
        assert_eq!(resolve_data_dir(&base.0).unwrap(), legacy);
    }

    #[test]
    fn invalid_legacy_path_does_not_silently_switch_directory() {
        let base = TestDir::new();
        fs::write(base.0.join(LEGACY_DIR), "not a directory").unwrap();
        assert!(resolve_data_dir(&base.0).is_err());
        assert!(!base.0.join(DEFAULT_DIR).exists());
    }
}

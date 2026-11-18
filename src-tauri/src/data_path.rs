use std::fs;
use std::io;
use std::path::{Path, PathBuf};

const LEGACY_DIR: &str = "com.chenjinliang.mhxy-ledger";
const DEFAULT_DIR: &str = "com.iyucode.mhxy-tools";

/// 旧目录存在时始终优先使用，包括空目录及新旧目录同时存在的情况。
/// 访问失败时返回错误，避免误建新目录而让用户以为历史数据丢失。
pub(crate) fn resolve_data_dir(base: &Path) -> io::Result<PathBuf> {
    let legacy = base.join(LEGACY_DIR);
    let dir = if legacy.try_exists()? {
        legacy
    } else {
        base.join(DEFAULT_DIR)
    };
    fs::create_dir_all(&dir)?;
    Ok(dir)
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
    fn invalid_legacy_path_does_not_silently_switch_directory() {
        let base = TestDir::new();
        fs::write(base.0.join(LEGACY_DIR), "not a directory").unwrap();
        assert!(resolve_data_dir(&base.0).is_err());
        assert!(!base.0.join(DEFAULT_DIR).exists());
    }
}

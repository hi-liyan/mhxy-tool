use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

mod cbg;

const DATA_FILE: &str = "data.json";

pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建数据目录失败: {e}"))?;
    Ok(dir)
}

/// 读取数据文件，不存在时返回 None
#[tauri::command]
fn load_data(app: AppHandle) -> Result<Option<String>, String> {
    let path = data_dir(&app)?.join(DATA_FILE);
    if !path.exists() {
        return Ok(None);
    }
    fs::read_to_string(&path)
        .map(Some)
        .map_err(|e| format!("读取数据失败: {e}"))
}

/// 原子写入：先写临时文件再 rename，避免写一半崩溃导致数据损坏
#[tauri::command]
fn save_data(app: AppHandle, content: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&content)
        .map_err(|e| format!("数据不是合法 JSON: {e}"))?;
    let dir = data_dir(&app)?;
    let path = dir.join(DATA_FILE);
    let tmp = dir.join(format!("{DATA_FILE}.tmp"));
    fs::write(&tmp, content.as_bytes()).map_err(|e| format!("写入数据失败: {e}"))?;
    fs::rename(&tmp, &path).map_err(|e| format!("保存数据失败: {e}"))?;
    Ok(())
}

/// 把当前数据复制一份到 backups/ 目录，返回备份文件路径
#[tauri::command]
fn backup_data(app: AppHandle, stamp: String) -> Result<String, String> {
    if stamp.is_empty() || !stamp.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("非法的备份标识".into());
    }
    let dir = data_dir(&app)?;
    let src = dir.join(DATA_FILE);
    if !src.exists() {
        return Err("还没有数据可以备份".into());
    }
    let backup_dir = dir.join("backups");
    fs::create_dir_all(&backup_dir).map_err(|e| e.to_string())?;
    let target = backup_dir.join(format!("data-{stamp}.json"));
    fs::copy(&src, &target).map_err(|e| format!("备份失败: {e}"))?;
    Ok(target.display().to_string())
}

#[tauri::command]
fn get_data_dir(app: AppHandle) -> Result<String, String> {
    Ok(data_dir(&app)?.display().to_string())
}

/// 在系统文件管理器中打开数据目录
#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?;
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(&dir)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            backup_data,
            get_data_dir,
            open_data_dir,
            cbg::cbg_servers,
            cbg::cbg_status,
            cbg::cbg_open_login,
            cbg::cbg_capture,
            cbg::cbg_logout,
            cbg::cbg_gold_price
        ])
        .run(tauri::generate_context!())
        .expect("启动应用失败");
}

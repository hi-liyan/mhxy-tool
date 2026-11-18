use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

mod cbg;
mod data_path;
#[cfg(desktop)]
mod desktop;

const DATA_FILE: &str = "data.json";
const REPORT_DIR: &str = "梦幻记账";

pub(crate) fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app.path().data_dir().map_err(|e| e.to_string())?;
    data_path::resolve_data_dir(&base).map_err(|e| format!("访问数据目录失败: {e}"))
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

/// 在系统文件管理器中打开目录
fn open_in_file_manager(dir: &Path) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
    let program = "xdg-open";
    std::process::Command::new(program)
        .arg(dir)
        .spawn()
        .map_err(|e| format!("打开目录失败: {e}"))?;
    Ok(())
}

#[tauri::command]
fn open_data_dir(app: AppHandle) -> Result<(), String> {
    open_in_file_manager(&data_dir(&app)?)
}

/// 战报图片保存目录：系统「图片」文件夹下的 梦幻记账/
fn report_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let pictures = app
        .path()
        .picture_dir()
        .map_err(|e| format!("找不到图片文件夹: {e}"))?;
    Ok(pictures.join(REPORT_DIR))
}

fn valid_report_name(name: &str) -> bool {
    name.len() <= 64
        && name.ends_with(".png")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_' || c == '.')
        && !name.contains("..")
}

/// 保存战报 PNG。请求体是原始图片字节，文件名放在 x-file-name 请求头中。
#[tauri::command]
fn save_report_image(app: AppHandle, request: tauri::ipc::Request<'_>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("图片数据格式不正确".into());
    };
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("图片数据不是 PNG".into());
    }
    let name = request
        .headers()
        .get("x-file-name")
        .and_then(|v| v.to_str().ok())
        .filter(|n| valid_report_name(n))
        .ok_or("非法的文件名")?;
    let dir = report_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    let path = dir.join(name);
    fs::write(&path, bytes).map_err(|e| format!("保存图片失败: {e}"))?;
    Ok(path.display().to_string())
}

#[tauri::command]
fn open_report_dir(app: AppHandle) -> Result<(), String> {
    let dir = report_dir(&app)?;
    fs::create_dir_all(&dir).map_err(|e| format!("创建目录失败: {e}"))?;
    open_in_file_manager(&dir)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(
            // 只记住置顶小窗的位置，主窗口保持原有行为
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(tauri_plugin_window_state::StateFlags::POSITION)
                .with_denylist(&[desktop::MAIN])
                .build(),
        )
        .setup(|app| {
            desktop::setup(app)?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if desktop::on_close_requested(window) {
                    api.prevent_close();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            load_data,
            save_data,
            backup_data,
            get_data_dir,
            open_data_dir,
            save_report_image,
            open_report_dir,
            cbg::cbg_servers,
            cbg::cbg_status,
            cbg::cbg_open_login,
            cbg::cbg_capture,
            cbg::cbg_logout,
            cbg::cbg_gold_price,
            desktop::tray_update,
            desktop::mini_show,
            desktop::mini_hide,
            desktop::mini_toggle,
            desktop::mini_is_transient,
            desktop::main_show
        ]);

    #[cfg(not(desktop))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        load_data,
        save_data,
        backup_data,
        get_data_dir,
        open_data_dir,
        save_report_image,
        open_report_dir,
        cbg::cbg_servers,
        cbg::cbg_status,
        cbg::cbg_open_login,
        cbg::cbg_capture,
        cbg::cbg_logout,
        cbg::cbg_gold_price
    ]);

    builder
        .run(tauri::generate_context!())
        .expect("启动应用失败");
}

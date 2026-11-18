//! 桌面端：托盘菜单、置顶小窗。
//!
//! 记账数据只由主窗口的前端读写。托盘和小窗把操作通过事件发给主窗口执行，
//! 主窗口再把状态推给小窗、调用 `tray_update` 刷新托盘，避免多个窗口同时写数据文件。

use std::sync::Mutex;
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    App, AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Wry,
};

pub const MAIN: &str = "main";
pub const MINI: &str = "mini";
const TRAY_ID: &str = "main-tray";
const MINI_WIDTH: f64 = 300.0;
const MINI_HEIGHT: f64 = 430.0;

type Res<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// 托盘里需要随状态更新的菜单项
struct TrayMenu {
    status: MenuItem<Wry>,
    start: MenuItem<Wry>,
    offline: MenuItem<Wry>,
    mini: MenuItem<Wry>,
}

/// 小窗是否由快捷键临时呼出：临时呼出的小窗记一笔或失去焦点后自动隐藏
#[derive(Default)]
struct MiniState {
    transient: Mutex<bool>,
}

pub fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN) {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

pub fn setup(app: &App) -> tauri::Result<()> {
    app.manage(MiniState::default());

    let status = MenuItem::with_id(app, "status", "未上线", false, None::<&str>)?;
    let start = MenuItem::with_id(app, "start", "开刷（默认上线的号）", true, None::<&str>)?;
    let offline = MenuItem::with_id(app, "offline", "下线结算…", false, None::<&str>)?;
    let mini = MenuItem::with_id(app, "mini", "显示置顶小窗", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "打开主窗口", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;
    let sep3 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(
        app,
        &[
            &status, &sep1, &start, &offline, &sep2, &mini, &show, &sep3, &quit,
        ],
    )?;

    let mut tray = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .tooltip("梦幻记账")
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_main_window(app),
            "quit" => app.exit(0),
            "mini" => {
                // 创建窗口需要事件循环空闲，放到异步任务里执行
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let _ = toggle_mini(&app);
                });
            }
            id @ ("start" | "offline") => {
                let _ = app.emit_to(MAIN, "tray-action", id);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } => show_main_window(tray.app_handle()),
            // 主窗口隐藏时前端定时器可能被节流，悬停时请前端立即刷新提示
            TrayIconEvent::Enter { .. } => {
                let _ = tray.app_handle().emit_to(MAIN, "tray-hover", ());
            }
            _ => {}
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    app.manage(TrayMenu {
        status,
        start,
        offline,
        mini,
    });
    Ok(())
}

/// 前端同步托盘状态：提示文字、菜单状态行以及开刷 / 下线结算是否可用
#[tauri::command]
pub fn tray_update(app: AppHandle, status: String, tooltip: String, active: bool) -> Res<()> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_tooltip(Some(tooltip)).map_err(err)?;
    }
    let menu = app.state::<TrayMenu>();
    menu.status.set_text(status).map_err(err)?;
    menu.start.set_enabled(!active).map_err(err)?;
    menu.offline.set_enabled(active).map_err(err)?;
    Ok(())
}

fn set_mini_menu(app: &AppHandle, visible: bool) {
    if let Some(menu) = app.try_state::<TrayMenu>() {
        let _ = menu.mini.set_text(if visible {
            "隐藏置顶小窗"
        } else {
            "显示置顶小窗"
        });
    }
}

fn ensure_mini(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(MINI) {
        return Ok(w);
    }
    let mut builder = WebviewWindowBuilder::new(app, MINI, WebviewUrl::default())
        .title("梦幻记账 · 小窗")
        .inner_size(MINI_WIDTH, MINI_HEIGHT)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false);
    // 默认放在主屏右上角；窗口位置插件会在之后恢复上次的位置
    if let Ok(Some(m)) = app.primary_monitor() {
        let scale = m.scale_factor();
        let area = m.work_area();
        let pos = area.position.to_logical::<f64>(scale);
        let size = area.size.to_logical::<f64>(scale);
        builder = builder.position(pos.x + size.width - MINI_WIDTH - 24.0, pos.y + 96.0);
    }
    builder.build()
}

fn show_mini(app: &AppHandle, transient: bool) -> Res<()> {
    let w = ensure_mini(app).map_err(err)?;
    let was_visible = w.is_visible().unwrap_or(false);
    *app.state::<MiniState>().transient.lock().map_err(err)? = transient && !was_visible;
    w.show().map_err(err)?;
    let _ = w.set_focus();
    set_mini_menu(app, true);
    Ok(())
}

fn hide_mini(app: &AppHandle) -> Res<()> {
    *app.state::<MiniState>().transient.lock().map_err(err)? = false;
    if let Some(w) = app.get_webview_window(MINI) {
        w.hide().map_err(err)?;
    }
    set_mini_menu(app, false);
    Ok(())
}

fn toggle_mini(app: &AppHandle) -> Res<()> {
    let visible = app
        .get_webview_window(MINI)
        .and_then(|w| w.is_visible().ok())
        .unwrap_or(false);
    if visible {
        hide_mini(app)
    } else {
        show_mini(app, false)
    }
}

/// 显示并聚焦小窗。transient 为 true（快捷键快速记账）且小窗原本隐藏时，记完一笔会自动隐藏。
/// 必须是 async 命令：Windows 上在同步命令里创建窗口会死锁。
#[tauri::command]
pub async fn mini_show(app: AppHandle, transient: bool) -> Res<()> {
    show_mini(&app, transient)
}

#[tauri::command]
pub async fn mini_hide(app: AppHandle) -> Res<()> {
    hide_mini(&app)
}

#[tauri::command]
pub async fn mini_toggle(app: AppHandle) -> Res<()> {
    toggle_mini(&app)
}

#[tauri::command]
pub fn mini_is_transient(app: AppHandle) -> bool {
    app.state::<MiniState>()
        .transient
        .lock()
        .map(|t| *t)
        .unwrap_or(false)
}

#[tauri::command]
pub fn main_show(app: AppHandle) {
    show_main_window(&app);
}

/// 窗口关闭按钮只隐藏窗口：主窗口隐藏后托盘和快捷键继续工作
pub fn on_close_requested(window: &tauri::Window) -> bool {
    match window.label() {
        MAIN => {
            let _ = window.hide();
            true
        }
        MINI => {
            let _ = hide_mini(window.app_handle());
            true
        }
        _ => false,
    }
}

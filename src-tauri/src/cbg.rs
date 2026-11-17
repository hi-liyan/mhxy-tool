//! 藏宝阁（xyq.cbg.163.com）相关：区服列表、登录窗口、会话保存与校验。
//!
//! 登录在应用内打开的藏宝阁官方页面中完成，应用只读取登录后的 Cookie，接触不到账号密码。
//! 会话保存在数据目录的 cbg_session.json 中（与记账数据分开，备份不会带上它）。

use serde::{Deserialize, Serialize};
use std::fs;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::webview::Cookie;
use tauri::{AppHandle, Emitter, Manager, Url, WebviewUrl, WebviewWindowBuilder};

use crate::data_dir;

const CBG_ORIGIN: &str = "https://xyq.cbg.163.com/";
const RECOMMD_ORIGIN: &str = "https://recommd.xyq.cbg.163.com/";
const SERVER_LIST_URL: &str = "https://cbg-xyq.res.netease.com/js/server_list_data.js";
const SESSION_FILE: &str = "cbg_session.json";
const LOGIN_LABEL: &str = "cbg-login";

type Res<T> = Result<T, String>;

fn err<E: std::fmt::Display>(prefix: &'static str) -> impl Fn(E) -> String {
    move |e| format!("{prefix}: {e}")
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn http(user_agent: &str) -> Res<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(user_agent)
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(err("创建网络客户端失败"))
}

// ---------------- 区服列表 ----------------

#[derive(Serialize)]
pub struct Server {
    id: u32,
    name: String,
}

#[derive(Serialize)]
pub struct Area {
    id: u32,
    name: String,
    servers: Vec<Server>,
}

/// 解析藏宝阁公开的 server_list_data.js：
/// `var server_data = {"区id": [[区名, ...], [[服id, 服名, ...], ...]], ...};`
fn parse_server_list(js: &str) -> Res<Vec<Area>> {
    let line = js
        .lines()
        .find(|l| l.trim_start().starts_with("var server_data"))
        .ok_or("区服数据格式变了：找不到 server_data")?;
    let json = line
        .split_once('=')
        .map(|(_, r)| r.trim().trim_end_matches(';'))
        .ok_or("区服数据格式变了")?;
    let raw: serde_json::Map<String, serde_json::Value> =
        serde_json::from_str(json).map_err(err("解析区服数据失败"))?;

    let mut areas = Vec::new();
    for (area_id, v) in raw {
        let Some(id) = area_id.parse::<u32>().ok() else { continue };
        let name = v[0][0].as_str().unwrap_or_default().to_string();
        let servers = v[1]
            .as_array()
            .map(|list| {
                list.iter()
                    .filter_map(|s| {
                        Some(Server {
                            id: s[0].as_u64()? as u32,
                            name: s[1].as_str()?.to_string(),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        areas.push(Area { id, name, servers });
    }
    areas.sort_by_key(|a| a.id);
    Ok(areas)
}

#[tauri::command]
pub async fn cbg_servers(user_agent: String) -> Res<Vec<Area>> {
    let text = http(&user_agent)?
        .get(SERVER_LIST_URL)
        .send()
        .await
        .map_err(err("获取区服列表失败"))?
        .text()
        .await
        .map_err(err("读取区服列表失败"))?;
    parse_server_list(&text)
}

// ---------------- 会话 ----------------

#[derive(Serialize, Deserialize, Clone)]
pub struct CbgSession {
    /// xyq.cbg.163.com 的 Cookie 头（藏宝阁的 Cookie 都是该域名下的，recommd 子域名也要带它）
    pub cookie: String,
    pub user_agent: String,
    pub server_id: u32,
    pub saved_at: u64,
}

fn load_session(app: &AppHandle) -> Res<Option<CbgSession>> {
    let path = data_dir(app)?.join(SESSION_FILE);
    if !path.exists() {
        return Ok(None);
    }
    let text = fs::read_to_string(&path).map_err(err("读取藏宝阁会话失败"))?;
    Ok(serde_json::from_str(&text).ok())
}

fn save_session(app: &AppHandle, s: &CbgSession) -> Res<()> {
    let path = data_dir(app)?.join(SESSION_FILE);
    let text = serde_json::to_string_pretty(s).map_err(|e| e.to_string())?;
    fs::write(path, text).map_err(err("保存藏宝阁会话失败"))
}

fn cookie_header(cookies: Vec<Cookie<'static>>) -> String {
    cookies
        .iter()
        .map(|c| format!("{}={}", c.name(), c.value()))
        .collect::<Vec<_>>()
        .join("; ")
}

#[derive(Serialize)]
pub struct CbgStatus {
    logged_in: bool,
    server_id: Option<u32>,
    saved_at: Option<u64>,
    message: String,
}

/// 用一次轻量查询判断会话是否还有效
async fn check(s: &CbgSession) -> CbgStatus {
    let url = format!(
        "{RECOMMD_ORIGIN}cgi-bin/recommend.py?act=recommd_by_role&search_type=overall_search_role\
         &view_loc=overall_search&server_type=3&page=1&count=1&_={}",
        now_ms()
    );
    let base = |logged_in, message: String| CbgStatus {
        logged_in,
        server_id: Some(s.server_id),
        saved_at: Some(s.saved_at),
        message,
    };
    let client = match http(&s.user_agent) {
        Ok(c) => c,
        Err(e) => return base(false, e),
    };
    let resp = client
        .get(url)
        .header("Cookie", &s.cookie)
        .header("Referer", CBG_ORIGIN)
        .send()
        .await;
    let body: serde_json::Value = match resp {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(e) => return base(false, format!("返回内容无法解析: {e}")),
        },
        Err(e) => return base(false, format!("网络请求失败: {e}")),
    };
    match body["status_code"].as_str().unwrap_or_default() {
        "OK" => base(true, "已登录".into()),
        "SESSION_TIMEOUT" => base(false, "登录已过期，请重新登录".into()),
        other => base(false, format!("藏宝阁返回异常：{other} {}", body["msg"].as_str().unwrap_or_default())),
    }
}

#[tauri::command]
pub async fn cbg_status(app: AppHandle) -> Res<CbgStatus> {
    match load_session(&app)? {
        Some(s) => Ok(check(&s).await),
        None => Ok(CbgStatus {
            logged_in: false,
            server_id: None,
            saved_at: None,
            message: "未登录".into(),
        }),
    }
}

/// 打开藏宝阁登录窗口。登录完成后页面会跳离 login.py，此时向前端发 cbg-navigated 事件。
#[tauri::command]
pub async fn cbg_open_login(app: AppHandle, server_id: u32) -> Res<()> {
    let url: Url = format!("{CBG_ORIGIN}cgi-bin/login.py?act=show_login&server_id={server_id}")
        .parse()
        .map_err(err("登录地址错误"))?;

    if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
        w.navigate(url).map_err(|e| e.to_string())?;
        let _ = w.set_focus();
        return Ok(());
    }

    let handle = app.clone();
    WebviewWindowBuilder::new(&app, LOGIN_LABEL, WebviewUrl::External(url))
        .title("登录藏宝阁（登录成功后会自动关闭）")
        .inner_size(1100.0, 760.0)
        .on_navigation(move |u| {
            let on_cbg = u.host_str() == Some("xyq.cbg.163.com");
            if on_cbg && !u.path().contains("login") {
                let _ = handle.emit("cbg-navigated", u.to_string());
            }
            true
        })
        .build()
        .map_err(err("打开登录窗口失败"))?;
    Ok(())
}

/// 从登录窗口读取 Cookie 并保存；会话有效则关闭登录窗口。
/// 必须是 async 命令：Windows 上同步调用 cookies_for_url 会死锁。
#[tauri::command]
pub async fn cbg_capture(app: AppHandle, server_id: u32, user_agent: String) -> Res<CbgStatus> {
    let w = app
        .get_webview_window(LOGIN_LABEL)
        .ok_or("登录窗口未打开")?;
    let main_url = Url::parse(CBG_ORIGIN).map_err(|e| e.to_string())?;
    let cookie = cookie_header(w.cookies_for_url(main_url).map_err(err("读取 Cookie 失败"))?);
    if cookie.is_empty() {
        return Err("还没有获取到登录信息，请先在登录窗口完成登录".into());
    }

    let session = CbgSession {
        cookie,
        user_agent,
        server_id,
        saved_at: now_ms(),
    };
    // 先保存再校验：即使校验接口判断有误，会话也不会丢
    save_session(&app, &session)?;
    let status = check(&session).await;
    if status.logged_in {
        let _ = w.close();
    }
    Ok(status)
}

/// 清除本地保存的会话
#[tauri::command]
pub async fn cbg_logout(app: AppHandle) -> Res<()> {
    let path = data_dir(&app)?.join(SESSION_FILE);
    if path.exists() {
        fs::remove_file(path).map_err(err("清除会话失败"))?;
    }
    if let Some(w) = app.get_webview_window(LOGIN_LABEL) {
        let _ = w.clear_all_browsing_data();
        let _ = w.close();
    }
    Ok(())
}

// ---------------- 金价 ----------------

/// 藏宝阁里梦幻币的分类 id（kind_data.js: [23, "梦幻币", ...]）
const MONEY_KINDID: u64 = 23;

#[derive(Serialize)]
pub struct GoldListing {
    /// 梦幻币数量
    count: u64,
    /// 售价（分）
    price_fen: u64,
    /// 1 元可买多少梦幻币
    coins_per_yuan: f64,
}

#[derive(Serialize)]
pub struct GoldQuote {
    server_id: u32,
    server_name: String,
    /// 单价最低的若干单（按单价从低到高）
    listings: Vec<GoldListing>,
    /// 最便宜一单：1 元 = 多少梦幻币
    best: f64,
    /// 这些单的中位数：1 元 = 多少梦幻币
    median: f64,
    total_pages: u64,
    fetched_at: u64,
}

fn as_u64(v: &serde_json::Value) -> Option<u64> {
    v.as_u64()
        .or_else(|| v.as_f64().map(|f| f as u64))
        .or_else(|| v.as_str()?.parse().ok())
}

fn parse_gold(body: &serde_json::Value, server_id: u32) -> Res<GoldQuote> {
    let list = body["equip_list"].as_array().ok_or("返回数据中没有寄售列表")?;
    let mut server_name = String::new();
    let mut listings: Vec<GoldListing> = list
        .iter()
        .filter(|e| as_u64(&e["kindid"]) == Some(MONEY_KINDID))
        .filter_map(|e| {
            let count = as_u64(&e["equip_count"])?;
            let price_fen = as_u64(&e["price"])?;
            if count == 0 || price_fen == 0 {
                return None;
            }
            if server_name.is_empty() {
                server_name = e["server_name"].as_str().unwrap_or_default().to_string();
            }
            Some(GoldListing {
                count,
                price_fen,
                coins_per_yuan: count as f64 * 100.0 / price_fen as f64,
            })
        })
        .collect();
    if listings.is_empty() {
        return Err("该服务器暂时没有梦幻币在售".into());
    }
    // 1 元能买到的越多越便宜
    listings.sort_by(|a, b| b.coins_per_yuan.total_cmp(&a.coins_per_yuan));
    let n = listings.len();
    let median = if n % 2 == 1 {
        listings[n / 2].coins_per_yuan
    } else {
        (listings[n / 2 - 1].coins_per_yuan + listings[n / 2].coins_per_yuan) / 2.0
    };
    Ok(GoldQuote {
        server_id,
        server_name,
        best: listings[0].coins_per_yuan,
        median,
        listings,
        total_pages: as_u64(&body["total_pages"]).unwrap_or(0),
        fetched_at: now_ms(),
    })
}

/// 查询指定服务器梦幻币寄售中单价最低的 15 单，计算金价
#[tauri::command]
pub async fn cbg_gold_price(app: AppHandle, server_id: u32) -> Res<GoldQuote> {
    let s = load_session(&app)?.ok_or("请先在设置中登录藏宝阁")?;
    let url = format!(
        "{RECOMMD_ORIGIN}cgi-bin/recommend.py?act=recommd_by_role&server_id={server_id}\
         &kindid={MONEY_KINDID}&order_by=unit_price%20ASC&page=1&count=15&view_loc=equip_list&_={}",
        now_ms()
    );
    let referer = format!("{CBG_ORIGIN}cgi-bin/query.py?act=query&server_id={server_id}&kindid={MONEY_KINDID}");
    let body: serde_json::Value = http(&s.user_agent)?
        .get(url)
        .header("Cookie", &s.cookie)
        .header("Referer", referer)
        .send()
        .await
        .map_err(err("请求藏宝阁失败"))?
        .json()
        .await
        .map_err(err("藏宝阁返回内容无法解析"))?;
    match body["status_code"].as_str().unwrap_or_default() {
        "OK" => parse_gold(&body, server_id),
        "SESSION_TIMEOUT" => Err("藏宝阁登录已过期，请到设置中重新登录".into()),
        other => Err(format!("藏宝阁返回异常：{other} {}", body["msg"].as_str().unwrap_or_default())),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_server_list() {
        let js = r#"var product_name = "xyq";
var server_data = {"2": [["广东3区", "4_7"], [[2, "罗浮山", "1_1"], [677, "广州湾", "2_1"]]], "1": [["上海1区", "5_4"], [[159, "珍宝阁", "1_1"]]]};"#;
        let areas = parse_server_list(js).unwrap();
        assert_eq!(areas.len(), 2);
        assert_eq!(areas[0].name, "上海1区");
        assert_eq!(areas[0].servers[0].id, 159);
        assert_eq!(areas[1].servers[1].name, "广州湾");
    }

    #[test]
    fn parses_gold_quote() {
        let body = serde_json::json!({
            "status_code": "OK",
            "total_pages": 70,
            "equip_list": [
                {"kindid": 23, "equip_count": 30000000, "price": 20000, "server_name": "龙争虎斗"},
                {"kindid": 23, "equip_count": 30000000, "price": 19966, "server_name": "龙争虎斗"},
                {"kindid": 23, "equip_count": "10000000", "price": "7000", "server_name": "龙争虎斗"},
                {"kindid": 27, "equip_count": 1, "price": 100}
            ]
        });
        let q = parse_gold(&body, 816).unwrap();
        assert_eq!(q.server_name, "龙争虎斗");
        assert_eq!(q.listings.len(), 3);
        // 199.66 元买 3000 万 -> 1 元约 150254 梦幻币
        assert!((q.best - 150_255.0).abs() < 1.0, "{}", q.best);
        assert!((q.median - 150_000.0).abs() < 1.0, "{}", q.median);
        assert_eq!(q.total_pages, 70);
    }
}

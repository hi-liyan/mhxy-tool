//! 玩家心得：每天从几个梦幻社区抓一次新文章，按用户设置的主题筛选、打分，存到本地。
//!
//! - 数据单独存放在数据目录的 `community.json`，不进 `data.json`，也不进记账备份。
//! - 只抓 robots.txt 允许的公开页面，不登录、不带 Cookie，同一站点的请求间隔几秒。
//! - 只保存标题、摘要、要点句和链接，不保存全文。
//! - 应用启动后在后台静默检查，距上次成功抓取满 20 小时才抓，之后每小时检查一次。

mod rank;
mod robots;
mod sources;
mod text;

use serde::{Deserialize, Serialize};
use sources::{Article, Entry, Source, SOURCES};
use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use url::Url;

type Res<T> = Result<T, String>;

const FILE: &str = "community.json";
/// robots.txt 里用来匹配规则组的产品名，也是 User-Agent 的前缀
const AGENT: &str = "mhxy-tools";
const HOUR_MS: i64 = 3_600_000;
const DAY_MS: i64 = 24 * HOUR_MS;
/// 距上次成功抓取满这么久才自动抓（每天一次，留几小时余量）
const AUTO_INTERVAL_MS: i64 = 20 * HOUR_MS;
/// 列表页里只看最近 30 天的文章
const WINDOW_MS: i64 = 30 * DAY_MS;
/// 未收藏的条目保留 90 天
const KEEP_MS: i64 = 90 * DAY_MS;
/// 每个来源每次最多打开 20 篇文章
const MAX_ARTICLES: usize = 20;
const REQUEST_GAP: Duration = Duration::from_secs(2);
const MAX_PAGE_BYTES: usize = 4 * 1024 * 1024;
pub const EVENT: &str = "feeds-updated";

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Topic {
    pub id: String,
    pub name: String,
    pub keywords: Vec<String>,
    pub enabled: bool,
}

impl Default for Topic {
    fn default() -> Self {
        Self {
            id: String::new(),
            name: String::new(),
            keywords: Vec::new(),
            enabled: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default)]
pub struct Settings {
    /// 启动后在后台自动抓取
    pub auto: bool,
    /// 来源开关，没有记录的来源视为开启
    pub sources: BTreeMap<String, bool>,
    pub topics: Vec<Topic>,
    /// 标题含这些词的文章不进收件箱
    pub exclude: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        let topic = |id: &str, name: &str, keywords: &[&str]| Topic {
            id: id.into(),
            name: name.into(),
            keywords: keywords.iter().map(|k| k.to_string()).collect(),
            enabled: true,
        };
        Self {
            auto: true,
            sources: BTreeMap::new(),
            topics: vec![
                topic(
                    "fixed-damage",
                    "固伤",
                    &[
                        "固伤",
                        "固定伤害",
                        "阎罗令",
                        "夺命咒",
                        "雨落寒沙",
                        "索命无常",
                        "凤舞九天",
                        "销魂噬骨",
                        "幽冥术",
                        "鬼蛊灵蕴",
                    ],
                ),
                topic("221", "221", &["221"]),
            ],
            exclude: vec!["手游".into(), "礼包码".into(), "兑换码".into()],
        }
    }
}

fn clean_words(words: Vec<String>, max: usize) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in words {
        let w: String = w.trim().chars().take(20).collect();
        if !w.is_empty() && !out.contains(&w) && out.len() < max {
            out.push(w);
        }
    }
    out
}

impl Settings {
    fn source_enabled(&self, key: &str) -> bool {
        self.sources.get(key).copied().unwrap_or(true)
    }

    /// 清理前端传来的设置：去空白和重复，限制数量和长度，保证主题 ID 唯一
    fn sanitized(self) -> Self {
        let mut ids: HashSet<String> = HashSet::new();
        let mut topics = Vec::new();
        for t in self.topics {
            let name: String = t.name.trim().chars().take(20).collect();
            if name.is_empty() || topics.len() >= 20 {
                continue;
            }
            let mut id: String =
                t.id.chars()
                    .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
                    .take(40)
                    .collect();
            let mut n = 1;
            while id.is_empty() || ids.contains(&id) {
                id = format!("topic-{n}");
                n += 1;
            }
            ids.insert(id.clone());
            topics.push(Topic {
                id,
                name,
                keywords: clean_words(t.keywords, 50),
                enabled: t.enabled,
            });
        }
        Self {
            auto: self.auto,
            sources: self
                .sources
                .into_iter()
                .filter(|(k, _)| sources::source(k).is_some())
                .collect(),
            topics,
            exclude: clean_words(self.exclude, 50),
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Mirror {
    pub source: String,
    pub url: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct Item {
    /// 规范化后的链接（主机名 + 路径）
    pub id: String,
    pub source: String,
    pub url: String,
    pub title: String,
    pub author: Option<String>,
    pub published: Option<i64>,
    pub fetched: i64,
    pub summary: String,
    /// 正文中含关键词的句子
    pub points: Vec<String>,
    /// 抓取时各关键词在全文中出现的次数，设置变化后重算主题时使用
    pub hits: BTreeMap<String, u32>,
    /// 与主题无关的质量分
    pub quality: f64,
    pub tags: Vec<String>,
    pub simhash: String,
    /// 其他网站上的转载
    pub mirrors: Vec<Mirror>,
    // 以下四项由当前设置算出
    pub topics: Vec<String>,
    pub excluded: bool,
    /// 主题相关度：标题命中 3 分，正文每次提到 0.5 分（最多 3 分），各主题相加
    pub relevance: f64,
    pub score: f64,
    pub read: bool,
    pub starred: bool,
    pub ignored: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(default)]
pub struct SourceStatus {
    pub ok: bool,
    pub at: i64,
    pub message: String,
    pub added: u32,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(default)]
struct Store {
    version: u32,
    settings: Settings,
    last_run: Option<i64>,
    sources: BTreeMap<String, SourceStatus>,
    items: Vec<Item>,
}

/// 内存中的数据在首次使用时从文件读取；读取失败时不缓存，也不写文件
#[derive(Default)]
pub struct FeedState {
    store: Mutex<Option<Store>>,
    running: AtomicBool,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as i64)
}

fn load(path: &Path) -> Res<Store> {
    if !path.exists() {
        return Ok(Store {
            version: 1,
            ..Default::default()
        });
    }
    let text = fs::read_to_string(path).map_err(|e| format!("读取玩家心得数据失败：{e}"))?;
    let mut store: Store = serde_json::from_str(&text).map_err(|e| {
        format!(
            "玩家心得数据（{}）格式不正确：{e}。文件没有被改动，修复或移走它后重试",
            path.display()
        )
    })?;
    let settings = store.settings.clone();
    for item in &mut store.items {
        rank::refresh(item, &settings);
    }
    Ok(store)
}

/// 原子写入：先写临时文件再 rename
fn save(path: &Path, store: &Store) -> Res<()> {
    let content = serde_json::to_string(store).map_err(|e| e.to_string())?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, content).map_err(|e| format!("写入玩家心得数据失败：{e}"))?;
    fs::rename(&tmp, path).map_err(|e| format!("保存玩家心得数据失败：{e}"))
}

fn file_path(app: &AppHandle) -> Res<PathBuf> {
    Ok(crate::data_dir(app)?.join(FILE))
}

fn with_store<T>(app: &AppHandle, f: impl FnOnce(&mut Store, &Path) -> Res<T>) -> Res<T> {
    let state = app.state::<FeedState>();
    let mut guard = state
        .store
        .lock()
        .map_err(|_| "玩家心得数据状态异常，请重启应用".to_string())?;
    let path = file_path(app)?;
    if guard.is_none() {
        *guard = Some(load(&path)?);
    }
    match guard.as_mut() {
        Some(store) => f(store, &path),
        None => Err("玩家心得数据未加载".into()),
    }
}

fn in_inbox(item: &Item) -> bool {
    !item.topics.is_empty() && !item.excluded && !item.ignored
}

fn unread(store: &Store) -> usize {
    store
        .items
        .iter()
        .filter(|i| in_inbox(i) && !i.read)
        .count()
}

/// 已有条目和转载链接，抓取时跳过
fn known_ids(store: &Store) -> HashSet<String> {
    let mut ids: HashSet<String> = store.items.iter().map(|i| i.id.clone()).collect();
    for item in &store.items {
        ids.extend(item.mirrors.iter().map(|m| sources::canonical(&m.url)));
    }
    ids
}

struct Fetched {
    entry: Entry,
    article: Option<Article>,
}

/// 新条目写入数据；与已有条目重复的记为转载。返回（新增数，进收件箱数）
fn merge(store: &mut Store, source: &Source, fetched: Vec<Fetched>, now: i64) -> (u32, u32) {
    let (mut added, mut matched) = (0, 0);
    for f in fetched {
        let item = rank::build_item(&store.settings, source, &f.entry, f.article.as_ref(), now);
        if store.items.iter().any(|i| i.id == item.id) {
            continue;
        }
        if let Some(dup) = store
            .items
            .iter_mut()
            .find(|i| rank::is_duplicate(i, &item))
        {
            if !dup.mirrors.iter().any(|m| m.url == item.url) {
                dup.mirrors.push(Mirror {
                    source: item.source,
                    url: item.url,
                });
            }
            continue;
        }
        if in_inbox(&item) {
            matched += 1;
        }
        store.items.push(item);
        added += 1;
    }
    (added, matched)
}

fn prune(store: &mut Store, now: i64) {
    store
        .items
        .retain(|i| i.starred || i.fetched >= now - KEEP_MS);
}

/// 带 robots.txt 检查和同站请求间隔的抓取器
struct Fetcher {
    client: reqwest::Client,
    /// 每个站点的 robots.txt；None 表示站点没有 robots.txt
    robots: HashMap<String, Option<String>>,
    last: HashMap<String, Instant>,
}

impl Fetcher {
    fn new() -> Res<Self> {
        let client = reqwest::Client::builder()
            .user_agent(concat!("mhxy-tools/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(20))
            .build()
            .map_err(|e| format!("初始化网络失败：{e}"))?;
        Ok(Self {
            client,
            robots: HashMap::new(),
            last: HashMap::new(),
        })
    }

    async fn get(&mut self, url: &Url) -> Res<(u16, Option<String>, Vec<u8>)> {
        let host = url.host_str().unwrap_or_default().to_string();
        if let Some(t) = self.last.get(&host) {
            let passed = t.elapsed();
            if passed < REQUEST_GAP {
                tokio::time::sleep(REQUEST_GAP - passed).await;
            }
        }
        self.last.insert(host, Instant::now());
        let resp = self
            .client
            .get(url.as_str())
            .send()
            .await
            .map_err(|e| format!("网络请求失败：{e}"))?;
        let status = resp.status().as_u16();
        let content_type = resp
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .map(str::to_string);
        let bytes = resp
            .bytes()
            .await
            .map_err(|e| format!("读取网页失败：{e}"))?;
        if bytes.len() > MAX_PAGE_BYTES {
            return Err("网页太大，已跳过".into());
        }
        Ok((status, content_type, bytes.to_vec()))
    }

    /// robots.txt 允许时返回网页文字
    async fn page(&mut self, url: &str) -> Res<String> {
        let url = Url::parse(url).map_err(|_| format!("链接不正确：{url}"))?;
        let origin = url.origin().ascii_serialization();
        if !self.robots.contains_key(&origin) {
            let robots_url =
                Url::parse(&format!("{origin}/robots.txt")).map_err(|e| e.to_string())?;
            let rules = match self.get(&robots_url).await {
                Ok((200..=299, content_type, body)) => {
                    Some(text::decode_html(&body, content_type.as_deref()))
                }
                // 没有 robots.txt：不限制
                Ok((400..=499, _, _)) => None,
                Ok((status, _, _)) => {
                    self.robots
                        .insert(origin, Some("User-agent: *\nDisallow: /".into()));
                    return Err(format!("读取 robots.txt 失败：HTTP {status}"));
                }
                Err(e) => {
                    self.robots
                        .insert(origin, Some("User-agent: *\nDisallow: /".into()));
                    return Err(format!("读取 robots.txt 失败：{e}"));
                }
            };
            self.robots.insert(origin.clone(), rules);
        }
        if let Some(Some(rules)) = self.robots.get(&origin) {
            let path = match url.query() {
                Some(q) => format!("{}?{q}", url.path()),
                None => url.path().to_string(),
            };
            if !robots::allowed(rules, AGENT, &path) {
                return Err("robots.txt 不允许抓取这个页面".into());
            }
        }
        let (status, content_type, body) = self.get(&url).await?;
        if !(200..300).contains(&status) {
            return Err(format!("HTTP {status}"));
        }
        Ok(text::decode_html(&body, content_type.as_deref()))
    }
}

/// 读取一个来源的新文章：列表页 → 去掉已有和过旧的 → 逐篇打开文章页。返回（文章，没打开的篇数）
async fn fetch_source(
    f: &mut Fetcher,
    src: &Source,
    known: &HashSet<String>,
    now: i64,
) -> Res<(Vec<Fetched>, u32)> {
    let mut entries: Vec<Entry> = Vec::new();
    let mut list_error = None;
    for list in src.lists {
        match f.page(list).await {
            Ok(html) => entries.extend(sources::parse_list(src.key, list, &html)),
            Err(e) => list_error = Some(e),
        }
    }
    if entries.is_empty() {
        return Err(match list_error {
            Some(e) => format!("列表页打不开：{e}"),
            None => "列表页没有解析到文章，网站可能改版了".into(),
        });
    }
    let mut seen = HashSet::new();
    entries.retain(|e| {
        let id = sources::canonical(&e.url);
        !known.contains(&id) && seen.insert(id) && e.published.is_none_or(|t| t >= now - WINDOW_MS)
    });
    // 新的在前；没有日期的排在最后
    entries.sort_by_key(|e| std::cmp::Reverse(e.published));
    entries.truncate(MAX_ARTICLES);

    let mut out = Vec::new();
    let mut failed = 0;
    for entry in entries {
        match f.page(&entry.url).await {
            Ok(html) => {
                let article = sources::parse_article(src.key, &html);
                // 文章页解析不了时用列表页的标题和摘要；连标题都没有的跳过
                if article.is_none() && entry.title.is_empty() {
                    failed += 1;
                } else {
                    out.push(Fetched { entry, article });
                }
            }
            Err(_) => failed += 1,
        }
    }
    Ok((out, failed))
}

#[derive(Serialize, Clone, Default)]
pub struct Report {
    pub added: u32,
    pub matched: u32,
    pub failed: Vec<String>,
}

#[derive(Serialize, Clone)]
struct Update {
    running: bool,
    unread: usize,
}

/// 通知前端刷新未读数和抓取状态
fn notify(app: &AppHandle) {
    let running = app.state::<FeedState>().running.load(Ordering::SeqCst);
    let unread = with_store(app, |s, _| Ok(unread(s))).unwrap_or(0);
    let _ = app.emit(EVENT, Update { running, unread });
}

struct RunningFlag<'a>(&'a AtomicBool);

impl Drop for RunningFlag<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

async fn run(app: &AppHandle) -> Res<Report> {
    let state = app.state::<FeedState>();
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("正在抓取，请稍候".into());
    }
    let flag = RunningFlag(&state.running);
    notify(app);
    let result = run_sources(app).await;
    drop(flag);
    notify(app);
    result
}

async fn run_sources(app: &AppHandle) -> Res<Report> {
    let (settings, mut known) = with_store(app, |s, _| Ok((s.settings.clone(), known_ids(s))))?;
    let mut fetcher = Fetcher::new()?;
    let mut report = Report::default();
    let mut any_ok = false;
    for src in SOURCES.iter().filter(|s| settings.source_enabled(s.key)) {
        let now = now_ms();
        let status = match fetch_source(&mut fetcher, src, &known, now).await {
            Ok((fetched, failed)) => {
                any_ok = true;
                let (added, matched) = with_store(app, |s, _| Ok(merge(s, src, fetched, now)))?;
                report.added += added;
                report.matched += matched;
                let mut message = format!("新增 {added} 篇，其中 {matched} 篇命中主题");
                if failed > 0 {
                    message.push_str(&format!("；{failed} 篇没打开"));
                }
                SourceStatus {
                    ok: true,
                    at: now,
                    message,
                    added,
                }
            }
            Err(e) => {
                report.failed.push(format!("{}：{e}", src.name));
                SourceStatus {
                    ok: false,
                    at: now,
                    message: e,
                    added: 0,
                }
            }
        };
        with_store(app, |s, path| {
            s.sources.insert(src.key.to_string(), status);
            known = known_ids(s);
            save(path, s)
        })?;
        notify(app);
    }
    with_store(app, |s, path| {
        let now = now_ms();
        // 全部失败（比如没联网）时不记抓取时间，下个小时再试
        if any_ok {
            s.last_run = Some(now);
        }
        prune(s, now);
        save(path, s)
    })?;
    Ok(report)
}

/// 应用启动后在后台检查是否该抓取，之后每小时检查一次
pub fn start(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(30)).await;
        loop {
            let due = with_store(&app, |s, _| {
                Ok(s.settings.auto && s.last_run.is_none_or(|t| now_ms() - t >= AUTO_INTERVAL_MS))
            })
            .unwrap_or(false);
            if due {
                let _ = run(&app).await;
            }
            tokio::time::sleep(Duration::from_secs(3600)).await;
        }
    });
}

#[derive(Serialize)]
pub struct SourceView {
    key: &'static str,
    name: &'static str,
    enabled: bool,
    status: Option<SourceStatus>,
}

#[derive(Serialize)]
pub struct View {
    settings: Settings,
    sources: Vec<SourceView>,
    last_run: Option<i64>,
    running: bool,
    unread: usize,
    items: Vec<Item>,
}

fn view(app: &AppHandle) -> Res<View> {
    let running = app.state::<FeedState>().running.load(Ordering::SeqCst);
    with_store(app, |s, _| {
        let mut items = s.items.clone();
        items.sort_by(|a, b| {
            b.fetched
                .cmp(&a.fetched)
                .then(b.published.cmp(&a.published))
        });
        let sources = SOURCES
            .iter()
            .map(|src| SourceView {
                key: src.key,
                name: src.name,
                enabled: s.settings.source_enabled(src.key),
                status: s.sources.get(src.key).cloned(),
            })
            .collect();
        Ok(View {
            settings: s.settings.clone(),
            sources,
            last_run: s.last_run,
            running,
            unread: unread(s),
            items,
        })
    })
}

#[tauri::command]
pub async fn feeds_state(app: AppHandle) -> Res<View> {
    view(&app)
}

#[tauri::command]
pub async fn feeds_unread(app: AppHandle) -> Res<usize> {
    with_store(&app, |s, _| Ok(unread(s)))
}

#[tauri::command]
pub async fn feeds_fetch_now(app: AppHandle) -> Res<Report> {
    run(&app).await
}

/// 批量修改已读、收藏、忽略，返回新的未读数
#[tauri::command]
pub async fn feeds_mark(
    app: AppHandle,
    ids: Vec<String>,
    read: Option<bool>,
    starred: Option<bool>,
    ignored: Option<bool>,
) -> Res<usize> {
    let ids: HashSet<String> = ids.into_iter().collect();
    let n = with_store(&app, |s, path| {
        for item in s.items.iter_mut().filter(|i| ids.contains(&i.id)) {
            if let Some(v) = read {
                item.read = v;
            }
            if let Some(v) = starred {
                item.starred = v;
            }
            if let Some(v) = ignored {
                item.ignored = v;
            }
        }
        save(path, s)?;
        Ok(unread(s))
    })?;
    notify(&app);
    Ok(n)
}

/// 保存设置，并按新设置重新匹配已有条目
#[tauri::command]
pub async fn feeds_save_settings(app: AppHandle, settings: Settings) -> Res<View> {
    let settings = settings.sanitized();
    with_store(&app, |s, path| {
        for item in &mut s.items {
            rank::refresh(item, &settings);
        }
        s.settings = settings;
        save(path, s)
    })?;
    notify(&app);
    view(&app)
}

/// 用系统浏览器打开原文，只放行来源网站的链接
#[tauri::command]
pub async fn feeds_open(url: String) -> Res<()> {
    let parsed = Url::parse(&url).map_err(|_| "链接不正确".to_string())?;
    let allowed = matches!(parsed.scheme(), "http" | "https")
        && parsed
            .host_str()
            .is_some_and(|h| sources::HOSTS.contains(&h));
    if !allowed {
        return Err("只能打开玩家心得来源网站的链接".into());
    }
    crate::open_with_system(parsed.as_str().as_ref()).map_err(|e| format!("打开浏览器失败：{e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn item(id: &str, fetched: i64, topics: &[&str]) -> Item {
        Item {
            id: id.into(),
            url: format!("https://{id}"),
            title: format!("标题{id}"),
            fetched,
            topics: topics.iter().map(|t| t.to_string()).collect(),
            ..Default::default()
        }
    }

    #[test]
    fn unread_counts_only_inbox_items() {
        let mut store = Store {
            items: vec![
                item("a", 0, &["221"]),
                item("b", 0, &[]),
                item("c", 0, &["221"]),
                item("d", 0, &["221"]),
            ],
            ..Default::default()
        };
        store.items[2].read = true;
        store.items[3].excluded = true;
        assert_eq!(unread(&store), 1);
    }

    #[test]
    fn prune_keeps_starred_and_recent() {
        let now = 200 * DAY_MS;
        let mut store = Store {
            items: vec![
                item("old", 0, &[]),
                item("star", 0, &[]),
                item("new", now - DAY_MS, &[]),
            ],
            ..Default::default()
        };
        store.items[1].starred = true;
        prune(&mut store, now);
        let ids: Vec<&str> = store.items.iter().map(|i| i.id.as_str()).collect();
        assert_eq!(ids, ["star", "new"]);
    }

    #[test]
    fn merge_records_reposts_as_mirrors() {
        let mut store = Store::default();
        let official = sources::source("official").unwrap();
        let yzz = sources::source("yzz").unwrap();
        let fetched = |url: &str, title: &str| Fetched {
            entry: Entry {
                url: url.into(),
                title: title.into(),
                published: None,
                summary: None,
            },
            article: None,
        };
        let r = merge(
            &mut store,
            official,
            vec![fetched(
                "https://xyq.163.com/a/20261117/1_1.html",
                "11月17日定期维护公告：再战天罡",
            )],
            0,
        );
        assert_eq!(r, (1, 0));
        let r = merge(
            &mut store,
            yzz,
            vec![fetched(
                "http://xyq.yzz.cn/focus/202611/1.shtml",
                "梦幻西游11月17日定期维护公告：再战天罡",
            )],
            0,
        );
        assert_eq!(r, (0, 0));
        assert_eq!(store.items.len(), 1);
        assert_eq!(store.items[0].mirrors[0].source, "yzz");
        assert!(
            known_ids(&store).contains("xyq.yzz.cn/focus/202611/1.shtml"),
            "转载链接下次不再抓"
        );
    }

    #[test]
    fn sanitize_settings() {
        let s = Settings {
            auto: false,
            sources: [("yzz".to_string(), false), ("unknown".to_string(), true)]
                .into_iter()
                .collect(),
            topics: vec![
                Topic {
                    id: "a b".into(),
                    name: " 抓鬼 ".into(),
                    keywords: vec![" 抓鬼 ".into(), "".into(), "抓鬼".into()],
                    enabled: true,
                },
                Topic {
                    id: "ab".into(),
                    name: "重复 ID".into(),
                    keywords: vec![],
                    enabled: false,
                },
                Topic {
                    id: "x".into(),
                    name: "  ".into(),
                    keywords: vec!["无名".into()],
                    enabled: true,
                },
            ],
            exclude: vec!["手游".into(), " 手游 ".into()],
        }
        .sanitized();
        assert!(!s.auto);
        assert_eq!(s.sources.len(), 1);
        assert!(!s.source_enabled("yzz"));
        assert!(s.source_enabled("official"));
        assert_eq!(s.topics.len(), 2, "没有名字的主题被丢弃");
        assert_eq!(s.topics[0].id, "ab");
        assert_eq!(s.topics[0].name, "抓鬼");
        assert_eq!(s.topics[0].keywords, ["抓鬼"]);
        assert_eq!(s.topics[1].id, "topic-1");
        assert_eq!(s.exclude, ["手游"]);
    }

    #[test]
    fn old_files_get_defaults() {
        let store: Store = serde_json::from_str(r#"{"items":[{"id":"a","title":"x"}]}"#).unwrap();
        assert!(store.settings.auto);
        assert_eq!(store.settings.topics.len(), 2);
        assert!(!store.items[0].starred);
    }

    /// 真实抓取一次（不写文件）：
    /// cargo test --manifest-path src-tauri/Cargo.toml live_fetch -- --ignored --nocapture
    #[test]
    #[ignore = "访问真实网站"]
    fn live_fetch() {
        tauri::async_runtime::block_on(async {
            let mut store = Store::default();
            let mut f = Fetcher::new().unwrap();
            let now = now_ms();
            let mut all: Vec<Item> = Vec::new();
            for src in SOURCES {
                let started = Instant::now();
                match fetch_source(&mut f, src, &HashSet::new(), now).await {
                    Ok((fetched, failed)) => {
                        println!(
                            "== {}：{} 篇，没打开 {failed} 篇，用时 {:?}",
                            src.name,
                            fetched.len(),
                            started.elapsed()
                        );
                        for x in &fetched {
                            let item = rank::build_item(
                                &store.settings,
                                src,
                                &x.entry,
                                x.article.as_ref(),
                                now,
                            );
                            let parsed = if x.article.is_some() {
                                ""
                            } else {
                                "（文章页未解析）"
                            };
                            println!(
                                "  [{:>4.1}] {} {:?} {:?}{parsed}",
                                item.score, item.title, item.topics, item.tags
                            );
                            for p in &item.points {
                                println!("         · {p}");
                            }
                            all.push(item);
                        }
                        let (added, matched) = merge(&mut store, src, fetched, now);
                        println!("   合并后新增 {added} 篇，命中主题 {matched} 篇");
                    }
                    Err(e) => println!("== {}：失败 {e}", src.name),
                }
            }
            println!("== 识别为转载");
            for item in store.items.iter().filter(|i| !i.mirrors.is_empty()) {
                let others: Vec<&str> = item.mirrors.iter().map(|m| m.source.as_str()).collect();
                println!("  {}（{}）← {others:?}", item.title, item.source);
            }
            println!("== 正文 SimHash 相差 12 位以内的文章对（用来校准阈值）");
            let hash = |i: &Item| u64::from_str_radix(&i.simhash, 16).unwrap_or(0);
            for (i, a) in all.iter().enumerate() {
                for b in &all[i + 1..] {
                    let d = (hash(a) ^ hash(b)).count_ones();
                    if hash(a) != 0 && hash(b) != 0 && d <= 12 {
                        println!(
                            "  {d:>2} 位：{}（{}） | {}（{}）",
                            a.title, a.source, b.title, b.source
                        );
                    }
                }
            }
        });
    }
}

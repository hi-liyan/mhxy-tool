//! 各来源的列表页和文章页解析。网站改版时只需要改这里，并更新对应的测试样例。

use super::text::{beijing_ms, element_text, first_text, parse_date, parse_iso, sel};
use regex::Regex;
use scraper::Html;
use std::sync::LazyLock;
use url::Url;

pub struct Source {
    pub key: &'static str,
    pub name: &'static str,
    /// 每次抓取读取的列表页
    pub lists: &'static [&'static str],
    /// 来源可信度，计入价值分
    pub trust: f64,
}

pub const SOURCES: &[Source] = &[
    Source {
        key: "official",
        name: "梦幻官网",
        lists: &["https://xyq.163.com/news/"],
        trust: 2.0,
    },
    Source {
        key: "yzz",
        name: "叶子猪",
        lists: &["http://xyq.yzz.cn/skill/", "http://xyq.yzz.cn/focus/"],
        trust: 1.0,
    },
    Source {
        key: "17173",
        name: "17173",
        lists: &["https://xyq.17173.com/"],
        trust: 1.0,
    },
    Source {
        key: "233",
        name: "233乐园",
        lists: &["https://www.233leyuan.com/circle/7dc2f23f5d364f2a886b5805761286fb"],
        trust: 0.0,
    },
];

/// 文章所在的站点。打开原文时也只放行这些站点。
pub const HOSTS: &[&str] = &[
    "xyq.163.com",
    "xyq.yzz.cn",
    "xyq.17173.com",
    "news.17173.com",
    "www.233leyuan.com",
];

pub fn source(key: &str) -> Option<&'static Source> {
    SOURCES.iter().find(|s| s.key == key)
}

/// 列表页上的一篇文章
#[derive(Debug, Clone)]
pub struct Entry {
    pub url: String,
    pub title: String,
    pub published: Option<i64>,
    pub summary: Option<String>,
}

/// 文章页解析结果。`text` 只在本次分析中使用，不落盘。
#[derive(Debug, Clone, Default)]
pub struct Article {
    pub title: String,
    pub published: Option<i64>,
    pub author: Option<String>,
    pub summary: Option<String>,
    pub text: String,
    pub comments: Option<u32>,
}

static OFFICIAL_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^https://xyq\.163\.com/[a-z_]+/(\d{4})(\d{2})(\d{2})/\d+_\d+\.html$").unwrap()
});
static YZZ_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^http://xyq\.yzz\.cn/[a-z_/]+/\d{6}/\d+\.shtml$").unwrap());
static S17173_URL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^https://(?:news|xyq)\.17173\.com/content/(\d{2})(\d{2})(\d{4})/\d+(?:_\d+)?\.shtml$",
    )
    .unwrap()
});
static L233_URL: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"^https://www\.233leyuan\.com/post-detail/\d+$").unwrap());

/// 相对链接转绝对链接，去掉锚点；17173 和官网统一用 https，叶子猪只支持 http
fn absolute(base: &Url, href: Option<&str>) -> Option<String> {
    let mut url = base.join(href?.trim()).ok()?;
    url.set_fragment(None);
    let host = url.host_str()?.to_string();
    if host.ends_with("17173.com") || host == "xyq.163.com" {
        url.set_scheme("https").ok()?;
    }
    Some(url.to_string())
}

/// 去重用的链接标识：主机名 + 路径，不含协议和查询串
pub fn canonical(url: &str) -> String {
    match Url::parse(url) {
        Ok(u) => format!("{}{}", u.host_str().unwrap_or(""), u.path()),
        Err(_) => url.to_string(),
    }
}

fn ymd(c: &regex::Captures, y: usize, m: usize, d: usize) -> Option<i64> {
    let n = |i: usize| c.get(i).and_then(|v| v.as_str().parse::<i64>().ok());
    beijing_ms(n(y)?, n(m)?, n(d)?, 0, 0, 0)
}

pub fn parse_list(key: &str, base: &str, html: &str) -> Vec<Entry> {
    let Ok(base) = Url::parse(base) else {
        return Vec::new();
    };
    let doc = Html::parse_document(html);
    let mut out: Vec<Entry> = Vec::new();
    let mut push = |e: Entry| {
        if !e.url.is_empty() && !out.iter().any(|x| x.url == e.url) {
            out.push(e);
        }
    };
    match key {
        "official" => {
            for a in doc.select(&sel("li.list > a[href]")) {
                let Some(url) = absolute(&base, a.value().attr("href")) else {
                    continue;
                };
                let Some(c) = OFFICIAL_URL.captures(&url) else {
                    continue;
                };
                let title = a
                    .value()
                    .attr("title")
                    .map(str::to_string)
                    .or_else(|| a.select(&sel(".sTitle")).next().map(element_text))
                    .unwrap_or_default();
                let summary = a.select(&sel(".desc")).next().map(element_text);
                push(Entry {
                    published: ymd(&c, 1, 2, 3),
                    url,
                    title,
                    summary,
                });
            }
        }
        "yzz" => {
            for li in doc.select(&sel("li")) {
                let link = li
                    .select(&sel("a[href]"))
                    .filter_map(|a| Some((absolute(&base, a.value().attr("href"))?, a)))
                    .find(|(url, _)| YZZ_URL.is_match(url));
                let Some((url, a)) = link else { continue };
                let title = a
                    .value()
                    .attr("title")
                    .map(str::to_string)
                    .unwrap_or_else(|| element_text(a));
                let published = li
                    .select(&sel("span"))
                    .map(element_text)
                    .find_map(|t| parse_date(&t));
                let summary = li.select(&sel("p")).next().map(element_text);
                push(Entry {
                    url,
                    title,
                    published,
                    summary,
                });
            }
        }
        "17173" => {
            for a in doc.select(&sel("a[href]")) {
                let Some(url) = absolute(&base, a.value().attr("href")) else {
                    continue;
                };
                let Some(c) = S17173_URL.captures(&url) else {
                    continue;
                };
                let title = element_text(a);
                if title.is_empty() {
                    continue;
                }
                push(Entry {
                    published: ymd(&c, 3, 1, 2),
                    url,
                    title,
                    summary: None,
                });
            }
        }
        "233" => {
            for a in doc.select(&sel("a[href]")) {
                let Some(url) = absolute(&base, a.value().attr("href")) else {
                    continue;
                };
                if L233_URL.is_match(&url) {
                    push(Entry {
                        url,
                        title: String::new(),
                        published: None,
                        summary: None,
                    });
                }
            }
        }
        _ => {}
    }
    out
}

pub fn parse_article(key: &str, html: &str) -> Option<Article> {
    let doc = Html::parse_document(html);
    let article = match key {
        "official" => Article {
            title: first_text(&doc, "h1.artTitle")?,
            published: first_text(&doc, ".artDate").and_then(|t| parse_date(&t)),
            summary: first_text(&doc, ".artTips")
                .map(|t| t.trim_start_matches("导读：").trim().to_string())
                .filter(|t| !t.is_empty()),
            text: first_text(&doc, ".artText")?,
            ..Default::default()
        },
        "yzz" => {
            // 发布时间和作者写在统计脚本的参数里
            let meta = doc
                .select(&sel("#article script[src*=\"address.js\"]"))
                .next()
                .and_then(|s| Url::parse(s.value().attr("src")?).ok());
            let param = |name: &str| {
                meta.as_ref()?
                    .query_pairs()
                    .find(|(k, _)| k == name)
                    .map(|(_, v)| v.trim().to_string())
                    .filter(|v| !v.is_empty())
            };
            let text = first_text(&doc, "#wrapper").or_else(|| first_text(&doc, "#article"))?;
            Article {
                title: first_text(&doc, "#article h1")?,
                published: param("pubdate").and_then(|t| parse_date(&t)),
                author: param("writer"),
                text: text
                    .lines()
                    .filter(|l| !l.contains("点击下载"))
                    .collect::<Vec<_>>()
                    .join("\n"),
                ..Default::default()
            }
        }
        "17173" => Article {
            title: first_text(&doc, "h1.article-title")?,
            published: first_text(&doc, ".article-time").and_then(|t| parse_date(&t)),
            author: first_text(&doc, ".article-author"),
            summary: first_text(&doc, ".article-summary-con"),
            text: first_text(&doc, ".article-content")?,
            ..Default::default()
        },
        "233" => {
            let ld = doc
                .select(&sel("script[type=\"application/ld+json\"]"))
                .filter_map(|s| {
                    serde_json::from_str::<serde_json::Value>(&s.text().collect::<String>()).ok()
                })
                .find(|v| v["@type"] == "DiscussionForumPosting")?;
            let s = |v: &serde_json::Value| {
                v.as_str()
                    .map(|t| t.trim().to_string())
                    .filter(|t| !t.is_empty())
            };
            // 正文是标题之后、第一个推荐区小标题之前的段落
            let mut text = Vec::new();
            let mut started = false;
            for el in doc.select(&sel("h1, h2, p")) {
                match el.value().name() {
                    "h1" => started = true,
                    "h2" if started => break,
                    "p" if started => text.push(element_text(el)),
                    _ => {}
                }
            }
            let headline = s(&ld["headline"])?;
            Article {
                title: first_text(&doc, "h1")
                    .unwrap_or_else(|| headline.split(" - ").next().unwrap_or("").to_string()),
                published: s(&ld["datePublished"]).and_then(|t| parse_iso(&t)),
                author: s(&ld["author"]["name"]),
                summary: s(&ld["text"]),
                text: text
                    .into_iter()
                    .filter(|t| !t.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n"),
                comments: ld["comment"].as_array().map(|c| c.len() as u32),
            }
        }
        _ => return None,
    };
    (!article.title.is_empty()).then_some(article)
}

#[cfg(test)]
mod tests {
    // 样例按各站真实页面的结构精简而成，文字为虚构内容
    use super::*;
    use crate::feeds::text::beijing_ms;

    #[test]
    fn parses_official_list_and_article() {
        let list = r#"<ul class="list-wrap"><li class="list">
            <a href="//xyq.163.com/org_bg/20261029/15743_1318072.html" title="[时间服]女儿村调整解读">
              <div class="channnel-title"><span class="sTitle">[时间服]女儿村调整解读</span><span class="time">10/30</span></div>
              <div class="desc">十月门派调整说明</div></a></li>
            <li class="list"><a href="//xyq.163.com/news/index_2.html">2</a></li></ul>"#;
        let e = parse_list("official", "https://xyq.163.com/news/", list);
        assert_eq!(e.len(), 1);
        assert_eq!(
            e[0].url,
            "https://xyq.163.com/org_bg/20261029/15743_1318072.html"
        );
        assert_eq!(e[0].title, "[时间服]女儿村调整解读");
        assert_eq!(e[0].published, beijing_ms(2026, 10, 29, 0, 0, 0));
        assert_eq!(e[0].summary.as_deref(), Some("十月门派调整说明"));

        let page = r#"<div id="NIE-art"><h1 class="artTitle">[时间服]女儿村调整解读</h1>
            <p class="artInfo"><span class="artDate">时间：2026-10-30</span></p>
            <div class="artTips"><span>导读：</span></div>
            <div class="artText"><p>雨落寒沙固伤提升 10%。</p><p>第二段。</p></div></div>"#;
        let a = parse_article("official", page).unwrap();
        assert_eq!(a.title, "[时间服]女儿村调整解读");
        assert_eq!(a.published, beijing_ms(2026, 10, 30, 0, 0, 0));
        assert_eq!(a.summary, None);
        assert_eq!(a.text, "雨落寒沙固伤提升 10%。\n第二段。");
    }

    #[test]
    fn parses_yzz_list_and_article() {
        let list = r#"<ul><li><div><span>[2026-11-18]</span><a href='/focus/' title="焦点关注">[焦点关注]</a>
            <a href="http://xyq.yzz.cn/focus/202611/1771076.shtml" title="221 五开怎么配">221 五开怎么配</a></div>
            <p>　　摘要文字……</p></li>
            <li><a href="http://xyq.yzz.cn/guide/201312/716121.shtml">69</a></li></ul>"#;
        let e = parse_list("yzz", "http://xyq.yzz.cn/focus/", list);
        assert_eq!(e.len(), 2, "老文章由抓取时的日期窗口过滤");
        assert_eq!(e[0].url, "http://xyq.yzz.cn/focus/202611/1771076.shtml");
        assert_eq!(e[0].title, "221 五开怎么配");
        assert_eq!(e[0].published, beijing_ms(2026, 11, 18, 0, 0, 0));
        assert_eq!(e[0].summary.as_deref(), Some("摘要文字……"));
        assert_eq!(e[1].published, None);

        let page = r#"<div id="article"><h1>221 五开怎么配</h1>
            <script type="text/javascript" src="http://common.yzz.cn/home/address.js?pubdate=2026-11-18 13:47&writer=%E5%B0%8F%E7%8C%AA&editor=x"></script>
            <div class="encryption-container"><table id="wrapper"><tr><td>
            <p><a href="/download">《梦幻西游》电脑版点击下载&gt;&gt;&gt;</a></p>
            <p>　　无底洞夺命咒固伤实测 1200。</p></td></tr></table></div></div>"#;
        let a = parse_article("yzz", page).unwrap();
        assert_eq!(a.title, "221 五开怎么配");
        assert_eq!(a.published, beijing_ms(2026, 11, 18, 13, 47, 0));
        assert_eq!(a.author.as_deref(), Some("小猪"));
        assert_eq!(a.text, "无底洞夺命咒固伤实测 1200。");
    }

    #[test]
    fn parses_17173_list_and_article() {
        let list = r#"<a href="//news.17173.com/content/11182026/145145002.shtml">《梦幻西游》力女儿的武器</a>
            <a href="//news.17173.com/content/11182026/145145002.shtml">《梦幻西游》力女儿的武器</a>
            <a href="http://xyq.17173.com/content/08072023/133511553.shtml">155 级五开</a>
            <a href="http://news.17173.com/z/fgo/">FGO</a>"#;
        let e = parse_list("17173", "https://xyq.17173.com/", list);
        assert_eq!(e.len(), 2);
        assert_eq!(
            e[0].url,
            "https://news.17173.com/content/11182026/145145002.shtml"
        );
        assert_eq!(e[0].published, beijing_ms(2026, 11, 18, 0, 0, 0));
        assert_eq!(
            e[1].url,
            "https://xyq.17173.com/content/08072023/133511553.shtml"
        );

        let page = r#"<article id="article"><h1 class="article-title">《梦幻西游》力女儿的武器</h1>
            <div class="article-info"><span class="article-author">梦幻西游</span><span class="article-time">2026-11-18 14:51:45</span></div>
            <div class="article-summary"><b>导语</b><div class="article-summary-con">导语内容</div></div>
            <div class="article-content"><p>第一段</p><h2>小标题</h2><p>第二段</p></div></article>"#;
        let a = parse_article("17173", page).unwrap();
        assert_eq!(a.published, beijing_ms(2026, 11, 18, 14, 51, 45));
        assert_eq!(a.author.as_deref(), Some("梦幻西游"));
        assert_eq!(a.summary.as_deref(), Some("导语内容"));
        assert_eq!(a.text, "第一段\n小标题\n第二段");
    }

    #[test]
    fn parses_233_list_and_article() {
        let list = r#"<a href="https://www.233leyuan.com/post-detail/2123479172233195520"><div>正文预览</div></a>
            <a href="/post-detail/2123479165311049728"></a><a href="/circle/7dc2f23f5d364f2a886b5805761286fb">梦幻西游</a>"#;
        let e = parse_list(
            "233",
            "https://www.233leyuan.com/circle/7dc2f23f5d364f2a886b5805761286fb",
            list,
        );
        assert_eq!(e.len(), 2);
        assert_eq!(
            e[1].url,
            "https://www.233leyuan.com/post-detail/2123479165311049728"
        );

        let page = r#"<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>
            <script type="application/ld+json">{"@context":"https://schema.org","@type":"DiscussionForumPosting",
              "headline":"地府固伤心得 - 梦幻西游 - 233乐园","text":"帖子摘要","datePublished":"2026-11-19T18:11:00.000Z",
              "author":{"@type":"Person","name":"玩家甲"},"comment":[{"text":"a"},{"text":"b"}]}</script>
            <h1 class="text-[24px]">地府固伤心得</h1><p class="text-[16px]">帖子摘要</p><p>阎罗令固伤 980。</p>
            <h2>推荐</h2><p>别的帖子</p>"#;
        let a = parse_article("233", page).unwrap();
        assert_eq!(a.title, "地府固伤心得");
        assert_eq!(a.published, parse_iso("2026-11-20T02:11:00+08:00"));
        assert_eq!(a.author.as_deref(), Some("玩家甲"));
        assert_eq!(a.comments, Some(2));
        assert_eq!(a.text, "帖子摘要\n阎罗令固伤 980。");
    }

    #[test]
    fn missing_title_means_unparsed() {
        assert!(parse_article("official", "<div class=\"artText\">正文</div>").is_none());
        assert!(parse_article("unknown", "<h1>x</h1>").is_none());
    }

    #[test]
    fn canonical_ignores_scheme_query_and_fragment() {
        assert_eq!(
            canonical("https://xyq.163.com/org_bg/20261029/1.html?from=x#top"),
            canonical("http://xyq.163.com/org_bg/20261029/1.html")
        );
    }
}

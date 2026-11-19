//! 主题匹配、价值分、要点句和查重。全部是规则计算，不调用 AI。
//!
//! 价值分 = 主题相关度 + 质量分。质量分与主题无关，抓取时根据全文算好存下：
//! 来源可信度 + 干货信号（实测、公式、带单位的数字）− 扣分（礼包、八卦、水文套话）。

use super::sources::{Article, Entry, Source};
use super::text::truncate;
use super::{Item, Settings, Topic};
use regex::Regex;
use std::collections::BTreeMap;
use std::sync::LazyLock;

const SIGNALS: &[&str] = &[
    "实测",
    "亲测",
    "测试结果",
    "公式",
    "计算",
    "对比",
    "数据",
    "截图",
    "统计",
    "样本",
    "木桩",
];
/// 只认明确的实测说法；维护公告里的“测试服”不算
const TESTED: &[&str] = &["实测", "亲测", "测试结果"];
const TITLE_NOISE: &[&str] = &[
    "礼包",
    "兑换码",
    "激活码",
    "抽奖",
    "福利",
    "直播",
    "主播",
    "退役",
    "八卦",
    "出货",
    "开服",
    "公示",
    "名单",
    "报名",
];
const FILLER: &[&str] = &[
    "小编",
    "下面就给大家",
    "下面就让我们",
    "以上就是",
    "希望对大家",
    "相信大家",
    "那么下面",
    "感兴趣的玩家",
];
const CHANGE_WORDS: &[&str] = &["调整", "改动", "平衡", "加强", "削弱"];

/// 带单位的数字，例如“固伤 1200”“+20 点”“10%”“3 回合”
static NUMBER_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\d+(?:\.\d+)?\s*(?:点|级|%|％|万|伤害|固伤|速度|修|回合|次)|(?:固伤|伤害|速度|敏捷|修炼)\s*\d+").unwrap()
});

pub const SUMMARY_CHARS: usize = 150;
const POINT_CHARS: usize = 120;
const MAX_POINTS: usize = 4;

/// 统计关键词出现次数，英文不区分大小写。
/// 以数字开头或结尾的关键词要求两侧不是数字，后面也不能紧跟“联、届、期、号”，
/// 避免 221 匹配到 2210、第 221 届、221 联。
pub fn count_keyword(text: &str, keyword: &str) -> u32 {
    let kw = keyword.trim().to_ascii_lowercase();
    if kw.is_empty() {
        return 0;
    }
    let text = text.to_ascii_lowercase();
    let digit_start = kw.starts_with(|c: char| c.is_ascii_digit());
    let digit_end = kw.ends_with(|c: char| c.is_ascii_digit());
    let mut n = 0;
    for (i, _) in text.match_indices(&kw) {
        if digit_start
            && text[..i]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_digit() || c == '.')
        {
            continue;
        }
        if digit_end
            && text[i + kw.len()..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_digit() || c == '.' || "联届期号".contains(c))
        {
            continue;
        }
        n += 1;
    }
    n
}

fn distinct_hits(text: &str, words: &[&str]) -> usize {
    words.iter().filter(|w| text.contains(*w)).count()
}

/// 与主题无关的质量分和标签
fn quality(source: &Source, title: &str, text: &str, comments: Option<u32>) -> (f64, Vec<String>) {
    let signals = distinct_hits(text, SIGNALS);
    let numbers = NUMBER_RE.find_iter(text).count();
    let noise = distinct_hits(title, TITLE_NOISE);
    let filler = distinct_hits(text, FILLER);
    let score = source.trust + signals.min(4) as f64 * 0.5 + (numbers as f64 / 3.0).min(3.0)
        - (noise as f64 * 2.0).min(4.0)
        - filler.min(3) as f64
        + comments.map_or(0.0, |c| c.min(10) as f64 * 0.2);

    let mut tags = Vec::new();
    if source.key == "official" {
        tags.push("官方".to_string());
    }
    if CHANGE_WORDS.iter().any(|w| title.contains(w)) {
        tags.push("版本改动".to_string());
    }
    if distinct_hits(text, TESTED) > 0 && numbers >= 3 {
        tags.push("实测".to_string());
    }
    if text.contains("公式") {
        tags.push("公式".to_string());
    }
    if filler >= 2 {
        tags.push("疑似水文".to_string());
    }
    (score, tags)
}

/// 挑出包含关键词的句子作为要点：优先带数字和实测信号的，按原文顺序排列
fn pick_points(text: &str, keywords: &[&str]) -> Vec<String> {
    let mut candidates: Vec<(usize, f64, String)> = text
        .split(['。', '！', '？', '!', '?', '；', ';', '\n'])
        .map(str::trim)
        .filter(|s| (8..=300).contains(&s.chars().count()))
        .enumerate()
        .filter_map(|(i, s)| {
            let kw: u32 = keywords.iter().map(|k| count_keyword(s, k)).sum();
            if kw == 0 {
                return None;
            }
            let rank = kw.min(3) as f64 * 2.0
                + if NUMBER_RE.is_match(s) { 3.0 } else { 0.0 }
                + distinct_hits(s, SIGNALS) as f64;
            Some((i, rank, truncate(s, POINT_CHARS)))
        })
        .collect();
    candidates.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    candidates.truncate(MAX_POINTS);
    candidates.sort_by_key(|c| c.0);
    candidates.dedup_by(|a, b| a.2 == b.2);
    candidates.into_iter().map(|c| c.2).collect()
}

fn fnv1a(chars: &[char]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    let mut buf = [0u8; 4];
    for c in chars {
        for b in c.encode_utf8(&mut buf).bytes() {
            h ^= b as u64;
            h = h.wrapping_mul(0x0100_0000_01b3);
        }
    }
    h
}

/// 正文的 SimHash（按 3 字滑窗），用来识别不同网站间的转载。正文太短时返回 0，不参与比较。
pub fn simhash(text: &str) -> u64 {
    let chars: Vec<char> = text
        .chars()
        .filter(|c| c.is_alphanumeric())
        .take(5000)
        .collect();
    if chars.len() < 100 {
        return 0;
    }
    let mut weights = [0i32; 64];
    for w in chars.windows(3) {
        let h = fnv1a(w);
        for (bit, weight) in weights.iter_mut().enumerate() {
            *weight += if (h >> bit) & 1 == 1 { 1 } else { -1 };
        }
    }
    weights
        .iter()
        .enumerate()
        .filter(|(_, w)| **w > 0)
        .fold(0u64, |acc, (bit, _)| acc | (1 << bit))
}

/// 比较标题用：去掉“《梦幻西游》”“梦幻西游”和开头的“[时间服]”“【正式服】”这类标签，再去掉标点空白。
/// 各站转载时常加减这些前缀。
pub fn title_key(title: &str) -> String {
    let mut t = title.trim();
    loop {
        let before = t;
        t = t.strip_prefix("《梦幻西游》").unwrap_or(t);
        t = t.strip_prefix("梦幻西游").unwrap_or(t).trim_start();
        for (open, close) in [('[', ']'), ('【', '】')] {
            if let Some(rest) = t.strip_prefix(open) {
                if let Some(end) = rest.find(close).filter(|&i| rest[..i].chars().count() <= 6) {
                    t = rest[end + close.len_utf8()..].trim_start();
                }
            }
        }
        if t == before {
            break;
        }
    }
    t.chars()
        .filter(|c| c.is_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// 两条是否同一篇文章（转载）：标题去掉前缀后相同；或正文 SimHash 只差 3 位以内；
/// 或来自不同网站、只差 10 位以内且发布时间相隔不到 2 天。
/// 按真实数据校准：转载之间差 2～9 位，而模板化的公告（维护公告、挑战赛公示）之间也只差 6～10 位；
/// 这类公告通常相隔一周，同一天发的也都出自同一网站，所以较宽的阈值要求跨网站且发布时间接近。
pub fn is_duplicate(a: &Item, b: &Item) -> bool {
    let (ta, tb) = (title_key(&a.title), title_key(&b.title));
    if ta.chars().count() >= 8 && ta == tb {
        return true;
    }
    let parse = |s: &str| u64::from_str_radix(s, 16).unwrap_or(0);
    let (ha, hb) = (parse(&a.simhash), parse(&b.simhash));
    if ha == 0 || hb == 0 {
        return false;
    }
    let distance = (ha ^ hb).count_ones();
    let same_days = matches!((a.published, b.published), (Some(x), Some(y)) if (x - y).abs() <= 2 * super::DAY_MS);
    distance <= 3 || (distance <= 10 && same_days && a.source != b.source)
}

fn enabled_keywords(settings: &Settings) -> Vec<&str> {
    let mut out: Vec<&str> = Vec::new();
    for t in settings.topics.iter().filter(|t| t.enabled) {
        for k in &t.keywords {
            let k = k.trim();
            if !k.is_empty() && !out.contains(&k) {
                out.push(k);
            }
        }
    }
    out
}

/// 根据文章页（解析失败时用列表页信息）生成条目
pub fn build_item(
    settings: &Settings,
    source: &Source,
    entry: &Entry,
    article: Option<&Article>,
    now: i64,
) -> Item {
    let title = article
        .map_or(entry.title.as_str(), |a| a.title.as_str())
        .trim();
    let title = title
        .strip_prefix("《梦幻西游》")
        .unwrap_or(title)
        .trim()
        .to_string();
    let text = article.map_or("", |a| a.text.as_str());
    let summary_src = article
        .and_then(|a| a.summary.clone())
        .or_else(|| entry.summary.clone())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| text.to_string());
    let keywords = enabled_keywords(settings);
    let hits: BTreeMap<String, u32> = keywords
        .iter()
        .map(|k| (k.to_string(), count_keyword(text, k)))
        .filter(|(_, n)| *n > 0)
        .collect();
    let (quality, tags) = quality(source, &title, text, article.and_then(|a| a.comments));
    let mut item = Item {
        id: super::sources::canonical(&entry.url),
        source: source.key.to_string(),
        url: entry.url.clone(),
        title,
        author: article.and_then(|a| a.author.clone()),
        published: article.and_then(|a| a.published).or(entry.published),
        fetched: now,
        summary: truncate(&summary_src.replace('\n', " "), SUMMARY_CHARS),
        points: pick_points(text, &keywords),
        hits,
        quality,
        tags,
        simhash: format!("{:016x}", simhash(text)),
        ..Default::default()
    };
    refresh(&mut item, settings);
    item
}

/// 主题相关度：标题命中加 3 分，正文每次命中加 0.5 分（最多 3 分）
fn relevance(item: &Item, topic: &Topic) -> Option<f64> {
    let local = format!("{}\n{}", item.summary, item.points.join("\n"));
    let mut title_hit = false;
    let mut body = 0u32;
    for k in topic
        .keywords
        .iter()
        .map(|k| k.trim())
        .filter(|k| !k.is_empty())
    {
        title_hit |= count_keyword(&item.title, k) > 0;
        body += item
            .hits
            .get(k)
            .copied()
            .unwrap_or(0)
            .max(count_keyword(&local, k));
    }
    (title_hit || body > 0)
        .then(|| (if title_hit { 3.0 } else { 0.0 }) + (body.min(6) as f64) * 0.5)
}

/// 按当前设置重算命中的主题、是否排除和价值分。
/// 抓取时只记录了当时主题的全文命中次数，新加的关键词只能按标题、摘要和要点匹配。
pub fn refresh(item: &mut Item, settings: &Settings) {
    let mut total = 0.0;
    item.topics.clear();
    for t in settings.topics.iter().filter(|t| t.enabled) {
        if let Some(r) = relevance(item, t) {
            item.topics.push(t.id.clone());
            total += r;
        }
    }
    item.relevance = total;
    item.score = ((item.quality + total) * 10.0).round() / 10.0;
    item.excluded = settings
        .exclude
        .iter()
        .map(|w| w.trim())
        .any(|w| !w.is_empty() && count_keyword(&item.title, w) > 0);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::sources::source;

    fn settings() -> Settings {
        Settings::default()
    }

    #[test]
    fn numeric_keywords_need_digit_boundaries() {
        assert_eq!(count_keyword("221 五开，221抓鬼", "221"), 2);
        assert_eq!(count_keyword("第2210名", "221"), 0);
        assert_eq!(count_keyword("第221届武神坛", "221"), 0);
        assert_eq!(count_keyword("221联决赛", "221"), 0);
        assert_eq!(count_keyword("1.221 倍", "221"), 0);
        assert_eq!(count_keyword("PK 场", "pk"), 1);
        assert_eq!(count_keyword("固伤固伤", "固伤"), 2);
        assert_eq!(count_keyword("任何文字", "  "), 0);
    }

    fn entry(title: &str) -> Entry {
        Entry {
            url: "https://xyq.163.com/org_bg/20261029/1_2.html".into(),
            title: title.into(),
            published: None,
            summary: None,
        }
    }

    fn article(title: &str, text: &str) -> Article {
        Article {
            title: title.into(),
            text: text.into(),
            ..Default::default()
        }
    }

    #[test]
    fn matches_topics_from_title_and_text() {
        let s = settings();
        let a = article(
            "女儿村固伤提升思路",
            "雨落寒沙实测：敏捷每加 10 点，固伤加 3 点，秒 7 时总伤 5000 伤害。\n这一段和主题无关，只是凑字数的句子。\n221 队伍里女儿村负责封印。",
        );
        let item = build_item(&s, source("official").unwrap(), &entry(""), Some(&a), 0);
        assert_eq!(
            item.topics,
            vec!["fixed-damage".to_string(), "221".to_string()]
        );
        assert!(item.tags.contains(&"实测".to_string()));
        assert_eq!(item.points.len(), 2, "只摘含关键词的句子");
        assert!(item.points[0].starts_with("雨落寒沙实测"));
        assert!(item.score > item.quality);
    }

    #[test]
    fn unrelated_article_has_no_topic() {
        let item = build_item(
            &settings(),
            source("yzz").unwrap(),
            &entry(""),
            Some(&article("单身节活动攻略", "领取奖励的方法。")),
            0,
        );
        assert!(item.topics.is_empty());
        assert!(item.points.is_empty());
    }

    #[test]
    fn noise_and_filler_lower_quality() {
        let src = source("233").unwrap();
        let good = build_item(
            &settings(),
            src,
            &entry(""),
            Some(&article(
                "地府固伤实测",
                "实测阎罗令固伤 980，修炼 +5 后 1005，对比数据如下。",
            )),
            0,
        );
        let bad = build_item(
            &settings(),
            src,
            &entry(""),
            Some(&article(
                "固伤礼包码福利",
                "小编下面就给大家介绍固伤，以上就是全部内容，希望对大家有帮助。",
            )),
            0,
        );
        assert!(good.quality > bad.quality);
        assert!(bad.tags.contains(&"疑似水文".to_string()));
    }

    #[test]
    fn exclude_words_only_check_title() {
        let mut s = settings();
        s.exclude = vec!["手游".into()];
        let hidden = build_item(
            &s,
            source("233").unwrap(),
            &entry(""),
            Some(&article("梦幻手游固伤", "固伤")),
            0,
        );
        let kept = build_item(
            &s,
            source("233").unwrap(),
            &entry(""),
            Some(&article("固伤心得", "端游和手游都有固伤")),
            0,
        );
        assert!(hidden.excluded);
        assert!(!kept.excluded);
    }

    #[test]
    fn refresh_follows_topic_changes() {
        let mut s = settings();
        let mut item = build_item(
            &s,
            source("17173").unwrap(),
            &entry(""),
            Some(&article("抓鬼效率", "221 抓鬼一小时 30 轮。")),
            0,
        );
        assert_eq!(item.topics, vec!["221".to_string()]);
        s.topics.push(Topic {
            id: "ghost".into(),
            name: "抓鬼".into(),
            keywords: vec!["抓鬼".into()],
            enabled: true,
        });
        s.topics.retain(|t| t.id != "221");
        refresh(&mut item, &s);
        assert_eq!(item.topics, vec!["ghost".to_string()], "新关键词按标题匹配");
    }

    #[test]
    fn title_key_ignores_site_prefixes() {
        let official = title_key("2026年11月17日定期维护公告：全新副本“再战天罡”！");
        assert_eq!(
            official,
            title_key("[时间服]2026年11月17日定期维护公告：全新副本“再战天罡”！")
        );
        assert_eq!(
            official,
            title_key("梦幻西游2026年11月17日定期维护公告：全新副本“再战天罡”！")
        );
        assert_eq!(
            title_key("《梦幻西游》【正式服】11月18日维护公告"),
            title_key("11月18日维护公告")
        );
        assert_eq!(
            title_key("[这不是一个服务器标签而是正文]标题"),
            "这不是一个服务器标签而是正文标题"
        );
    }

    #[test]
    fn detects_reposts() {
        let long = "梦幻西游时间服新增英雄副本再战天罡，三界侠士将应太白金星之邀重入迷阵，与天罡诸星一较高下。".repeat(4);
        let s = settings();
        let a = build_item(
            &s,
            source("official").unwrap(),
            &entry(""),
            Some(&article("2026年11月17日定期维护公告", &long)),
            0,
        );
        let b = build_item(
            &s,
            source("yzz").unwrap(),
            &entry(""),
            Some(&article(
                "梦幻西游2026年11月17日定期维护公告",
                &format!("《梦幻西游》电脑版下载。{long}"),
            )),
            0,
        );
        assert!(is_duplicate(&a, &b), "标题去掉前缀后相同");
        let c = build_item(
            &s,
            source("yzz").unwrap(),
            &entry(""),
            Some(&article("另一个标题完全不同的文章", &long)),
            0,
        );
        assert!(is_duplicate(&a, &c), "正文相同");
        let d = build_item(
            &s,
            source("yzz").unwrap(),
            &entry(""),
            Some(&article("短标题", "短正文")),
            0,
        );
        assert!(!is_duplicate(&a, &d));
    }

    #[test]
    fn looser_simhash_needs_other_site_and_close_dates() {
        let day = crate::feeds::DAY_MS;
        let with = |source: &str, title: &str, hash: &str, published: Option<i64>| Item {
            source: source.into(),
            title: title.into(),
            simhash: hash.into(),
            published,
            ..Default::default()
        };
        // 以下几对相差 8 位
        let a = with(
            "yzz",
            "叶子猪的标题写法不同",
            "000000000000010f",
            Some(10 * day),
        );
        let near = Some(10 * day + 3_600_000);
        assert!(is_duplicate(
            &a,
            &with("17173", "17173 换了个标题", "00000000000001f0", near)
        ));
        assert!(
            !is_duplicate(
                &a,
                &with(
                    "yzz",
                    "同一网站同一天的另一篇公示",
                    "00000000000001f0",
                    near
                )
            ),
            "同一网站的模板公告不算转载"
        );
        assert!(!is_duplicate(
            &a,
            &with(
                "17173",
                "下一周的同类公告",
                "00000000000001f0",
                Some(17 * day)
            )
        ));
        assert!(!is_duplicate(
            &a,
            &with("17173", "没有发布时间", "00000000000001f0", None)
        ));
        // 相差 2 位，不看网站和时间
        assert!(is_duplicate(
            &a,
            &with("yzz", "没有发布时间", "000000000000010c", None)
        ));
    }
}

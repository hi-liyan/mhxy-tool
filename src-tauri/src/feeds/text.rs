//! 网页解码、正文提取和时间解析。

use regex::Regex;
use scraper::{ElementRef, Html, Selector};
use std::sync::LazyLock;

/// 按响应头或网页 `<meta>` 声明的编码解码。GB2312 按 GBK 解码；没有声明时按 UTF-8。
pub fn decode_html(bytes: &[u8], content_type: Option<&str>) -> String {
    let declared = content_type.and_then(charset_of).or_else(|| {
        let head = String::from_utf8_lossy(&bytes[..bytes.len().min(4096)]);
        charset_of(&head)
    });
    let encoding = declared
        .and_then(|label| encoding_rs::Encoding::for_label(label.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    encoding.decode(bytes).0.into_owned()
}

fn charset_of(s: &str) -> Option<String> {
    let lower = s.to_ascii_lowercase();
    let rest = &lower[lower.find("charset=")? + "charset=".len()..];
    let rest = rest.trim_start_matches(['"', '\'']);
    let end = rest
        .find(|c: char| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        .unwrap_or(rest.len());
    (end > 0).then(|| rest[..end].to_string())
}

pub fn sel(css: &str) -> Selector {
    Selector::parse(css).expect("CSS 选择器写错了")
}

const SKIP: &[&str] = &["script", "style", "noscript", "iframe", "template"];
const BLOCK: &[&str] = &[
    "p",
    "div",
    "br",
    "li",
    "tr",
    "table",
    "section",
    "article",
    "blockquote",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
];

/// 元素的可见文字：跳过脚本和样式，块级元素之间换行，行内多余空白合并
pub fn element_text(el: ElementRef) -> String {
    let mut out = String::new();
    walk(el, &mut out);
    normalize(&out)
}

fn walk(el: ElementRef, out: &mut String) {
    for child in el.children() {
        if let Some(t) = child.value().as_text() {
            out.push_str(t);
        } else if let Some(e) = ElementRef::wrap(child) {
            let name = e.value().name();
            if SKIP.contains(&name) {
                continue;
            }
            let block = BLOCK.contains(&name);
            if block {
                out.push('\n');
            }
            walk(e, out);
            if block {
                out.push('\n');
            }
        }
    }
}

/// 合并空白（含全角空格、不换行空格），去掉空行
pub fn normalize(s: &str) -> String {
    s.lines()
        .map(|line| {
            line.split(|c: char| c.is_whitespace() || c == '\u{3000}')
                .filter(|w| !w.is_empty())
                .collect::<Vec<_>>()
                .join(" ")
        })
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("\n")
}

/// 第一个匹配元素的文字，没有或为空时返回 None
pub fn first_text(doc: &Html, css: &str) -> Option<String> {
    doc.select(&sel(css))
        .map(element_text)
        .find(|t| !t.is_empty())
}

/// 按字符截断，超出时加省略号
pub fn truncate(s: &str, max: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= max {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max).collect();
    out.push('…');
    out
}

/// 公历日期转距 1970-01-01 的天数（Howard Hinnant 的算法）
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// 带时区偏移（分钟）的时间转毫秒时间戳
fn to_ms(y: i64, m: i64, d: i64, hh: i64, mm: i64, ss: i64, offset_min: i64) -> Option<i64> {
    if !(2000..=2100).contains(&y)
        || !(1..=12).contains(&m)
        || !(1..=31).contains(&d)
        || hh > 23
        || mm > 59
        || ss > 60
    {
        return None;
    }
    let secs = days_from_civil(y, m, d) * 86_400 + hh * 3600 + mm * 60 + ss - offset_min * 60;
    Some(secs * 1000)
}

/// 北京时间转毫秒时间戳。几个来源的页面时间都是北京时间。
pub fn beijing_ms(y: i64, m: i64, d: i64, hh: i64, mm: i64, ss: i64) -> Option<i64> {
    to_ms(y, m, d, hh, mm, ss, 8 * 60)
}

static DATE_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(\d{4})\s*[-/年.]\s*(\d{1,2})\s*[-/月.]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?").unwrap()
});
static ISO_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(Z|[+-]\d{2}:?\d{2})?$",
    )
    .unwrap()
});

fn num(caps: &regex::Captures, i: usize) -> i64 {
    caps.get(i)
        .and_then(|m| m.as_str().parse().ok())
        .unwrap_or(0)
}

/// 文字中第一个“2026-11-18 14:51”“[2026-11-17]”“2026年11月18日”形式的北京时间
pub fn parse_date(s: &str) -> Option<i64> {
    let c = DATE_RE.captures(s)?;
    beijing_ms(
        num(&c, 1),
        num(&c, 2),
        num(&c, 3),
        num(&c, 4),
        num(&c, 5),
        num(&c, 6),
    )
}

/// ISO 8601 时间，例如 `2026-11-19T18:11:00.000Z`、`2026-11-20T02:11:00+08:00`；没有时区时按北京时间
pub fn parse_iso(s: &str) -> Option<i64> {
    let c = ISO_RE.captures(s.trim())?;
    let offset = match c.get(7).map(|m| m.as_str()) {
        None => 8 * 60,
        Some("Z") => 0,
        Some(z) => {
            let sign = if z.starts_with('-') { -1 } else { 1 };
            let digits: String = z.chars().filter(char::is_ascii_digit).collect();
            let h: i64 = digits[..2].parse().ok()?;
            let m: i64 = digits[2..].parse().ok()?;
            sign * (h * 60 + m)
        }
    };
    to_ms(
        num(&c, 1),
        num(&c, 2),
        num(&c, 3),
        num(&c, 4),
        num(&c, 5),
        num(&c, 6),
        offset,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_declared_charset() {
        let (gbk, _, _) = encoding_rs::GBK.encode("<meta charset=\"gb2312\"><p>固伤提升</p>");
        assert!(decode_html(&gbk, None).contains("固伤提升"));
        let (gbk, _, _) = encoding_rs::GBK.encode("<p>女儿村</p>");
        assert!(decode_html(&gbk, Some("text/html; charset=GBK")).contains("女儿村"));
        assert_eq!(
            decode_html("<p>地府</p>".as_bytes(), Some("text/html")),
            "<p>地府</p>"
        );
    }

    #[test]
    fn extracts_text_without_scripts() {
        let doc = Html::parse_fragment(
            "<div id=\"a\"><p>第一段\u{3000}\u{3000}文字</p><script>var x = 1;</script><p>第二段 <b>加粗</b></p><br>尾巴</div>",
        );
        let el = doc.select(&sel("#a")).next().unwrap();
        assert_eq!(element_text(el), "第一段 文字\n第二段 加粗\n尾巴");
    }

    #[test]
    fn parses_beijing_and_iso_times() {
        // 2026-11-18 14:51:45 北京时间 = 06:51:45 UTC
        let t = parse_date("时间：2026-11-18 14:51:45").unwrap();
        assert_eq!(t, parse_iso("2026-11-18T06:51:45Z").unwrap());
        assert_eq!(
            parse_date("[2026-11-17]"),
            beijing_ms(2026, 11, 17, 0, 0, 0)
        );
        assert_eq!(
            parse_date("2026年11月17日"),
            beijing_ms(2026, 11, 17, 0, 0, 0)
        );
        assert_eq!(
            parse_iso("2026-11-20T02:11:00+08:00"),
            parse_iso("2026-11-19T18:11:00.000Z")
        );
        // 2000-01-01 00:00 UTC
        assert_eq!(to_ms(2000, 1, 1, 0, 0, 0, 0), Some(946_684_800_000));
        assert_eq!(parse_date("没有日期"), None);
    }

    #[test]
    fn truncates_by_chars() {
        assert_eq!(truncate("梦幻西游", 10), "梦幻西游");
        assert_eq!(truncate("梦幻西游固伤", 4), "梦幻西游…");
    }
}

//! robots.txt 规则判断：优先使用点名本应用的规则组，没有时用 `User-agent: *`。
//! 同一路径命中多条规则时取最长的一条，长度相同时 Allow 优先；支持 `*` 和结尾的 `$`。

struct Group {
    agents: Vec<String>,
    rules: Vec<(bool, String)>,
}

fn parse(robots: &str) -> Vec<Group> {
    let mut groups: Vec<Group> = Vec::new();
    let mut collecting_agents = false;
    for raw in robots.lines() {
        let line = raw.split('#').next().unwrap_or("").trim();
        let Some((key, value)) = line.split_once(':') else {
            continue;
        };
        let value = value.trim();
        match key.trim().to_ascii_lowercase().as_str() {
            "user-agent" => {
                if !collecting_agents {
                    groups.push(Group {
                        agents: Vec::new(),
                        rules: Vec::new(),
                    });
                }
                if let Some(g) = groups.last_mut() {
                    g.agents.push(value.to_ascii_lowercase());
                }
                collecting_agents = true;
            }
            k @ ("allow" | "disallow") => {
                if let Some(g) = groups.last_mut() {
                    g.rules.push((k == "allow", value.to_string()));
                }
                collecting_agents = false;
            }
            _ => {}
        }
    }
    groups
}

/// 规则转成正则：`*` 匹配任意字符，结尾 `$` 表示必须匹配到路径末尾
fn matches(pattern: &str, path: &str) -> bool {
    let (body, anchored) = match pattern.strip_suffix('$') {
        Some(p) => (p, true),
        None => (pattern, false),
    };
    let mut re = String::from("^");
    for (i, part) in body.split('*').enumerate() {
        if i > 0 {
            re.push_str(".*");
        }
        re.push_str(&regex::escape(part));
    }
    if anchored {
        re.push('$');
    }
    regex::Regex::new(&re).is_ok_and(|r| r.is_match(path))
}

/// `agent` 为本应用的产品名（小写比较），`path` 为带查询串的路径
pub fn allowed(robots: &str, agent: &str, path: &str) -> bool {
    let agent = agent.to_ascii_lowercase();
    let groups = parse(robots);
    let group = groups
        .iter()
        .find(|g| {
            g.agents
                .iter()
                .any(|a| a != "*" && agent.starts_with(a.as_str()))
        })
        .or_else(|| groups.iter().find(|g| g.agents.iter().any(|a| a == "*")));
    let Some(group) = group else {
        return true;
    };
    let mut best: Option<(usize, bool)> = None;
    for (allow, pattern) in &group.rules {
        // 空的 Disallow 表示不限制
        if pattern.is_empty() || !matches(pattern, path) {
            continue;
        }
        let len = pattern.len();
        if best.is_none_or(|(l, a)| len > l || (len == l && *allow && !a)) {
            best = Some((len, *allow));
        }
    }
    best.is_none_or(|(_, allow)| allow)
}

#[cfg(test)]
mod tests {
    use super::allowed;

    const UA: &str = "mhxy-tools";

    #[test]
    fn uses_wildcard_group_and_longest_rule() {
        let robots = "User-agent: Baiduspider\nDisallow: /\n\nUser-agent: *\nDisallow: /include/\nDisallow: /test/\nAllow: /test/public/\n";
        assert!(allowed(robots, UA, "/news/"));
        assert!(!allowed(robots, UA, "/include/a.js"));
        assert!(!allowed(robots, UA, "/test/x.html"));
        assert!(allowed(robots, UA, "/test/public/x.html"));
    }

    #[test]
    fn empty_disallow_and_missing_group_allow_everything() {
        assert!(allowed(
            "User-agent: *\nDisallow:\n",
            UA,
            "/content/1.shtml"
        ));
        assert!(allowed(
            "User-agent: Googlebot\nDisallow: /\n",
            UA,
            "/anything"
        ));
        assert!(allowed("", UA, "/"));
    }

    #[test]
    fn disallow_all_blocks_everything() {
        assert!(!allowed("User-agent: *\nDisallow: /\n", UA, "/question/1"));
    }

    #[test]
    fn named_group_overrides_wildcard() {
        let robots = "User-agent: *\nDisallow: /\n\nUser-agent: mhxy-tools\nDisallow: /private/\n";
        assert!(allowed(robots, UA, "/news/"));
        assert!(!allowed(robots, UA, "/private/a"));
    }

    #[test]
    fn supports_wildcards_and_end_anchor() {
        let robots = "User-agent: *\nDisallow: /z/*/content/*/mip_*.shtml\nDisallow: /*.php$\n";
        assert!(!allowed(robots, UA, "/z/xyq/content/11182026/mip_1.shtml"));
        assert!(allowed(robots, UA, "/content/11182026/145145002.shtml"));
        assert!(!allowed(robots, UA, "/a/index.php"));
        assert!(allowed(robots, UA, "/a/index.php?x=1"));
    }

    #[test]
    fn consecutive_user_agents_share_rules() {
        let robots = "User-agent: Googlebot\nUser-agent: *\nDisallow: /webapp/\nSitemap: https://example.com/s.xml\n";
        assert!(!allowed(robots, UA, "/webapp/x"));
        assert!(allowed(robots, UA, "/article/1"));
    }
}

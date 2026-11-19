import { useCallback, useEffect, useMemo, useState } from "react";
import { useUi } from "./ui";
import { feeds, type FeedItem, type FeedSettings, type FeedView } from "../storage";
import { useFeedEvents } from "../useFeeds";
import { fmtDate, fmtDateTime, uid } from "../utils";

type Tab = "inbox" | "starred" | "all" | "settings";
type Patch = { read?: boolean; starred?: boolean; ignored?: boolean };
const PAGE = 50;

const SOURCE_DESC: Record<string, string> = {
  official: "新闻中心：版本更新、门派调整、维护公告",
  yzz: "精品攻略和焦点文章",
  "17173": "梦幻专区的最新资讯",
  "233": "梦幻西游圈的玩家帖，手游内容较多",
};

const SCORE_HINT = "价值分 = 主题相关度 + 来源可信度 + 干货信号（实测、公式、带单位的数字）− 扣分（礼包、八卦、水文套话）";

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const inInbox = (i: FeedItem) => i.topics.length > 0 && !i.excluded && !i.ignored;
const isNew = (i: FeedItem) => inInbox(i) && !i.read;

/** 标题命中 3 分，正文每提到一次 0.5 分 */
function relevanceText(r: number) {
  if (r >= 3) return "标题命中";
  if (r >= 1.5) return "正文多次提到";
  return "正文顺带提到";
}

export function CommunityFeed() {
  const { toast } = useUi();
  const [view, setView] = useState<FeedView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("inbox");
  const [topic, setTopic] = useState("all");
  const [source, setSource] = useState("all");
  const [sort, setSort] = useState<"score" | "time">("score");
  const [limit, setLimit] = useState(PAGE);
  const [fetching, setFetching] = useState(false);

  const reload = useCallback(() => {
    feeds
      .state()
      .then((v) => {
        setView(v);
        setError(null);
      })
      .catch((e) => setError(errText(e)));
  }, []);
  useEffect(() => {
    if (feeds.available) reload();
  }, [reload]);
  useFeedEvents(reload);
  useEffect(() => setLimit(PAGE), [tab, topic, source, sort]);

  const topicName = useMemo(() => new Map(view?.settings.topics.map((t) => [t.id, t.name] as const)), [view]);
  const sourceName = useMemo(() => new Map(view?.sources.map((s) => [s.key, s.name] as const)), [view]);

  const list = useMemo(() => {
    if (!view) return [];
    let xs = view.items.filter((i) => (tab === "inbox" ? inInbox(i) : tab === "starred" ? i.starred : true));
    if (topic !== "all") xs = xs.filter((i) => i.topics.includes(topic));
    if (source !== "all") xs = xs.filter((i) => i.source === source);
    const time = (i: FeedItem) => i.published ?? i.fetched;
    // 按价值排时，新内容排在前面
    return [...xs].sort((a, b) =>
      sort === "score" ? Number(isNew(b)) - Number(isNew(a)) || b.score - a.score || time(b) - time(a) : time(b) - time(a),
    );
  }, [view, tab, topic, source, sort]);

  const mark = useCallback(
    async (items: FeedItem[], patch: Patch) => {
      if (!items.length) return;
      const ids = new Set(items.map((i) => i.id));
      setView((v) => v && { ...v, items: v.items.map((i) => (ids.has(i.id) ? { ...i, ...patch } : i)) });
      try {
        await feeds.mark([...ids], patch);
      } catch (e) {
        toast(errText(e), "err");
        reload();
      }
    },
    [toast, reload],
  );

  const open = useCallback(
    async (item: FeedItem, url = item.url) => {
      try {
        await feeds.open(url);
        if (!item.read) mark([item], { read: true });
      } catch (e) {
        toast(errText(e), "err");
      }
    },
    [mark, toast],
  );

  const fetchNow = async () => {
    setFetching(true);
    try {
      const r = await feeds.fetchNow();
      const msg = r.added ? `新增 ${r.added} 篇，其中 ${r.matched} 篇命中主题` : "没有新文章";
      const failed = r.failed.length ? `；${r.failed.join("；")}` : "";
      toast(msg + failed, r.failed.length && !r.added ? "err" : "ok");
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setFetching(false);
      reload();
    }
  };

  if (!feeds.available) {
    return (
      <section className="card">
        <div className="empty">玩家心得需要在桌面应用中使用：抓取网页走桌面端的网络请求，浏览器预览里不可用。</div>
      </section>
    );
  }
  if (error) {
    return (
      <section className="card">
        <p className="loss">{error}</p>
        <button className="btn" onClick={reload}>
          重试
        </button>
      </section>
    );
  }
  if (!view) return <div className="empty">读取中…</div>;

  const busy = fetching || view.running;
  const unread = view.items.filter(isNew);
  const starred = view.items.filter((i) => i.starred).length;
  const failed = view.sources.filter((s) => s.enabled && s.status && !s.status.ok);

  return (
    <>
      <section className="card feed-head" data-tauri-drag-region="false">
        <div className="feed-status">
          <div className="feed-run">
            <b>{busy ? "正在抓取…" : view.last_run ? `上次抓取：${fmtDateTime(view.last_run)}` : "还没有抓取过"}</b>
            <span className="muted small">
              {view.settings.auto ? "应用启动后在后台静默抓取，每天一次" : "自动抓取已关闭，可在「设置」里打开"}
            </span>
          </div>
          <div className="feed-sources">
            {view.sources.map((s) => (
              <span
                key={s.key}
                className={`feed-source${!s.enabled ? " off" : s.status && !s.status.ok ? " bad" : ""}`}
                title={s.status ? `${fmtDateTime(s.status.at)}：${s.status.message}` : "还没有抓取过"}
              >
                {s.name}
                {!s.enabled ? " · 已关闭" : s.status ? (s.status.ok ? ` · 新增 ${s.status.added}` : " · 失败") : ""}
              </span>
            ))}
          </div>
          {failed.map((s) => (
            <div key={s.key} className="small loss">
              {s.name}：{s.status?.message}
            </div>
          ))}
        </div>
        <div className="actions">
          <button className="btn" disabled={!unread.length} onClick={() => mark(unread, { read: true })}>
            全部标为已读
          </button>
          <button className="btn primary" disabled={busy} onClick={fetchNow}>
            {busy ? "抓取中…" : "立即抓取"}
          </button>
        </div>
      </section>

      <div className="tabs">
        <button className={tab === "inbox" ? "active" : ""} onClick={() => setTab("inbox")}>
          心得{unread.length ? `（${unread.length} 新）` : ""}
        </button>
        <button className={tab === "starred" ? "active" : ""} onClick={() => setTab("starred")}>
          收藏{starred ? `（${starred}）` : ""}
        </button>
        <button className={tab === "all" ? "active" : ""} onClick={() => setTab("all")}>
          全部（{view.items.length}）
        </button>
        <button className={tab === "settings" ? "active" : ""} onClick={() => setTab("settings")}>
          设置
        </button>
      </div>

      {tab === "settings" ? (
        <FeedSettingsForm view={view} onSaved={setView} />
      ) : (
        <>
          <div className="feed-filters">
            <div className="seg">
              <button className={topic === "all" ? "active" : ""} onClick={() => setTopic("all")}>
                全部主题
              </button>
              {view.settings.topics
                .filter((t) => t.enabled)
                .map((t) => (
                  <button key={t.id} className={topic === t.id ? "active" : ""} onClick={() => setTopic(t.id)}>
                    {t.name}
                  </button>
                ))}
            </div>
            <select value={source} onChange={(e) => setSource(e.target.value)}>
              <option value="all">全部来源</option>
              {view.sources.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
            <div className="seg">
              <button className={sort === "score" ? "active" : ""} onClick={() => setSort("score")} title={SCORE_HINT}>
                按价值
              </button>
              <button className={sort === "time" ? "active" : ""} onClick={() => setSort("time")}>
                按时间
              </button>
            </div>
          </div>

          {list.length === 0 ? (
            <section className="card">
              <div className="empty">{emptyText(tab, view)}</div>
            </section>
          ) : (
            <div className="feed-list" data-tauri-drag-region="false">
              {list.slice(0, limit).map((item) => (
                <FeedCard key={item.id} item={item} topicName={topicName} sourceName={sourceName} onOpen={open} onMark={mark} />
              ))}
              {list.length > limit && (
                <button className="btn feed-more" onClick={() => setLimit((n) => n + PAGE)}>
                  再显示 {Math.min(PAGE, list.length - limit)} 篇（共 {list.length} 篇）
                </button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

function emptyText(tab: Tab, view: FeedView) {
  if (tab === "starred") return "还没有收藏。收藏的文章会一直保留，不受 90 天清理影响。";
  if (!view.last_run) return "还没有抓取过。应用启动约半分钟后会在后台自动抓取，也可以点「立即抓取」。";
  if (tab === "inbox") return "最近还没有命中主题的文章。可以在「设置」里增加主题或关键词，或到「全部」里看看抓到了什么。";
  return "没有符合条件的文章";
}

function FeedCard({
  item,
  topicName,
  sourceName,
  onOpen,
  onMark,
}: {
  item: FeedItem;
  topicName: Map<string, string>;
  sourceName: Map<string, string>;
  onOpen: (item: FeedItem, url?: string) => void;
  onMark: (items: FeedItem[], patch: Patch) => void;
}) {
  const fresh = isNew(item);
  return (
    <article className={`feed-item${fresh ? " new" : ""}${item.ignored ? " ignored" : ""}`}>
      <div className="feed-meta">
        {fresh && <span className="feed-new">新</span>}
        <span>{sourceName.get(item.source) ?? item.source}</span>
        <span>{fmtDate(item.published ?? item.fetched)}</span>
        {item.author && <span>{item.author}</span>}
        {item.topics.map((t) => (
          <span key={t} className="tool-tag">
            {topicName.get(t) ?? t}
          </span>
        ))}
        {item.topics.length > 0 && <span>{relevanceText(item.relevance)}</span>}
        {item.tags.map((t) => (
          <span key={t} className={`feed-tag${t === "疑似水文" ? " warn" : ""}`}>
            {t}
          </span>
        ))}
        {item.excluded && <span className="feed-tag warn">标题含排除词</span>}
        {item.ignored && <span className="feed-tag">已忽略</span>}
        <span className="feed-score" title={SCORE_HINT}>
          {item.score.toFixed(1)} 分
        </span>
      </div>
      <button className="feed-title" onClick={() => onOpen(item)}>
        {item.title}
      </button>
      {item.summary && <p className="feed-summary">{item.summary}</p>}
      {item.points.length > 0 && (
        <ul className="feed-points">
          {item.points.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      <div className="feed-actions">
        <button className="btn ghost" onClick={() => onMark([item], { starred: !item.starred })}>
          {item.starred ? "★ 已收藏" : "☆ 收藏"}
        </button>
        {fresh && (
          <button className="btn ghost" onClick={() => onMark([item], { read: true })}>
            标为已读
          </button>
        )}
        <button className="btn ghost" onClick={() => onMark([item], { ignored: !item.ignored })}>
          {item.ignored ? "取消忽略" : "忽略"}
        </button>
        <button className="btn ghost" onClick={() => onOpen(item)}>
          打开原文 ↗
        </button>
        {item.mirrors.length > 0 && (
          <span className="muted small">
            转载：
            {item.mirrors.map((m) => (
              <button key={m.url} className="icon-btn" onClick={() => onOpen(item, m.url)}>
                {sourceName.get(m.source) ?? m.source}
              </button>
            ))}
          </span>
        )}
      </div>
    </article>
  );
}

interface Draft {
  auto: boolean;
  sources: Record<string, boolean>;
  topics: { id: string; name: string; keywords: string; enabled: boolean }[];
  exclude: string;
}

const toDraft = (s: FeedSettings): Draft => ({
  auto: s.auto,
  sources: { ...s.sources },
  topics: s.topics.map((t) => ({ ...t, keywords: t.keywords.join("，") })),
  exclude: s.exclude.join("，"),
});

const splitWords = (s: string) =>
  s
    .split(/[,，、;；\s]+/)
    .map((w) => w.trim())
    .filter(Boolean);

function FeedSettingsForm({ view, onSaved }: { view: FeedView; onSaved: (v: FeedView) => void }) {
  const { toast } = useUi();
  const [draft, setDraft] = useState(() => toDraft(view.settings));
  const [saving, setSaving] = useState(false);

  const setTopic = (i: number, patch: Partial<Draft["topics"][number]>) =>
    setDraft((d) => ({ ...d, topics: d.topics.map((t, j) => (j === i ? { ...t, ...patch } : t)) }));

  const save = async () => {
    if (draft.topics.some((t) => !t.name.trim())) {
      toast("主题名不能为空", "err");
      return;
    }
    setSaving(true);
    try {
      const v = await feeds.saveSettings({
        auto: draft.auto,
        sources: draft.sources,
        topics: draft.topics.map((t) => ({ id: t.id, name: t.name.trim(), keywords: splitWords(t.keywords), enabled: t.enabled })),
        exclude: splitWords(draft.exclude),
      });
      onSaved(v);
      setDraft(toDraft(v.settings));
      toast("设置已保存，已有文章已按新设置重新匹配");
    } catch (e) {
      toast(errText(e), "err");
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card feed-settings" data-tauri-drag-region="false">
      <h2>采集主题</h2>
      <p className="muted small">
        文章标题或正文出现任一关键词，就归到这个主题，进入「心得」。关键词用逗号或空格分隔；纯数字关键词（例如 221）只匹配单独出现的数字，不会匹配
        2210、第 221 届、221 联。
      </p>
      <div className="feed-topics">
        {draft.topics.map((t, i) => (
          <div key={t.id} className="feed-topic">
            <label className="switch">
              <input type="checkbox" checked={t.enabled} onChange={(e) => setTopic(i, { enabled: e.target.checked })} />
              启用
            </label>
            <input value={t.name} maxLength={20} placeholder="主题名" onChange={(e) => setTopic(i, { name: e.target.value })} />
            <input value={t.keywords} placeholder="关键词，例如：抓鬼，鬼王" onChange={(e) => setTopic(i, { keywords: e.target.value })} />
            <button className="btn danger ghost" onClick={() => setDraft((d) => ({ ...d, topics: d.topics.filter((_, j) => j !== i) }))}>
              删除
            </button>
          </div>
        ))}
      </div>
      <button
        className="btn"
        onClick={() => setDraft((d) => ({ ...d, topics: [...d.topics, { id: `topic-${uid()}`, name: "", keywords: "", enabled: true }] }))}
      >
        ＋ 新增主题
      </button>
      <p className="muted small">
        保存后会按新设置重新匹配已抓到的文章：原有关键词按全文匹配，新加的关键词只能按标题、摘要和要点匹配（不保存全文）；之后抓到的文章都按全文匹配。
      </p>

      <h2>排除词</h2>
      <p className="muted small">标题含这些词的文章不进「心得」，在「全部」里仍能看到。233乐园的梦幻圈里手游内容较多，默认排除「手游」。</p>
      <input value={draft.exclude} placeholder="例如：手游，礼包码" onChange={(e) => setDraft((d) => ({ ...d, exclude: e.target.value }))} />

      <h2>来源</h2>
      <div className="feed-source-list">
        {view.sources.map((s) => (
          <label key={s.key} className="feed-check">
            <input
              type="checkbox"
              checked={draft.sources[s.key] ?? true}
              onChange={(e) => setDraft((d) => ({ ...d, sources: { ...d.sources, [s.key]: e.target.checked } }))}
            />
            <b>{s.name}</b>
            <span className="muted small">{SOURCE_DESC[s.key]}</span>
          </label>
        ))}
      </div>

      <h2>自动抓取</h2>
      <label className="feed-check">
        <input type="checkbox" checked={draft.auto} onChange={(e) => setDraft((d) => ({ ...d, auto: e.target.checked }))} />
        应用启动后在后台静默抓取，每天一次（距上次成功抓取满 20 小时）；有新文章时，侧边栏「工具箱」上会显示数量
      </label>
      <p className="muted small">
        只抓各网站 robots.txt 允许的公开页面，不登录、不带 Cookie；同一网站的请求间隔 2 秒，每个来源每次最多打开 20 篇。只保存标题、摘要、要点句和链接，不保存全文；未收藏的文章保留
        90 天。数据存在数据目录的 community.json，与记账数据分开，不进备份。
      </p>

      <div className="actions">
        <button className="btn primary" disabled={saving} onClick={save}>
          {saving ? "保存中…" : "保存设置"}
        </button>
        <button className="btn" disabled={saving} onClick={() => setDraft(toDraft(view.settings))}>
          撤销修改
        </button>
      </div>
    </section>
  );
}

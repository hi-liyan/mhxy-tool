import { useEffect, useState, type ReactNode } from "react";

/**
 * 固伤提升攻略：221（1 无底洞 + 2 女儿村 + 2 地府）常用的三个门派。
 * 内容是多篇攻略与玩家实测交叉比较后的整理，每条结论都标出来源；数值会随版本和物价变化。
 */

const SOURCES = {
  yzz2202: { short: "叶子猪 2022-02", title: "从建号到属性提升，分享五开固伤门派的全面玩法技巧", url: "http://xyq.yzz.cn/focus/202202/1661230.shtml" },
  yzz2307: { short: "叶子猪 2023-07", title: "固伤投入低效率高，但所受伤害也高", url: "http://m.yzz.cn/xyq/focus/202307/1700688.shtml" },
  yzz2401: { short: "叶子猪 2024-01", title: "搞清固伤伤害机制，总结提升输出的方案", url: "http://xyq.yzz.cn/focus/202401/1712560.shtml" },
  yzz2409: { short: "叶子猪 2024-09 实测", title: "不花一分钱就能提升50点固伤？固伤五开快来看！", url: "http://xyq.yzz.cn/focus/202409/1730217.shtml" },
  yzz2504m: { short: "叶子猪 2025-04", title: "魔族门派任务经脉点法推荐，固伤效率更进一步！（腾讯新闻转载）", url: "https://news.qq.com/rain/a/20250429A089OQ00" },
  yzz2504r: { short: "叶子猪 2025-04", title: "人族门派任务经脉点法推荐，女儿村固伤物理都表现出色", url: "http://m.yzz.cn/xyq/skill/202504/1743874.shtml" },
  yzz2505: { short: "叶子猪 2025-05", title: "四月调整女儿村经脉点法推荐", url: "http://m.yzz.cn/xyq/skill/202505/1745445.shtml" },
  yzzRune: { short: "叶子猪符石表（2018）", title: "梦幻西游符石组合表大全", url: "http://xyq.yzz.cn/focus/201810/1520344.shtml" },
  k2501: { short: "17173 2025-01", title: "提升固伤输出的方式，很多人都忽略了这一点", url: "https://xyq.17173.com/content/01132025/010807851.shtml" },
  k2502: { short: "17173 2025-02", title: "固伤提升攻略，学会这个套路", url: "https://xyq.17173.com/content/02052025/160622377.shtml" },
  k2509: { short: "17173 2025-09", title: "固伤的最新搭配细节来了（畅玩服）", url: "https://xyq.17173.com/content/09232025/140955140.shtml" },
  k2510: { short: "17173 2025-10", title: "2025年10月门派调整之阴曹地府经脉推荐", url: "https://news.17173.com/content/10292025/111220349.shtml" },
  qq2110: { short: "腾讯新闻 2021-10", title: "修炼以及属性相同的情况下，为什么固伤输出比法系低？", url: "https://news.qq.com/rain/a/20211026A02GV700" },
  qq2412: { short: "腾讯新闻 2024-12", title: "固伤门派伤害敏捷转换教学", url: "https://news.qq.com/rain/a/20241203A02YSL00" },
  qq2510: { short: "腾讯新闻 2025-10", title: "把固伤的配置摸索明白之后，发现比法系还费钱！", url: "https://news.qq.com/rain/a/20251022A01WNB00" },
  ne221: { short: "网易号（约 2023）", title: "门派大改后，固伤五开221依然能玩，用收益数据说话", url: "https://m.163.com/dy/article/I7914EF905461D7I.html" },
  y233Formula: { short: "233乐园 2026-07", title: "固定伤害全门派公式解析", url: "https://www.233leyuan.com/post-detail/2075777149352157184" },
  y233Team: { short: "233乐园 2026-07", title: "五开组合推荐：129级221固伤怎么玩？", url: "https://www.233leyuan.com/post-detail/2074003129887334400" },
  y233Nr129: { short: "233乐园 2026-05", title: "129女儿村副秒伤害低怎么办", url: "https://www.233leyuan.com/post-detail/2057378447898877952" },
  y233Nr109: { short: "233乐园 2026-06", title: "109女儿村固伤怎么提升", url: "https://www.233leyuan.com/post-detail/2066820187033161728" },
  y233NrFormula: { short: "233乐园 2026-06", title: "女儿村雨落寒沙伤害公式详解", url: "https://www.233leyuan.com/post-detail/2062424280641495040" },
  y233Conv: { short: "233乐园 2026-06", title: "武器伤害怎么换算固伤？固伤系数详解", url: "https://www.233leyuan.com/post-detail/2066471074169483264" },
  y233Rune: { short: "233乐园 2026-07", title: "销魂蚀骨符石最多叠加两次", url: "https://www.233leyuan.com/post-detail/2072244209506615296" },
  y233Wdd: { short: "233乐园", title: "无底洞夺命咒能秒几个", url: "https://www.233leyuan.com/post-detail/2066471033297113088" },
  dm2509: { short: "3DM 2025-09", title: "梦幻西游固定伤害计算公式（作者 Q独行侠Q）", url: "https://ol.3dmgame.com/gl/284768.html" },
  dvgDf: { short: "DVG", title: "梦幻西游地府秒7技能要求解析", url: "https://www.dvg.cn/news/71623.html" },
  off2604: { short: "官网 2026-04", title: "2026年4月 门派调整", url: "https://xyq.163.com/org_bg/20260416/15743_1296385.html" },
  off2005: { short: "官网 2020-05", title: "门派调整：无底洞门派技能及经脉修改介绍", url: "https://xyq.163.com/hot/20200506/12783_879195.html" },
} as const;
type SourceId = keyof typeof SOURCES;

function Ref({ ids }: { ids: SourceId[] }) {
  return (
    <span className="guide-ref" title={ids.map((id) => SOURCES[id].title).join("\n")}>
      〔{ids.map((id) => SOURCES[id].short).join("；")}〕
    </span>
  );
}

/** 一条结论 + 来源 */
function Li({ children, src }: { children: ReactNode; src?: SourceId[] }) {
  return (
    <li>
      {children}
      {src && <Ref ids={src} />}
    </li>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card guide" data-tauri-drag-region="false">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function Tier({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <div className="guide-tier">
      <h3>
        {title}
        {note && <span className="muted small">{note}</span>}
      </h3>
      <ul>{children}</ul>
    </div>
  );
}

function Overview() {
  return (
    <>
      <Section title="先记住四件事">
        <ol className="guide-key">
          <Li src={["qq2510", "qq2412", "ne221"]}>
            <b>固伤按“血线”配装，超过血线的伤害是浪费。</b>129 级抓鬼，大鬼的小怪约 4800 血：4 个号副秒 1200 就能一起秒飞，1600 可以 3
            下清掉。在 221 里，副秒 1350 和 1600 的差别往往只是多一只宝宝补刀，20 对鬼下来约差 15～60 秒。
          </Li>
          <Li src={["qq2510", "qq2110"]}>
            <b>固伤下限高、上限低。</b>配到“双固伤灵饰 + 4 级锐不可当 + 大敏捷套 + 高敏衣服和武器 + 坐骑机缘吃满”之后，再提升就要三固伤灵饰、高段星辉石，价格陡升，伤害却涨得很少。
          </Li>
          <Li src={["y233Formula", "qq2110"]}>
            <b>修炼差对每个目标既乘又加：</b>每差 1 级伤害 ±2%，再 ±5 点。除了野外烧双，几乎所有任务怪都带法抗修炼，法修是最不该欠的一项。
          </Li>
          <Li src={["y233Conv", "dm2509", "yzz2505", "k2510", "off2604"]}>
            <b>经脉不对，装备白买。</b>女儿村【暗伤】、地府【阎罗】让武器伤害（含头盔、灵饰、符石上的伤害）按 18%、15% 转为固伤，没点时高伤武器和太阳石几乎不加副秒；无底洞没点【魂守】，夺命咒的基础伤害直接少一半。
          </Li>
        </ol>
      </Section>

      <Section title="提升顺序（三个门派通用）">
        <Tier title="第一档：几乎不花钱，卖号时还能折回来" note="先把这一档做满再花钱">
          <Li src={["yzz2202"]}>法术修炼、师门技能点到当前上限；女儿村把暗器技巧点高。法修、技能、暗器在卖号时能折算 90% 以上进号价。</Li>
          <Li src={["yzz2504m", "yzz2505", "k2510"]}>选对流派和经脉（见各门派页），重点检查【魂守】【暗伤】【阎罗】。</Li>
          <Li src={["k2502"]}>全敏加点、潜能果、机缘吃满；坐骑成长吃满——初成长 1.315 没有额外成长时加约 50 敏，额外成长 1 时加约 80 敏。</Li>
          <Li src={["yzz2409"]}>法宝带试剑石、落星飞鸿（对三个门派的群秒都有效）；北冥巨鳞对固伤无效。</Li>
          <Li src={["yzz2401", "y233Formula"]}>
            阵法：女儿村天阵 ×1.25、雷阵 ×1.14，另外两个门派天阵 ×1.15、雷阵 ×1.2。221 两种阵各有取舍，可以在固伤计算器里分别算出五个号的总伤再定。
          </Li>
        </Tier>
        <Tier title="第二档：性价比最高的花钱项">
          <Li src={["yzz2202", "y233Rune"]}>衣服、鞋子双四孔，镶本门派符石组合（同一组合最多 2 件生效）。</Li>
          <Li src={["yzz2202", "k2502"]}>
            70～80 级敏捷套（画魂、巴蛇、雾中仙、猫灵、机关鸟、傀儡妖）；预算不够可用幽灵、吸血鬼套，少约 5 点敏捷但便宜不少。
          </Li>
          <Li src={["yzz2202", "k2502"]}>
            前排 100 级“固伤 + 伤害”灵饰，2 级锐不可当（+12 固伤）升 4 级（+24）。叶子猪按 2022 年物价算过：4 级锐不可当每点固伤的边际成本约 144 万，远低于双固伤灵饰。
          </Li>
          <Li src={["yzz2202"]}>敏捷固伤符石（当时约 125 万一颗，约 +2.5 固伤）。只在一回合结束的任务里开符石，可以大幅减少损耗。</Li>
          <Li src={["ne221", "qq2412"]}>
            武器：预算有限时，505 初伤无敏的武器比 440 初伤 25 敏的更划算。地府副秒约 1 敏 ≈ 2.35 伤害，可以用它比较两把武器。
          </Li>
        </Tier>
        <Tier title="第三档：贵、边际收益低，放到最后">
          <Li src={["yzz2202", "qq2510"]}>三固伤灵饰、5 段以上双固伤灵饰。</Li>
          <Li src={["y233Nr109"]}>高段星辉石：109 女儿村 8 段星辉石约 2600 元，只加约 12 点固伤。</Li>
          <Li src={["k2501"]}>女儿村的高段太阳石：8 段太阳约 +10 副秒，头盔打月亮石更稳。地府和无底洞的情况不同，见各门派页。</Li>
        </Tier>
      </Section>

      <Section title="三个门派对照（对 NPC）">
        <table className="table guide-table">
          <thead>
            <tr>
              <th>门派·技能</th>
              <th>敏捷系数</th>
              <th>装备伤害转固伤</th>
              <th>秒几</th>
              <th>门派符石组合</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>无底洞·夺命咒</td>
              <td>×0.7</td>
              <td>×0.125，点【魂守】后翻倍</td>
              <td>1 + 鬼蛊灵蕴 ÷ 35，140 级秒 5</td>
              <td>销魂噬骨：人物等级 ×25% / 33% / 50%</td>
            </tr>
            <tr>
              <td>女儿村·雨落寒沙</td>
              <td>×0.5（暗器 ×0.3）</td>
              <td>×0.18，需【暗伤】</td>
              <td>未查到可靠规则</td>
              <td>凤舞九天：人物等级 ×20% / 30% / 40%</td>
            </tr>
            <tr>
              <td>地府·阎罗令</td>
              <td>×0.35</td>
              <td>×0.15，需【阎罗】，副秒不分灵</td>
              <td>每 25 级多 1 个，幽冥术 150 级秒 7</td>
              <td>索命无常：只找到 2018 年旧表数值</td>
            </tr>
          </tbody>
        </table>
        <p className="muted small">
          来源：<Ref ids={["y233Formula", "y233Conv", "y233Wdd", "dvgDf", "off2005", "y233NrFormula", "yzzRune"]} />
        </p>
      </Section>
    </>
  );
}

function Wudidong() {
  return (
    <>
      <Section title="定位">
        <ul>
          <Li src={["y233Team", "yzz2202"]}>能奶能秒，奶脉和秒脉按任务切换，221 里常做队长。</Li>
          <Li src={["yzz2202"]}>作为队长要兼顾速度和生存：抢不到一速时鞋子可以打黑宝石，头盔打月亮石更稳。</Li>
        </ul>
      </Section>
      <Section title="提升顺序">
        <ol>
          <Li src={["yzz2504m", "off2604"]}>
            流派选【幽冥巫煞】，任务点法 1221222。经脉【魂守】让夺命咒和追魂刺的基础伤害加倍，是秒脉的核心。
          </Li>
          <Li src={["k2502"]}>日常刷任务一定切秒脉：同一套装备，奶脉切到秒脉后木桩伤害从 695 涨到 1251。</Li>
          <Li src={["y233Wdd"]}>鬼蛊灵蕴点到 140 级秒 5（109 级最多秒 4）。</Li>
          <Li src={["y233Formula"]}>法修拉满：夺命咒每差 1 级修炼，伤害 ±2% 再 ±5 点。</Li>
          <Li src={["y233Formula"]}>敏捷系数 ×0.7，是三个门派里最高的，敏捷装备和敏捷套的收益最好。</Li>
          <Li src={["yzz2409", "y233Formula"]}>
            装备伤害在魂守下有效：太阳石、灵饰伤害都能加群秒，实测约 4.4～5.6 点伤害换 1 点群秒。
          </Li>
          <Li src={["off2005", "y233Rune"]}>
            双四孔镶【销魂噬骨】：人物等级 ×25% / 33% / 50% 的固伤（绿蓝 / 绿蓝红 / 绿蓝红黑）。最多 2 件生效，按头盔 → 衣服 → 鞋子 → 项链 →
            腰带 → 武器的顺序判定，第 3 件白镶。
          </Li>
          <Li src={["yzz2409"]}>法宝：双试剑石 +15 群秒，落星飞鸿 +13 群秒。</Li>
        </ol>
      </Section>
      <Section title="容易踩的坑">
        <ul>
          <Li src={["off2604"]}>
            2026 年 4 月起，夺命咒（燃血）从“作用目标数翻倍”改成了“固伤暴击率翻倍”。老攻略里“燃血秒 10”的打法已经失效。
          </Li>
          <Li src={["y233Formula"]}>销魂噬骨不受阵法和分灵影响，但受修炼影响：法修越高，符石加得越多。</Li>
          <Li src={["y233Formula"]}>妙谛金莲（奶）流派的夺命咒伤害最后要 ×0.7，奶脉打不出秒脉的伤害是正常的。</Li>
        </ul>
      </Section>
    </>
  );
}

function Nver() {
  return (
    <>
      <Section title="定位">
        <ul>
          <Li src={["y233Team"]}>221 里两个女儿村负责封印控场，降低副本难度和消耗，同时也是固伤输出。</Li>
          <Li src={["y233Nr109"]}>女儿村固伤的基础加成偏低，109 级想提升需要较大投入，核心是堆敏捷。</Li>
        </ul>
      </Section>
      <Section title="提升顺序">
        <ol>
          <Li src={["yzz2505", "yzz2504r", "y233Conv", "dm2509"]}>
            任务经脉第一层必须点【暗伤】：与 NPC 战斗时，雨落寒沙获得“武器伤害 ×18%”的固伤（这里的武器伤害包括头盔、灵饰、符石上的伤害和临时符）。代价是封印命中率降低
            10%。偏封印选【绝代妖娆】，偏秒选【花雨伊人】（3223212，9% 几率额外秒 3）。
          </Li>
          <Li src={["y233Nr129", "y233Formula"]}>
            暗器技巧点高。按公式，暗器技巧从 140 点到 160，基础项每个目标多约 60 点，天阵秒 7 时每个副秒约多 45。玩家排查“副秒低”时最常问的就是“暗器点到 160 了吗”。
          </Li>
          <Li src={["y233Formula"]}>法修拉满（每级 ±2% 再 ±5 点）。转门派后记得检查修炼有没有一起转。</Li>
          <Li src={["yzz2401"]}>阵法优先天阵：女儿村天阵 ×1.25，雷阵只有 ×1.14，是唯一雷阵不如天阵的门派。</Li>
          <Li src={["y233NrFormula", "yzz2401"]}>
            双四孔镶【凤舞九天】：人物等级 ×20% / 30% / 40%，属于“固定伤害结果”，不受阵法、分灵、修炼影响。修炼和技能还低时，它的相对收益更高。
          </Li>
          <Li src={["y233Nr109"]}>敏捷是核心：高敏鞋子、雾中仙等敏捷套（头、项链、鞋子），衣服追求高敏。</Li>
          <Li src={["yzz2409", "k2501"]}>
            前排灵饰优先固伤词条：秒 7 时灵饰伤害约 8～9 点才换 1 点群秒；8 段太阳石约 +10 副秒，头盔打月亮石更稳。
          </Li>
        </ol>
      </Section>
      <Section title="容易踩的坑">
        <ul>
          <Li src={["y233Nr129"]}>
            一位 129 女儿村玩家配了双固伤 5 段、4 级锐不可当、533 武器、双四孔、7 段太阳头、满修满技能，副秒只有 1348。回复里问得最多的是：暗器点了没有、经脉对不对、转门派时修炼转了没有。
          </Li>
          <Li src={["yzz2401"]}>低等级时，合成暗器（+100 命中 +50 追加伤害）的伤害可能比雨落寒沙还高。</Li>
          <Li src={["yzz2307", "yzzRune"]}>门派符石组合每件会降低 5% 防御，固伤号本来抗性就低，后排灵饰要补生存。</Li>
        </ul>
      </Section>
    </>
  );
}

function Difu() {
  return (
    <>
      <Section title="定位">
        <ul>
          <Li src={["y233Team", "y233Formula"]}>221 的主输出：秒 7、夜间更强，还能辅助。最怕目标只有 2～3 个的战斗。</Li>
        </ul>
      </Section>
      <Section title="提升顺序">
        <ol>
          <Li src={["yzz2504m", "k2510", "y233Conv"]}>
            流派选【勾魂阎罗】，任务点法 1212222。第一层【阎罗】是任务核心：与 NPC 战斗时，阎罗令获得“武器伤害 ×15%”的固伤。
          </Li>
          <Li src={["k2510", "yzz2409"]}>
            六道魍魉的固伤方向和勾魂阎罗一致。另有实测：六道魍魉第 8～9 颗乾元丹让群秒多约 14 点，勾魂阎罗则多速度。全敏日常可以按队伍速度二选一。
          </Li>
          <Li src={["dvgDf"]}>幽冥术点到 150 级秒 7。</Li>
          <Li src={["y233Formula"]}>法修拉满；夜晚技能项 ×1.3，同样的配置夜里伤害明显更高。</Li>
          <Li src={["y233Formula", "k2509", "yzz2409"]}>
            装备伤害对地府最划算：阎罗令副秒不分灵（只有灵饰固伤词条分灵），所以装备伤害相对灵饰固伤的价值约 0.3，高于女儿村 0.217、无底洞 0.25。实测太阳石、灵饰伤害约
            5.6 点换 1 点群秒，高伤武器、太阳石头盔、灵饰伤害词条、试剑石都很值。
          </Li>
          <Li src={["qq2412"]}>比较武器时，副秒约 1 敏 ≈ 2.35 伤害（命中不算）。</Li>
          <Li src={["y233Formula", "yzzRune"]}>
            双四孔镶【索命无常】：加的是“固定伤害力”，阎罗令不分灵，所以提升很大。具体数值只找到 2018 年旧表（2 孔为人物等级 ÷ 2，3 孔 ÷ 1.5，4 孔黄蓝黄白 ×1），以游戏内说明为准。
          </Li>
          <Li src={["yzz2409"]}>法宝：双试剑石 +12 群秒，落星飞鸿 +12 群秒；技能符石让幽冥术 180 升到 186，约 +13 固伤。</Li>
        </ol>
      </Section>
      <Section title="容易踩的坑">
        <ul>
          <Li src={["k2501", "yzz2409"]}>
            有攻略说“太阳石对地府只加主秒、不加副秒”，但叶子猪的实测是太阳石同时增加点选和群秒。这里采用实测结论；如果抗性吃紧，头盔打月亮石也是合理的取舍。
          </Li>
          <Li src={["k2510"]}>天罡地煞、雁塔地宫这类难度玩法，第五层可以把【泉爆】换成【鬼火】，特技放得更顺。</Li>
        </ul>
      </Section>
    </>
  );
}

const VOICES: { text: string; src: SourceId }[] = [
  { text: "固伤就是卡着飞怪血线配装备才有性价比……你比他多这 200 的副秒就是无效伤害。", src: "qq2510" },
  { text: "不是超级土豪的，固伤有个瓶颈；不是超级难民的，固伤有个保底。5000 一组固伤能玩法系玩不了，20 万一组固伤可能只花 3 万。", src: "qq2510" },
  { text: "1350 副秒和 1600 副秒，在宝宝和修炼不变的情况下，其实只是相差 1 个宝宝出手打主怪。", src: "ne221" },
  { text: "花 2.5 万左右配一组 221（法修 19、输出技能 150、宝宝攻修 10、500 初伤武器、双四孔、前排 3 段固伤伤害灵饰配 2 级锐不可当），一小时抓 20 对鬼没问题；做不到“只能说手法和配速有问题”。", src: "ne221" },
  { text: "固伤上限低下限高，法系下限低上限高；花钱少的固伤伤害高，花钱多的法系伤害高。", src: "qq2110" },
  { text: "现在环活动怪物没抗性血量还高，法系优势已经明显更高了。", src: "qq2510" },
  { text: "但凡你是氪金几个 W 的大佬，我都不推荐你玩 129 级了，175 级难民都比 129 香。", src: "y233Team" },
  { text: "129 女儿村副秒只有 1348？——暗器点到 160 了吗？经脉呢？转门派没转修？", src: "y233Nr129" },
  { text: "五开固伤才省钱；单开固伤全敏不加抗性，像避雷针一样被集火。", src: "yzz2307" },
];

function Voices() {
  return (
    <Section title="玩家心得">
      <p className="muted small">节选自攻略文章和评论区，保留原意，按话题整理。</p>
      <div className="guide-quotes">
        {VOICES.map((v) => (
          <blockquote key={v.text} className="guide-quote">
            <p>{v.text}</p>
            <Ref ids={[v.src]} />
          </blockquote>
        ))}
      </div>
    </Section>
  );
}

const CHECK_KEY = "mhxy-tools.guide-check.v1";
const CHECKS: { group: string; items: string[] }[] = [
  {
    group: "先定目标",
    items: [
      "明确主刷什么（抓鬼、铃铛、副本、难度任务），以及每个号需要的副秒血线（129 抓鬼 1200 / 1600）",
      "已过血线时，效率瓶颈在宝宝（高连、碎甲刃）、配速、出手顺序和手法，不在固伤",
    ],
  },
  {
    group: "不花钱的",
    items: [
      "无底洞点了【魂守】，日常用秒脉",
      "两个女儿村点了【暗伤】",
      "两个地府点了【阎罗】",
      "五个号法修都到当前上限；转门派后修炼已转",
      "师门技能到位：幽冥术 150 秒 7、鬼蛊灵蕴 140 秒 5",
      "女儿村暗器技巧点高（目标 160）",
      "潜能果、机缘、坐骑成长吃满，全敏加点",
      "带了试剑石、落星飞鸿，没带北冥巨鳞充当固伤法宝",
      "用计算器比较过天阵和雷阵的五号总伤",
    ],
  },
  {
    group: "配置细节",
    items: [
      "每个号的门派符石组合正好 2 件生效（第 3 件白镶）",
      "女儿村前排灵饰优先固伤词条；地府、无底洞可以要伤害词条",
      "女儿村头盔不必追高段太阳石",
    ],
  },
  {
    group: "花钱前",
    items: [
      "第一档、第二档都做满了，才考虑三固伤灵饰、高段星辉石",
      "在计算器里设好对比基准，算清楚这笔钱能加多少总伤、能不能多过一条血线",
    ],
  },
];

function Checklist({ onOpenCalculator }: { onOpenCalculator: () => void }) {
  const [done, setDone] = useState<Record<string, boolean>>(() => {
    try {
      const v: unknown = JSON.parse(localStorage.getItem(CHECK_KEY) ?? "{}");
      return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CHECK_KEY, JSON.stringify(done));
    } catch {
      // 存不下只影响下次打开时的勾选状态
    }
  }, [done]);
  const total = CHECKS.reduce((n, g) => n + g.items.length, 0);
  const count = CHECKS.reduce((n, g) => n + g.items.filter((i) => done[i]).length, 0);

  return (
    <Section title="221 自查清单">
      <p className="muted small">
        投入不少但固伤提升不明显时，按顺序逐项核对。已完成 {count} / {total}。
      </p>
      {CHECKS.map((g) => (
        <div key={g.group} className="guide-tier">
          <h3>{g.group}</h3>
          <div className="guide-checks">
            {g.items.map((item) => (
              <label key={item} className="guide-check">
                <input type="checkbox" checked={!!done[item]} onChange={(e) => setDone((d) => ({ ...d, [item]: e.target.checked }))} />
                <span>{item}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
      <div className="row">
        <button className="btn primary" onClick={onOpenCalculator}>
          打开固伤计算器
        </button>
        {count > 0 && (
          <button className="btn ghost" onClick={() => setDone({})}>
            清空勾选
          </button>
        )}
      </div>
    </Section>
  );
}

function Sources() {
  return (
    <Section title="资料来源">
      <p className="muted small">
        整理于 2026 年 11 月。公式和实测均来自玩家，不是官方数据；“官网”条目为官方公告原文。各来源有出入时，以官方公告和实测优先，并在正文中注明。
      </p>
      <ul className="fd-sources" data-tauri-drag-region="false">
        {Object.values(SOURCES).map((s) => (
          <li key={s.url}>
            <div>
              {s.short} · {s.title}
            </div>
            <code>{s.url}</code>
          </li>
        ))}
      </ul>
    </Section>
  );
}

type TabKey = "overview" | "wudidong" | "nver" | "difu" | "voices" | "check" | "sources";
const TABS: [TabKey, string][] = [
  ["overview", "总览"],
  ["wudidong", "无底洞"],
  ["nver", "女儿村"],
  ["difu", "地府"],
  ["voices", "玩家心得"],
  ["check", "221 自查"],
  ["sources", "资料来源"],
];

export function FixedDamageGuide({ onOpenCalculator }: { onOpenCalculator: () => void }) {
  const [tab, setTab] = useState<TabKey>("overview");
  return (
    <>
      <div className="tabs">
        {TABS.map(([k, label]) => (
          <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>
      {tab === "overview" && <Overview />}
      {tab === "wudidong" && <Wudidong />}
      {tab === "nver" && <Nver />}
      {tab === "difu" && <Difu />}
      {tab === "voices" && <Voices />}
      {tab === "check" && <Checklist onOpenCalculator={onOpenCalculator} />}
      {tab === "sources" && <Sources />}
    </>
  );
}

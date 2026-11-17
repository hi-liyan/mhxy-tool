/** 所有金额字段均为原始梦幻币数值（不是"万"） */

export interface Account {
  id: string;
  name: string;
  /** 开刷时是否默认勾选 */
  defaultSelected: boolean;
}

export interface Item {
  id: string;
  name: string;
  /** 估值（梦幻币） */
  value: number;
  /** 图片 dataURL，可为空 */
  image?: string;
  createdAt: number;
  description?: string;
  origin?: "system" | "user";
  /** 创建时使用的系统模板，仅供追溯，物品数据独立保存。 */
  templateId?: string;
}

/** 静态目录 ID 使用字符串，避免 JavaScript 数字精度问题并与用户 ID 隔离。 */
export interface BuiltinItem {
  id: string;
  name: string;
  iconPath: string | null;
  resourceId: string | null;
  description: string | null;
  source: string;
  /** 上游图片原文件名，用于追溯；未知时为 null。 */
  sourceIcon: string | null;
  verifiedAt: string | null;
}

export interface GoldRecord {
  time: number;
  /** 1 元 = 多少梦幻币 */
  price: number;
  source: "manual" | "cbg";
}

export interface CbgServer {
  id: number;
  name: string;
  areaName: string;
}

export interface Settings {
  /** 每 1 点点卡 = 多少梦幻币（由 金价 / 每元点数 算出，开刷时快照到场次里） */
  coinPerPoint: number;
  /** 每个号每小时消耗多少点（官方 6 点） */
  pointsPerHour: number;
  /** 金价：1 元 = 多少梦幻币 */
  goldPrice: number;
  /** 1 元 = 多少点（官方 1 点 = 0.1 元） */
  pointsPerYuan: number;
  /** 藏宝阁区服 */
  cbgServer: CbgServer | null;
  /** 金价变动记录，新的在前 */
  goldHistory: GoldRecord[];
  /** 偶然高价值判定阈值（单件估值，梦幻币），null 表示自动 */
  windfallThreshold: number | null;
}

interface DropBase {
  id: string;
  time: number;
  note?: string;
}

export interface CoinDrop extends DropBase {
  kind: "coin";
  coins: number;
}

export interface ItemDrop extends DropBase {
  kind: "item";
  itemId: string;
  /** 记录时的名称快照，物品被删除后仍可显示 */
  itemName: string;
  qty: number;
  /** 记录时的单价快照 */
  unitValue: number;
}

export type Drop = CoinDrop | ItemDrop;

export interface Session {
  id: string;
  startAt: number;
  /** null 表示正在刷 */
  endAt: number | null;
  accounts: { id: string; name: string }[];
  /** 开刷时的配置快照 */
  pointsPerHour: number;
  coinPerPoint: number;
  /** 手动修正的点卡消耗，null 表示按时长自动计算 */
  pointsOverride: number | null;
  drops: Drop[];
  note: string;
}

export interface DB {
  version: 1;
  settings: Settings;
  accounts: Account[];
  items: Item[];
  builtinValues: Record<string, number>;
  sessions: Session[];
}

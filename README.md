# 梦幻记账

梦幻西游多开刷本记账桌面应用（Tauri 2 + React + TypeScript）。

## 功能

- **开刷 / 下线**：勾选本次上线的号（默认 5 个，可选），实时计时并按 `号数 × 每号每小时点数 × 时长` 计算点卡消耗，再按全局汇率换算成梦幻币。下线时可修正下线时间或手动填写点卡消耗。
- **收入记录**：刷的过程中随时记录获得的梦幻币，或从物品库选择物品 + 数量（按当时估值计入收益）。
- **历史记录**：按今天 / 7 天 / 30 天 / 全部统计时长、点卡消耗、收入、净收益、平均每小时收益和物品掉落汇总；可展开每一场补录或删除收入、修改时间、修正点卡。
- **物品库**：维护自己创建的物品；可以从系统模板或空白创建，并独立编辑名称、描述、估值和图片。
- **设置**：每点点卡对应的梦幻币、每号每小时点数、账号增删改排序、数据备份。

## 开发

```bash
pnpm install
pnpm tauri dev      # 启动桌面应用（开发模式）
pnpm dev            # 仅浏览器预览，数据存 localStorage
pnpm tauri build    # 打包安装包，产物在 src-tauri/target/release/bundle
```

## 数据

系统模板目录位于 `src/itemCatalog.ts`，包含稳定的系统 ID、名称、图标路径、资源编号、描述、来源与最近校验时间。未知资料为 null，不代表已经校验。系统 ID 一经发布不得变更或复用。使用模板创建物品时会复制信息和图片到用户数据，并分配独立 ID；之后编辑用户物品不会改变模板。记账记录保留当时的名称和单价。

物品名称、图标命名及增补流程见 [AGENTS.md](AGENTS.md)。维护目录后运行 `node tests/catalog.test.mjs` 检查。

内置图标部分来自藏宝阁；其他具名图片来自 [xyq-profit-ledger](https://github.com/shutiaolab/xyq-profit-ledger) 的 `img` 目录，来源版本为 `fed0b70b43bddbd3b12af956ec0d9b2807e9b635`。上游以文件名作为物品名称，无法识别名称的哈希文件未纳入。同名物品优先使用原有图标。上游仓库未附许可证，游戏图片的授权信息亦未注明。

全部数据保存在本地单个 JSON 文件中（macOS 路径：`~/Library/Application Support/com.chenjinliang.mhxy-ledger/data.json`），
写入采用"临时文件 + rename"的原子方式；「设置 → 立即备份」会复制到同目录的 `backups/` 下。

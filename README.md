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

## 自动构建与发布

推送到 `main` 后，GitHub Actions 会校验物品目录及发布脚本，执行 TypeScript 检查和前端构建，并只打包 **Windows x86-64** 的 EXE（NSIS）和 MSI 安装包。构建成功后自动提交版本文件、创建 `vX.Y.Z` 标签并发布到 GitHub Releases，同时提供 SHA256 校验文件及 Actions 构建产物。不构建 macOS、Linux、Windows ARM64 或 x86。

版本规则：

- 无历史版本标签时，首次自动发布当前版本 `v0.1.0`。
- 后续按上次版本标签以来的全部提交判断：`feat:` / `feat(范围):` 升 minor，`fix:` 及其他提交升 patch。
- 提交标题含 `!`（例如 `feat!: ...`），或正文含 `BREAKING CHANGE:` / `BREAKING-CHANGE:`，升 major；同时存在多种提交时取最大升级幅度。
- 可在 **Actions → Windows build and release → Run workflow** 中选择 `main`，使用 `auto`，或手动选择 `patch` / `minor` / `major`。

版本号由脚本同步写入 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 和 `src-tauri/Cargo.lock`；日常开发不必手动改版本。自动提交带 `[skip ci]`，不会再次触发发布。Release 说明按新增功能、问题修复、性能优化及其他变更组织，列出上次版本到本次之间的**全部提交标题与链接**，首次发布则包含全部历史提交，并提供版本比较链接。

工作流使用仓库自带的 `GITHUB_TOKEN`，无需额外配置 PAT。仓库规则需允许 Actions 向 `main` 推送版本提交、创建 `v*` 标签及写入 Releases；如果分支或标签保护禁止此操作，需要管理员配置对应权限。版本与标签使用原子推送：构建期间若 `main` 有新提交，旧任务会安全失败，后续任务会基于最新分支重试。发布任务串行运行；GitHub concurrency 最多保留一个待运行任务，后续发布仍会包含期间全部提交。

安装包全部上传后才将 Release 从草稿设为正式发布。如果推送标签后上传失败，重新运行工作流的 `auto` 模式会复用当前标签版本，补传产物并完成发布。`auto` 在分支没有新提交时也会复用当前版本；需要主动发布新版本时使用手动升级选项。安装包目前未配置代码签名。

发布逻辑测试：`node --test tests/release.test.mjs`。

## 数据

系统模板目录位于 `src/itemCatalog.ts`，包含稳定的系统 ID、名称、图标路径、资源编号、描述、来源与最近校验时间。未知资料为 null，不代表已经校验。系统 ID 一经发布不得变更或复用。使用模板创建物品时会复制信息和图片到用户数据，并分配独立 ID；之后编辑用户物品不会改变模板。记账记录保留当时的名称和单价。

物品名称、图标命名及增补流程见 [AGENTS.md](AGENTS.md)。维护目录后运行 `node tests/catalog.test.mjs` 检查。

内置图标部分来自藏宝阁；其他具名图片来自 [xyq-profit-ledger](https://github.com/shutiaolab/xyq-profit-ledger) 的 `img` 目录，来源版本为 `fed0b70b43bddbd3b12af956ec0d9b2807e9b635`。上游以文件名作为物品名称，无法识别名称的哈希文件未纳入。同名物品优先使用原有图标。上游仓库未附许可证，游戏图片的授权信息亦未注明。

记账数据保存在本地单个 JSON 文件 `data.json` 中。新用户默认使用以下数据目录：

- Windows：`%APPDATA%/com.iyucode.mhxy-tools/`
- macOS：`~/Library/Application Support/com.iyucode.mhxy-tools/`
- Linux：`$XDG_DATA_HOME/com.iyucode.mhxy-tools/`（未设置时为 `~/.local/share/com.iyucode.mhxy-tools/`）

如果同一位置已存在旧目录 `com.chenjinliang.mhxy-ledger`，则优先继续使用旧目录，即使旧目录为空或新旧目录同时存在，也不会自动迁移或合并数据。设置页显示实际使用的目录；记账数据、备份及藏宝阁会话均使用该目录。

写入采用"临时文件 + rename"的原子方式；「设置 → 立即备份」会复制到实际数据目录的 `backups/` 下。

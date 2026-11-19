# 梦幻记账 — 开发协作指南

梦幻西游多开刷本记账桌面应用：Tauri 2（Rust）+ React 19 + TypeScript + Vite，正式发布只面向 Windows x86-64。
界面风格为宣纸底、朱红、描金和楷体标题。颜色、圆角和字体以 `src/styles.css` 中 `:root` 的变量为准，图表配色以 `src/components/charts.tsx` 中的 `VIZ` 为准。

## 目录结构

- `src/types.ts`：数据模型，包括 `DB`、`Session`、`Drop`、`Item` 和 `BuiltinItem`。所有金额字段都是梦幻币原值，不以“万”为单位。
- `src/storage.ts`：负责读写 `data.json`，用 `normalize` 兼容旧数据并合并连续写入；所有 Tauri `invoke` 的前端封装也在这里，包括藏宝阁 `cbg`。浏览器预览时改用 localStorage。
- `src/store.tsx`：提供 `StoreProvider` 和 `useStore`。`update(draft => …)` 先修改深拷贝，再自动保存；`items` 由系统目录和用户物品合并而成。
- `src/itemCatalog.ts`、`src/assets/items/`：系统物品目录及图片，规则见下文“系统物品目录”。
- `src/utils.ts`（格式化、场次统计）、`src/analysis.ts`（统计分析）：计算口径集中在这里，页面直接复用，不要重复实现。
- `src/components/`：公共组件。`ui.tsx` 提供 `Modal`、`useUi()`、`Stat` 和 `WanInput`；其他文件分别负责图表、物品、掉落、金价、藏宝阁面板和标题栏。
- `src/pages/`：每个侧边栏页面一个文件，并在 `src/App.tsx` 的 `PAGES` 中注册。`src/platform.ts`：平台检测，macOS 和 Windows 使用自绘标题栏。
- `src-tauri/src/lib.rs`：数据文件命令、托盘及命令注册。`data_path.rs`：数据目录解析。`cbg.rs`：藏宝阁登录、Cookie 会话和金价查询。
- `src-tauri/tauri.conf.json`、`tauri.windows.conf.json`、`tauri.macos.conf.json`：应用和窗口配置。`capabilities/default.json`：前端可调用的权限。
- `scripts/release.mjs`、`.github/workflows/release.yml`：自动定版与发布。`tests/`：Node 测试。`src-tauri/gen/schemas/` 是生成文件，不要手改。

## 规则

### 数据安全与兼容

- `data.json` 是用户唯一的记账数据。修改 `DB` 结构时，在 `storage.ts` 的 `normalize` 中兼容旧数据，缺少的字段补默认值；旧文件必须能正常读取，且不能丢失字段。读取失败时应用会停止启动，以免覆盖数据，修改时保持这一行为。
- 历史记录保存当时的快照：场次的 `pointsPerHour`、`coinPerPoint`，以及掉落的 `itemName`、`unitValue`。修改物品、估值、设置或系统目录时，不得改写已有场次。
- 系统物品与用户物品分开存储：系统物品的个人估值按系统 ID 存在 `builtinValues`，用户物品存在 `items`。从模板创建的物品会复制信息并分配独立 ID，`templateId` 仅供追溯。
- 数据目录由 `src-tauri/src/data_path.rs` 决定：旧目录 `com.chenjinliang.mhxy-ledger` 存在时优先使用，否则使用 `com.iyucode.mhxy-tools`，不自动迁移或合并。窗口位置插件会在 `%APPDATA%<identifier>`（与旧目录同名）写 `.window-state.json`，因此只含这个文件的旧目录不算旧数据目录。数据目录与 `tauri.conf.json` 的 `identifier` 相互独立。没有明确要求时，不要修改目录名、目录优先级或 `identifier`。
- 写盘保持“临时文件 + rename”的原子方式。前端统一通过 `useStore().update` 修改数据，不要直接修改 `db`，也不要绕过 `saveDB`。
- `cbg_session.json` 保存藏宝阁 Cookie，与记账数据分开存放，不进入备份。不要打印或提交它的内容，也不要让它出现在截图或日志中。

### 前端

- 浏览器预览（`pnpm dev`）要始终可用。依赖 Tauri 的功能经 `storage.ts` 封装，非桌面环境下给出中文提示，而不是报错崩溃（参考 `requireTauri` 和 `cbg.available`）。
- 金额的输入和显示使用 `WanInput`、`fmtCoin`、`toWan`、`fromWan`，存储时始终使用梦幻币原值。
- 确认框和提示使用 `useUi().confirm` 与 `toast`，不要用 `window.confirm` 或 `alert`。
- 样式写在 `src/styles.css`，颜色使用已有的 CSS 变量。不要在组件中新增十六进制颜色，图表配色集中在 `VIZ` 中。
- 根节点设置了 `data-tauri-drag-region="deep"`，按住空白处可以拖动窗口。可交互元素使用原生的 `<button>`、`<input>` 等控件；需要悬停、选中文本或自定义鼠标交互的容器加上 `data-tauri-drag-region="false"`，可参考图表、弹窗遮罩和数据目录路径。
- 界面文字、错误提示和注释使用简体中文。注释少而有用，风格与周围代码一致。`tsconfig` 开启了 `noUnusedLocals` 和 `noUnusedParameters`，存在未使用的变量时构建会失败。

### Tauri 后端

- 新命令写成 `#[tauri::command]`，返回 `Result<T, String>`，错误信息要能直接展示给用户（中文）。在 `lib.rs` 的 `generate_handler!` 中注册，并在 `storage.ts` 中添加前端封装。
- 访问网络或 WebView 的命令写成 `async`。在 Windows 上同步调用 `cookies_for_url` 会死锁，详见 `cbg.rs`。
- 使用新的窗口 API 或插件时，在 `capabilities/default.json` 中只授予所需的最小权限。引入 Tauri 插件时，需要同时添加 Cargo 依赖、对应的 npm 包（插件有前端 API 时），在 `lib.rs` 中用 `.plugin(...)` 初始化，并提交更新后的 `Cargo.lock` 和 `pnpm-lock.yaml`。
- 关闭主窗口只会把它隐藏到托盘，要退出应用需使用托盘菜单中的“退出”。没有明确要求时，保持这一行为不变。

## 系统物品目录

修改或增补系统内置物品时遵守以下规则。用户自建物品的名称和上传的图片由用户维护，不受这些规则限制。

### 物品名称

- 在 `src/itemCatalog.ts` 中手工维护明确的物品记录，不要根据图片文件名自动生成物品。
- 使用梦幻西游电脑版的规范名称。名称在前，等级、部位等必要规格放在中文括号内，例如 `珍珠（110级）`、`制造指南书（150级项链）`、`符石（1级）`。没有规格的物品直接写名称；不要使用以数字开头的简称、英文括号或多余空格。
- 名称不得重复；不同等级、部位或确实不同的物品可以分别建档。通用物品与特定规格物品只在确有区别时分开保留。不要仅凭图片相同就合并，也不要把缺乏证据的名称猜作另一件物品。

### 编号和图片

- `id` 使用 `system:` 加至少四位数字，例如 `system:0125`。新编号取历史上用过的最大编号加一；已用过的编号即使对应记录已删除，也不得修改或复用（可用 `git log -p -- src/itemCatalog.ts` 核对）。物品名称或图片改变时编号不变，新记录追加到目录末尾。
- 每条记录写成一行 JSON：以两个空格加 `{` 开头，键名使用双引号。`tests/catalog.test.mjs` 会逐行解析这些记录，多行记录会导致解析失败，缩进不同的记录则会被漏检。
- 系统图片放在 `src/assets/items/`，文件名为 `item-` 加 ID 的数字部分，例如 `system:0125` 对应 `item-0125.png`。每件物品至多一张主图；`iconPath` 填 `./assets/items/` 下的准确路径，缺图时填 `null`。目录中不能有未被引用的图片。
- 扩展名使用小写的 `.png`、`.jpg` 或 `.gif`，并与真实文件格式一致；不要仅靠修改扩展名来转换格式。沿用原始图片时保留原始内容，不要在改名时降低质量。
- `resourceId` 只记录已知的上游资源编号，不要把本地 ID 当作上游编号。`source` 记录数据或图片的来源，`sourceIcon` 保存上游图片的原文件名，以便追溯；未知的值填 `null`。图片的使用许可未确认时，保留来源信息并如实说明。
- `verifiedAt` 只在核对过资料后填写 ISO 日期或时间。不得编造描述、等级、来源或校验时间。

## 常用命令

- `pnpm install`：安装依赖。CI 使用 `--frozen-lockfile`，锁文件必须与依赖同步。
- `pnpm tauri dev`：以开发模式启动桌面应用，会先在固定端口 1420 启动 Vite。
- `pnpm dev`：只在浏览器中预览，数据存在 localStorage。URL 加上 `?platform=win` 或 `?platform=mac` 可以模拟自绘标题栏。
- `pnpm build`：运行 `tsc --noEmit` 和 Vite 构建，相当于本项目的 TypeScript 检查加构建。
- `pnpm test:catalog`：检查系统目录。直接运行 `node tests/catalog.test.mjs` 时，须在仓库根目录下执行。
- `pnpm test:release`：测试定版和发布说明的生成逻辑。
- `cargo fmt --manifest-path src-tauri/Cargo.toml`、`cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets`、`cargo test --manifest-path src-tauri/Cargo.toml`：Rust 的格式化、静态检查和单元测试（`data_path.rs`、`cbg.rs` 中有测试）。
- `pnpm tauri build`：在本机打包安装包，产物在 `src-tauri/target/release/bundle/`。CI 只打包 Windows x86-64 的 NSIS 和 MSI 安装包。

## 提交前检查

CI 会运行目录检查、发布逻辑测试和完整的 Windows 打包（包括 `pnpm build` 和带 `--locked` 的 Cargo 构建），任何一项失败都不会发布。请根据改动范围运行以下检查：

- 系统目录或图片：运行 `pnpm test:catalog`，并人工核对物品内容。脚本只覆盖编号与名称的唯一性、格式、图片命名、文件格式和引用关系，不能代替内容核对。
- 发布脚本或工作流：运行 `pnpm test:release`。
- 前端：运行 `pnpm build`。
- Rust：依次运行 `cargo fmt`、`cargo clippy`、`cargo test`（完整命令见上文），不要引入新的警告，并确认 `pnpm tauri dev` 能正常启动。
- 界面或运行时行为：在运行中的应用里实际验证。纯界面改动用 `pnpm dev` 验证；数据文件、备份、托盘、藏宝阁等桌面功能用 `pnpm tauri dev` 验证（注意下文提到的真实数据目录问题）。
- 汇报时写明运行了哪些命令、结果如何，以及哪些内容没有验证。

## 提交与发布

- 推送到 `main` 会自动定版、打标签并发布 GitHub Release。未经用户明确要求，不要推送到 `main`，也不要创建 `v*` 标签或发布 Release。
- 修复问题时先复现，再修改。一个提交只解决一个问题，保持 diff 聚焦。数据格式、计算口径、发布行为等产品取舍如果无法从代码和需求中判断，先询问用户，不要自行决定。
- 提交标题使用 Conventional Commits，描述用中文，例如 `feat(物品库): 支持从系统模板创建自定义物品`、`fix: 修复中文应用名称导致 MSI 打包失败`。类型决定版本升级：`feat` 升 minor，`fix` 及其他类型升 patch；标题含 `!` 或正文含 `BREAKING CHANGE:` 时升 major。Release 说明会列出所有提交标题，因此标题要让用户看得懂。
- 不要手动修改版本号。`package.json`、`tauri.conf.json`、`Cargo.toml`、`Cargo.lock` 中的应用版本由 `scripts/release.mjs` 写入。
- CI 会以 `chore(release): vX.Y.Z [skip ci]` 为标题向 `main` 推送版本提交，因此本地 `main` 往往落后于远端，推送前先同步远端。

## 易错点

- `pnpm tauri dev` 与已安装的正式版使用同一个真实数据目录，目录名不区分开发版和正式版。在开发模式下测试会改动用户真实的记账数据。只验证界面时优先使用 `pnpm dev`；必须用桌面版测试时，先通过“设置 → 立即备份”或手动复制 `data.json` 备份数据，不要删除或覆盖用户数据。
- Vite 设置了 `strictPort`，固定使用端口 1420，端口被占用时 `pnpm tauri dev` 会直接失败。遇到这种情况时，先确认占用端口的是否为本次会话启动的进程，只结束自己启动的进程；不要按进程名批量结束进程（例如 `taskkill /IM`）。
- 关闭主窗口后，应用仍在托盘中运行。结束开发会话前确认应用已退出，以免残留的进程占用端口或锁定可执行文件。
- Tauri 的平台配置按 JSON Merge Patch 合并，数组会被整体替换，而 `tauri.windows.conf.json` 和 `tauri.macos.conf.json` 各自完整定义了 `app.windows`。修改窗口尺寸、标题等设置时，三个配置文件要一起修改。
- 应用的 `productName` 是中文，`tauri.windows.conf.json` 中 WiX 的 `"language": "zh-CN"` 是 MSI 打包成功的必要设置，不要删除。
- Rust 首次冷编译需要几分钟。长时间运行的命令（如 `pnpm tauri build`、`cargo clippy`）要单独执行，不要与其他命令串在同一次可能超时的 shell 调用里。

## 并行工作树

- 每个任务可以单独创建一个工作树：`git worktree add ../<name> -b <branch> origin/main`，然后在其中运行 `pnpm install`。
- 所有工作树共用端口 1420 和同一个数据目录（浏览器预览则共用同一个 localStorage），同一时间只运行一个工作树的 `pnpm tauri dev` 或 `pnpm dev`。每个工作树的 `src-tauri/target` 要相互独立，不要指向共享目录。
- 完成后，先停止该工作树启动的进程并删除其构建产物，再运行 `git worktree remove ../<name>`。

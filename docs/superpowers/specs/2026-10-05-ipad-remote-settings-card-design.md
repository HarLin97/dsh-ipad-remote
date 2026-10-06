# iPad 远程访问设置卡片设计（Phase 8）

- 日期：2026-10-05
- 状态：**已完成并验证**（2026-10-05）。证据：`pnpm test` 139 项、`scripts/live-probe.mjs` 26 项、`scripts/verify-settings-ui.mjs` 浏览器断言通过，截图 `docs/verification/`。实施中经浏览器验证修正两处：关停时先发响应再释放监听（网关 `stop()` 改为认得正在作答的连接），以及 `listening` 改为 `enabled && gateway !== undefined`
- 工作区：`<this repo>`
- 上游核对基线：`<harness checkout>` @ `0.2.1-alpha.1`（与桌面端 `@deepseek-ai/dsh-desktop-runtime@0.2.1-alpha.1` 同版本）
- 参考实现：`E:\ai\dsh-plugin-base` 的 `packages/skill-market`（settings.section 卡片）与 `docs/harness-design-conventions.md`

## 1. 目标

把 Phase 8 从"只能用 curl 驱动控制接口"补成**Harness 设置面板里的一个独立配置页**，用户无需命令行即可完成：开关远程访问、设置 PIN、查看地址与二维码、撤销已解锁设备。

## 2. 形态与位置

设置面板左侧新增独立一节「iPad 远程访问」（slot `settings.section`，与技能市场同一机制），不是插件台账里的行卡片。理由：

- 控制面 `/ipad-remote/api/*` 是产品能力而非插件元数据，配独立页面更贴切；
- 插件行以 `file://` 挂载，避开插件台账/配置编辑器对该形态的未知支持；
- PIN 是需要"写入但不回读"的秘密，放在独立页面里更好控制。

## 3. 已核实的上游事实（实现必须以此为准）

| # | 事实 | 源码位置 |
|---|---|---|
| C1 | 客户端半由 `dsh-client-modules` 扫描已启用 Loader 行决定：`file://`/`./`/绝对路径的行按模块 URL 向上找**最近**的 `package.json`，读其 `dsh.client`；`dsh.client.platform==='web'` 且 `exports["./client"]` 存在才服务。 | `packages/client/modules/src/index.ts:817-931` |
| C2 | 客户端产物格式是 lazy-CJS 工厂：运行脚本只调用 `window.__ModuleLoader__.load({ id, factory })`，模块体在 factory 内，`factory(require)` 物化时执行副作用。 | `packages/client/modules/README.md` |
| C3 | 平台静态模块表含 `react`、`react/jsx-runtime`、`react-dom`、`@deepseek-ai/cordis`、`dsh-client-store`、`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-ui-dockkit`，因此这四类无需 `dsh.client.external`。 | `packages/client/web/src/platform.ts:8-16` |
| C4 | Harness 的 `clientBundle` tsdown preset 只存在于仓库内（`packages/client/tsdown.client.ts`），未发布；外部包自行复刻包裹头。 | `docs/cookbook/adding-a-settings-card.md` §5 |
| C5 | 设置节注册契约：`settings.section` 是 root 作用域列表，选项含 `id`/`order`/`label`/`locale`/`inject`；文案由注册方本地化。 | `packages/client/ui-settings/src/client/contract/slots.ts` |
| C6 | 可用上游组件：`Switch`、`Input`、`Button`、`Tag`、`Toast`、`StateDot`、`DisclosureRow` 等。 | `packages/client/ui-primitives/src/index.ts` |
| C7 | 客户端 bundle 是**激活时快照**，产物必须在 Harness 启动前构建完成，否则激活直接报错。 | `packages/client/modules/README.md` §Build requirements |

## 4. 卡片内容

1. **远程访问开关**：`Switch` → `POST {CONTROL_PREFIX}/enable {enabled}`。状态区分三态：监听中（`enabled && listening`）、已停止（`!enabled`）、**端口被占用**（`enabled && !listening`，错误语义色 + 原因提示）。
2. **访问 PIN**：6 位数字输入（前端复用与 `isValidPinFormat` 相同的规则先校验，Host 端仍二次校验）→ `POST /pin {pin}`。只显示「已设置 / 未设置」，**永不回读**。
3. **地址与二维码**：列出 `status.addresses`（局域网 / Tailscale 分组），每个地址渲染一张二维码 + 可复制的 URL。二维码固定**白底黑块**，不随明暗主题反色（深色主题下反色二维码扫不出来）。
4. **已解锁设备**：`status.sessions` 列表（标签、签发时间、过期时间），`POST /revoke` 撤销全部。

状态覆盖：初次加载、加载失败可重试、空态（无地址 / 无会话）、提交中禁用防重复、操作成功后以真实状态刷新（不是只弹 Toast）。

## 5. 技术方案与取舍

### 5.1 二维码：客户端纯函数编码 + SVG 渲染（选定）

- 编码器 vendor 一份 MIT 许可的极简实现到 `src/qr.ts`（保留版权与许可声明），纯函数输出模块矩阵，不依赖 DOM/Node。
- 客户端把矩阵渲染成 SVG（`src/client/qr.tsx`），无新 HTTP 路由、无 URL 白名单校验负担、切换地址即时重绘。
- 备选（未采用）：Host 端生成 SVG 并通过 `GET /ipad-remote/api/qr` 提供——多一条路由与地址白名单校验，收益仅是"可被将来的解锁页复用"。
- **验证**：devDependency `jsqr` 做**往返解码测试**——编码矩阵 → RGBA 位图 → jsqr 解码 → 必须还原原始 URL。这是"二维码真能扫"的自动化证据，不能只测矩阵尺寸。

### 5.2 客户端构建：tsdown 复刻 lazy-CJS 包裹（选定）

- `tsdown.settings.config.ts` 参考 `dsh-plugin-base/packages/skill-market`：`format: 'cjs'`、`platform: 'browser'`、banner `window.__ModuleLoader__.load({ id, factory: (require) => {`、footer `return module.exports; } });`、`intro` 声明 `module/exports`。
- externals 只有平台表里的 `react`、`react/jsx-runtime`、`@deepseek-ai/dsh-client-ui-primitives`；其余全部内联（`noExternal`）。
- 声明文件由 `tsc -p tsconfig.client.build.json` 产出，`exports["./client"]` 的 types 指向它。

### 5.3 数据通路

浏览器半直接 fetch 同源的 `{CONTROL_PREFIX}`（控制面注册在 Harness webserver 上，同源，`sameOrigin()` 通过）。协议类型复用 `src/contract.ts` 的纯类型与常量——该文件本来就只为"不把 Node 代码带进浏览器"而存在。

### 5.4 文案与主题

- 文案走 `ctx.locale`，注册 `zh`/`en` 两套；节标题 `label: () => t('nav')`。
- 颜色只用 `--dsw-alias-*` 语义令牌；字号/密度按 `harness-design-conventions.md` §5（正文 13px、辅助 12px、设置区标题 18px/600）。
- 交互全部可用键盘完成，错误用 `role="alert"`，切换状态用 `aria-checked` 等原生语义（优先用上游 `Switch` 组件）。

## 6. 交付物

新增：
- `src/qr.ts`（vendored 编码器，MIT 署名）
- `src/client/settings.tsx`、`src/client/api.ts`、`src/client/locales.ts`、`src/client/qr.tsx`
- `tsconfig.client.json`、`tsconfig.client.build.json`、`tsdown.settings.config.ts`
- `test/qr.test.ts`、`test/client-api.test.ts`、`test/client-bundle.test.ts`

修改：
- `package.json`：`exports["./client"]`、`dsh.client`（platform web + inject ui-settings/locale）、`files`、`build`/`typecheck` 脚本、devDeps（react、react-dom、@types/react、ui-primitives、ui-settings、ui-locale、ui-slots、ui-renderer @0.2.1-alpha.1、tsdown、jsqr）
- `scripts/verify-install.mjs`：加"客户端半进入启动图 / bundle 可服务"检查
- `README.md`、`progress.md`、`task_plan.md`

## 7. 验证计划

1. `pnpm typecheck`（含客户端 tsconfig）+ `pnpm test` 全绿，新增测试见 §6。
2. 构建产物契约测试：`client/settings.js` 必须以 loader 包裹头开头、以 footer 结尾，且 `dsh.client`/`exports["./client"]`/`files` 三者一致。
3. **实况验证（不打扰用户正在使用的桌面端）**：用 `scripts/start-standalone.ps1`（`DSH_HOME=.run-home`）启动独立 Harness →
   - 抓 `/` 的 `window.__DSH_BOOT__`，断言其中含 `@harlin97/dsh-ipad-remote` 行；
   - 从 `/plugins` 拉取该行的 bundle，断言字节与本地 `client/settings.js` 一致；
   - 复跑控制面检查（status/enable/pin/revoke）。
4. 用户在浏览器打开该独立实例确认视觉与交互；确认后再重启桌面端，用 `scripts/verify-install.mjs` 复验。

## 8. 代价与风险

- **客户端 bundle 是启动时快照**：改动必须重启 Harness 才生效（HMR 不覆盖这类行）。开发期用独立实例迭代。
- **桌面端当前进程就是本会话的宿主**（PID 26592）：重启会断开当前界面，因此桌面端验证放到最后，由用户决定时机。
- 上游组件 API 以 `0.2.1-alpha.1` 源码为准；规范文档里 `D:\ai\deepseek-harness` 是过期路径（本机在 `<harness checkout>`）。
- 若 `file://` 行的客户端半在上游实现里存在未预料的限制，回退方案是改用 Host 端 `Config` schema + 插件台账配置卡片（代价：PIN 会落到 patch 文件）。

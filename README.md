# dsh-ipad-remote

让 **iPad / 手机 / 另一台电脑**通过局域网、Tailscale 或 HTTPS 使用**桌面端 DeepSeek Harness 的同一个 Web UI**，并在网络入口加一层自己的 6 位 PIN 门禁。

- **不做第二套 UI**：打开的就是桌面端那一个页面；安装后是独立窗口的 app（可安装的 Web 应用，暂无离线能力——见[能力边界](packages/ipad-remote/README.md#能力边界它不是离线-pwa)）。
- **不改上游**：全部通过公开接缝接入（`tapIndex` / `ctx.slots` / `settings.section` / `dsh.bundle.patch` + `dsh.client`），Harness 本体保持在回环绑定。
- **运行时零依赖**：对 `@deepseek-ai/*` 只有 type-only import，`lib/` 与 `client/` 可独立加载。

## 安装

```powershell
# Web / TUI profile —— 一条命令（会同时把插件登记进 profile 的 bundles）
dsh plugin --profile web add @harlin97/dsh-ipad-remote

# 桌面端 App —— 用应用内「设置 → 插件」安装（桌面 profile 由 App 独占管理）

# 或者本地克隆后用 home 层 patch（幂等，可 -Remove 还原）
git clone <this repo> ; cd <this repo> ; pnpm install ; pnpm build
.scriptsinstall-home-patch.ps1
```

详细步骤、前置条件与三种安装方式的差异见 [packages/ipad-remote/README.md](packages/ipad-remote/README.md)。

## 用起来

1. 桌面端 Harness → **设置 → 远程访问** → 设 6 位 PIN → 打开开关。
2. 设备打开网关地址（局域网 `http://<本机IP>:50070/`，启用 HTTPS 后 `https://<本机IP>:50071/`），输入 PIN。
3. iOS 用「添加到主屏幕」；安卓与桌面 Chrome/Edge 用地址栏的「安装应用」（需要 HTTPS，先跑 [scripts/make-tls.ps1](scripts/make-tls.ps1) 并给设备装一次根证书）。

## 仓库结构

- [packages/ipad-remote](packages/ipad-remote/README.md) —— 插件本体（网关、PIN 门禁、Web App 资产、触控层、设置卡片）与全部文档
- [scripts](scripts) —— 证书签发、home 层安装、真实链路验证、DOM 锚点审计
- [docs/superpowers/specs](docs/superpowers/specs) —— 设计规格（决策与取舍记录）

## 开发

```powershell
pnpm install
pnpm build
pnpm test          # 173 项
pnpm typecheck
```

真实链路验证（需要一个跑起来的网关）：

```powershell
$env:PROBE_PIN='<PIN>'; node scripts/live-probe.mjs
node scripts/verify-settings-ui.mjs      # 需要 HARNESS_CHECKOUT 指向 harness checkout（借用其 Playwright）
```

## 许可

MIT，见 [LICENSE](LICENSE)。

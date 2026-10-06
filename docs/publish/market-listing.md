# 上架 dsh-market（一键安装）

市场（`dshmarket` 插件）**只允许安装精选列表里的来源**，列表数据来自
[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 的 `data/plugins/*.yml`，
站点与市场由 CI 每日刷新（目录地址 `https://awesome-dsh-plugin.com/plugins.json`）。
所以「市场上能一键装」= **npm 上有包** + **精选列表里有条目**。

## 前置条件（本仓库已满足，列出来供核对）

| 要求 | 现状 |
|---|---|
| `package.json` 声明 `dsh.bundle` | ✅ `dsh.bundle.patch: ./cordis.patch.yml` |
| 旁边有 `cordis.patch.yml` | ✅ 且只插入一个 `insert` 块 |
| 真实可用的代码 | ✅ 19 个测试文件 / 173 项 |
| 描述属实、无营销词 | ✅ 见条目文案 |
| 仓库带 `dsh-plugin` topic | ⬜ 建仓库后加上 |
| 仓库创建满 **1 天** | ⬜ 建仓库后次日再提 PR（CI 自动校验） |

## 步骤

### 1. 发布到 npm（市场按 npm 包装）

```powershell
npm login                     # 你的 @harlin97 scope
cd packages\ipad-remote
pnpm build                    # 产物 lib/ client/ assets/
npm publish --access public   # 包名取自 package.json：@harlin97/dsh-ipad-remote
```

发布后自检：`npm view @harlin97/dsh-ipad-remote version dist.tarball`。

### 2. 建 GitHub 仓库并加 topic

```powershell
gh auth login
gh repo create harlin97/dsh-ipad-remote --public --description "Share the desktop DeepSeek Harness UI with phones and other computers, behind a six-digit PIN."
git remote add origin https://github.com/harlin97/dsh-ipad-remote.git
git push -u origin main       # 公开历史只有一个提交，敏感信息已清理
gh repo edit --add-topic dsh-plugin --add-topic deepseek-harness --add-topic pwa
```

### 3. 次日提 PR（仓库需满 1 天）

把本目录下的 `harlin97__dsh-ipad-remote--packages-ipad-remote.yml` 放进该仓库的 `data/plugins/`——一个文件就是全部投稿：

```powershell
gh repo fork awesome-dsh-plugin/awesome-dsh-plugin --clone
# 复制本目录的 yml 到 fork 的 data/plugins/ 下
git checkout -b add-dsh-ipad-remote
git add data/plugins/harlin97__dsh-ipad-remote--packages-ipad-remote.yml
git commit -m "Add dsh-ipad-remote"
git push -u origin add-dsh-ipad-remote
gh pr create --title "Add dsh-ipad-remote" --body "Serves the Harness UI to other devices behind a PIN gate; npm: @harlin97/dsh-ipad-remote"
```

合并后通常一天内出现在站点与市场，之后在市场里就是**一键安装**（走 App 自己的插件管理器——桌面 profile 唯一被认可的管理方）。

## 备注

- 市场安装的是 **npm 包**而不是 GitHub 目录，所以第 1 步是硬前提。
- 市场的兼容性卡片读 `engines.dsh` 与 `@deepseek-ai/dsh-*` peer 声明；本包两者都有。
- 条目文案会被与代码核对（「描述必须属实」），功能变了记得同步改。

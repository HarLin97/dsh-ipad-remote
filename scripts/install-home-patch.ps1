<#
.SYNOPSIS
  把 dsh-ipad-remote 注册进 DSH 的 home 层 patch（桌面端 App 唯一可行的安装方式）。

.DESCRIPTION
  `dsh plugin --profile desktop add` 会被上游拒绝：apps/cli/src/args.ts 的
  rejectElectronProfile 写着 "profile desktop is managed exclusively by the
  Electron application" —— 桌面 profile 只能由 App 自己管理。所以桌面端要么用应用内
  插件管理器，要么用本脚本写 home 层 patch。

  幂等：重复运行会替换托管块；-Remove 整段删除、完全还原。写入前先备份。

.EXAMPLE
  .\scripts\install-home-patch.ps1
  .\scripts\install-home-patch.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string]$DshHome = (Join-Path $env:USERPROFILE ".dsh"),
  [string]$PluginPath,
  [switch]$Remove
)

$ErrorActionPreference = "Stop"
if (-not $PluginPath) {
  $repo = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
  $PluginPath = (Resolve-Path (Join-Path (Join-Path $repo "packages") "ipad-remote")).Path
}
$entry = Join-Path (Join-Path $PluginPath "lib") "index.js"
$entryUrl = "file:///" + $entry.Replace([char]92, [char]47)
if (-not $Remove -and -not (Test-Path $entry)) {
  throw "找不到 $entry —— 请先在仓库根目录运行 pnpm install 与 pnpm build"
}

$patchPath = Join-Path $DshHome "cordis.patch.yml"
$start = "# --- dsh-ipad-remote 开始（install-home-patch.ps1 写入）---"
$end = "# --- dsh-ipad-remote 结束 ---"
# 早先手工安装写入的那套标记也要认，否则重复运行会留下两份插件行。
$legacyStart = "# --- iPad 远程访问（dsh-ipad-remote）开始 ---"
$legacyEnd = "# --- iPad 远程访问（dsh-ipad-remote）结束 ---"
$lines = @()
if (Test-Path $patchPath) {
  $lines = Get-Content $patchPath
  $backup = $patchPath + ".bak-" + (Get-Date -Format "yyyyMMdd-HHmmss") + "-" + (Get-Random -Maximum 9999)
  Copy-Item $patchPath $backup -Force
  Write-Host ("已备份原 patch 到 " + $backup) -ForegroundColor DarkGray
}

# 去掉上一次写入的托管块（含标记行本身），其余内容原样保留。
$kept = New-Object System.Collections.Generic.List[string]
$skipping = $false
foreach ($line in $lines) {
  if ($line -eq $start -or $line -eq $legacyStart) { $skipping = $true; continue }
  if ($line -eq $end -or $line -eq $legacyEnd) { $skipping = $false; continue }
  if (-not $skipping) { $kept.Add($line) }
}

# 标记之外若还有别人写的 ipad-remote 行，宁可停下也不写第二份：两份会让加载器重复挂载。
$stray = @()
for ($index = 0; $index -lt $kept.Count; $index++) {
  if ($kept[$index] -match "id:\s*ipad-remote\s*$" -or $kept[$index] -match "name:.*ipad-remote") {
    $stray += ($index + 1)
  }
}
if ($stray.Count -gt 0) {
  throw ("托管块之外还有 ipad-remote 行（第 " + ($stray -join "、") + " 行）。请先手工删除这些行，再运行本脚本 —— 两份会让插件被重复挂载。原文件未改动。")
}

if (-not $Remove) {
  $kept.Add($start)
  $kept.Add("# 目录选择器：禁用官方自适应（本机回环 + win32 会被判成 native，系统窗口会弹在这台")
  $kept.Add("# 机器的屏幕上）；保留浏览后端但不挂任何「面」——面由插件的浏览器半按页面决定：")
  $kept.Add("# 桌面端有 Electron 桥就注册（走系统文件夹窗口），浏览器没桥就不注册，于是远程不出现")
  $kept.Add("# 「新增工作区」入口。详见 packages/ipad-remote/README.md。")
  $kept.Add("- id: directory-picker")
  $kept.Add("  name: '@deepseek-ai/dsh-host-directory-picker-auto'")
  $kept.Add("  disabled: true")
  $kept.Add("")
  $kept.Add("- insert:")
  $kept.Add("    - id: directory-picker-browse")
  $kept.Add("      name: '@deepseek-ai/dsh-host-directory-picker-browse'")
  $kept.Add("    - id: ipad-remote")
  $kept.Add("      name: '" + $entryUrl + "'")
  $kept.Add($end)
}

New-Item -ItemType Directory -Force -Path $DshHome | Out-Null
Set-Content -Path $patchPath -Value $kept -Encoding utf8
if ($Remove) {
  Write-Host "已移除 dsh-ipad-remote 的托管块（原文件已备份）" -ForegroundColor Green
} else {
  Write-Host "已注册 dsh-ipad-remote" -ForegroundColor Green
  Write-Host ("  插件入口 : " + $entryUrl)
  Write-Host ("  patch    : " + $patchPath)
  Write-Host ""
  Write-Host "重启 DeepSeek Harness 桌面端后生效。" -ForegroundColor Yellow
}

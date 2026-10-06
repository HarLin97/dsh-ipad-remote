<#
.SYNOPSIS
  启动一个带 ipad-remote 插件的独立 Harness 实例，供 iPad 连接。

.DESCRIPTION
  用独立的 DSH_HOME，不碰你的 desktop profile，也不会干扰正在运行中的桌面端。

.EXAMPLE
  .\scripts\start-standalone.ps1 -HarnessCheckout <harness checkout> -Pin <your 6-digit PIN>
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidatePattern('^[0-9]{6}$')][string]$Pin,
  [int]$HarnessPort = 50080,
  [int]$GatewayPort = 50070,
  [string]$HarnessCheckout,
  [string]$Home = (Join-Path $PSScriptRoot '..\.run-home')
)

$ErrorActionPreference = 'Stop'
$repo = Resolve-Path (Join-Path $PSScriptRoot '..')
$overlay = Join-Path $repo '.run-overlay.yml'
$Home = [System.IO.Path]::GetFullPath($Home)

if (-not (Test-Path $overlay)) { throw "缺少 $overlay" }
if (-not (Test-Path (Join-Path $HarnessCheckout 'apps\cli\src\bin.ts'))) { throw "Harness checkout 不存在: $HarnessCheckout" }

# 让这个实例有可用的凭据与设置（只读复制，不动原文件）。
New-Item -ItemType Directory -Force -Path $Home | Out-Null
foreach ($f in @('.credentials.yaml', 'settings.yaml.imported')) {
  $source = Join-Path $env:USERPROFILE ".dsh\$f"
  if ((Test-Path $source) -and -not (Test-Path (Join-Path $Home $f))) { Copy-Item $source (Join-Path $Home $f) }
}

Write-Host "Harness:  http://127.0.0.1:$HarnessPort/" -ForegroundColor Cyan
Write-Host "iPad 用:  http://<本机局域网IP>:$GatewayPort/   PIN: $Pin" -ForegroundColor Green
Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
  Where-Object { $_.IPAddress -notmatch '^127\.|^169\.254\.' } |
  ForEach-Object { Write-Host "          http://$($_.IPAddress):$GatewayPort/  ($($_.InterfaceAlias))" }

$env:DSH_HOME = $Home
Set-Location $HarnessCheckout
$job = Start-Job -ScriptBlock {
  param($home, $checkout, $overlay, $port)
  $env:DSH_HOME = $home
  Set-Location $checkout
  node --import tsx/esm apps/cli/src/bin.ts --patch $overlay --profile web --no-open --port $port
} -ArgumentList $Home, $HarnessCheckout, $overlay, $HarnessPort

# 等控制面就绪后设置 PIN 并开启网关。
$control = "http://127.0.0.1:$HarnessPort/ipad-remote/api"
$ready = $false
foreach ($attempt in 1..60) {
  Start-Sleep -Milliseconds 1000
  try {
    Invoke-RestMethod -Uri "$control/status" -TimeoutSec 3 | Out-Null
    $ready = $true
    break
  } catch { }
}
if (-not $ready) {
  Write-Host "插件未在 60 秒内就绪。Harness 输出：" -ForegroundColor Red
  Receive-Job $job
  throw '启动失败'
}

Invoke-RestMethod -Method Post -Uri "$control/pin" -ContentType 'application/json' -Body (@{ pin = $Pin } | ConvertTo-Json) | Out-Null
$status = Invoke-RestMethod -Method Post -Uri "$control/enable" -ContentType 'application/json' -Body '{"enabled":true}'
Write-Host "网关已开启：listening=$($status.listening) port=$($status.port)" -ForegroundColor Green
Write-Host "按 Ctrl+C 停止监听（Harness 会继续在后台运行，用 Get-Job / Stop-Job 管理）。"
Receive-Job $job -Wait

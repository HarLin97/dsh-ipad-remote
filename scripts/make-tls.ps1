<#
.SYNOPSIS
  签发网关 HTTPS 监听所需的本地 CA 与服务器证书。

.DESCRIPTION
  生成两组文件：ca.key.pem / ca.crt.pem（本地 CA）与 server.key.pem / server.crt.pem
  （服务器证书，SAN 覆盖本机当前所有局域网 IPv4 与主机名）。

  默认沿用已存在的 CA，只重签服务器证书：换 IP、续期都不需要设备重新信任。
  需要 openssl（装 Git for Windows 即自带），或用 -OpenSsl 指定路径。

.EXAMPLE
  .\scripts\make-tls.ps1
  .\scripts\make-tls.ps1 -Force
  .\scripts\make-tls.ps1 -ExtraHost dsh.example.lan
#>
[CmdletBinding()]
param(
  [string]$DshHome = (Join-Path $env:USERPROFILE ".dsh"),
  [string]$Out,
  [string[]]$ExtraHost = @(),
  [string]$OpenSsl,
  [switch]$Force
)

$ErrorActionPreference = "Stop"
if (-not $Out) { $Out = Join-Path $DshHome "plugins\ipad-remote\tls" }

# ---- locate openssl --------------------------------------------------------
$candidates = @()
if ($OpenSsl) { $candidates += $OpenSsl }
$candidates += "C:\Program Files\Git\usr\bin\openssl.exe"
$candidates += "C:\Program Files\Git\mingw64\bin\openssl.exe"
$exe = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $exe) {
  $found = Get-Command openssl -ErrorAction SilentlyContinue
  if ($found) { $exe = $found.Source }
}
if (-not $exe) { throw "未找到 openssl：请安装 Git for Windows，或用 -OpenSsl <路径> 指定" }

# ---- the names the certificate must cover ----------------------------------
$ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch "^127\.|^169\.254\." } | Select-Object -ExpandProperty IPAddress)
$names = @("localhost", $env:COMPUTERNAME) + $ExtraHost | Where-Object { $_ } | Select-Object -Unique
$alt = @("DNS:localhost", "IP:127.0.0.1")
foreach ($name in $names) { if ($name -ne "localhost") { $alt += ("DNS:" + $name) } }
foreach ($ip in $ips) { $alt += ("IP:" + $ip) }
$altText = ($alt -join ",")
$cn = $names[1]
if (-not $cn) { $cn = "localhost" }

New-Item -ItemType Directory -Force -Path $Out | Out-Null
$caKey = Join-Path $Out "ca.key.pem"
$caCrt = Join-Path $Out "ca.crt.pem"
$srvKey = Join-Path $Out "server.key.pem"
$srvCsr = Join-Path $Out "server.csr.pem"
$srvCrt = Join-Path $Out "server.crt.pem"
$extFile = Join-Path $Out "server.ext"

Write-Host ("openssl : " + $exe)
Write-Host ("material: " + $Out)
Write-Host ("SAN     : " + $altText)

# ---- CA (kept unless -Force) -----------------------------------------------
if ($Force -or -not (Test-Path $caKey) -or -not (Test-Path $caCrt)) {
  Write-Host "签发本地 CA ..." -ForegroundColor Cyan
  & $exe req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 -keyout $caKey -out $caCrt -subj "/CN=DSH iPad Remote Local CA" -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "签发 CA 失败" }
} else {
  Write-Host "CA 已存在，沿用（换 IP 不需要设备重新信任）" -ForegroundColor DarkGray
}

# ---- server certificate (always re-issued so the SANs track the addresses) --
Write-Host "签发服务器证书 ..." -ForegroundColor Cyan
& $exe req -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -keyout $srvKey -out $srvCsr -subj ("/CN=" + $cn) 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "生成服务器 CSR 失败" }

$ext = @(
  "basicConstraints=CA:FALSE",
  "keyUsage=critical,digitalSignature,keyEncipherment",
  "extendedKeyUsage=serverAuth",
  ("subjectAltName=" + $altText)
)
$ext | Set-Content -Path $extFile -Encoding ascii
& $exe x509 -req -in $srvCsr -CA $caCrt -CAkey $caKey -CAcreateserial -out $srvCrt -days 397 -extfile $extFile 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "签发服务器证书失败" }
Remove-Item $srvCsr -Force -ErrorAction SilentlyContinue

# ---- report ----------------------------------------------------------------
Write-Host ""
Write-Host "完成。文件：" -ForegroundColor Green
Get-ChildItem $Out -File | Where-Object { $_.Name -notlike "*.srl" } | ForEach-Object { Write-Host ("  " + $_.Name + "  " + $_.Length + "B") }
Write-Host ""
Write-Host "下一步：" -ForegroundColor Yellow
Write-Host "  1) 重启桌面端 DeepSeek Harness：插件启动时读取证书，之后网关同时监听 HTTP 与 HTTPS"
Write-Host "  2) 设备首次访问会提示证书不受信任，先装根证书（Safari 打开 https://<地址>:50071/__ipad-remote/ca.crt 可直接下载）："
Write-Host "     iOS/iPadOS : 安装描述文件 -> 设置 > 通用 > 关于本机 > 证书信任设置 -> 打开完全信任"
Write-Host "     Android    : 设置 > 安全 > 加密与凭据 > 安装证书 > CA 证书 -> 选择下载的 ca.crt"
Write-Host "     Windows    : 双击 ca.crt.pem -> 安装证书 -> 本地计算机 -> 受信任的根证书颁发机构"
Write-Host "     macOS      : 双击 -> 钥匙串访问 -> 系统 -> 始终信任"
Write-Host "  3) 再用 https://<地址>:50071/ 打开，iOS 用「添加到主屏幕」、Android/桌面用「安装应用」"
Write-Host ""
Write-Host ("证书到期：" + (Get-Date).AddDays(397).ToString("yyyy-MM-dd") + "（重跑本脚本即可续期，设备无需重新信任）") -ForegroundColor DarkGray

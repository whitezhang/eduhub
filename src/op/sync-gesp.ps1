# 把本机 parsed JSON 推到云主机并导入。不同步 PDF。
# 用法: .\src\op\sync-gesp.ps1 -Remote root@1.2.3.4
param(
  [Parameter(Mandatory = $true)][string]$Remote,
  [string]$RemoteRoot = "/root/deploy/eduhub"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$localJson = Join-Path $root "src/rd/server/data/seed/gesp"
$remoteJson = "$RemoteRoot/src/rd/server/data/seed/gesp"

if (-not (Test-Path $localJson)) {
  throw "找不到 $localJson ，先在本机运行: python src/op/gesp_import.py --no-import"
}

Write-Host "==> push parsed JSON -> ${Remote}:${remoteJson}"
ssh $Remote "mkdir -p '$remoteJson'"
scp -r "$localJson/*" "${Remote}:${remoteJson}/"
Write-Host "==> import on remote"
ssh $Remote "cd '$RemoteRoot' && python3 src/op/gesp_import.py --skip-crawl"
Write-Host "sync-gesp done."

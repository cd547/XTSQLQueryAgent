# 将 frontend/dist 同步到鸿蒙工程 resfile/web（打包本地前端）
# 说明：ArkWeb 用 file:// + setPathAllowingUniversalAccess 加载 resfile 目录，
#       解决 resource://rawfile 跨域拦截 ES module 导致的白屏问题
# 用法：powershell -ExecutionPolicy Bypass -File sync-frontend.ps1
$dist = Join-Path $PSScriptRoot "..\frontend\dist"
$dest = Join-Path $PSScriptRoot "entry\src\main\resources\resfile\web"
$oldDest = Join-Path $PSScriptRoot "entry\src\main\resources\rawfile\web"

if (-not (Test-Path (Join-Path $dist "index.html"))) {
    Write-Error "未找到 $dist\index.html，请先在 frontend 目录执行 npm run build"
    exit 1
}

if (Test-Path $oldDest) {
    Remove-Item -Recurse -Force $oldDest
    Write-Output "已清理旧目录 $oldDest"
}

if (Test-Path $dest) {
    Remove-Item -Recurse -Force $dest
}
New-Item -ItemType Directory -Path $dest | Out-Null
Copy-Item -Path (Join-Path $dist "*") -Destination $dest -Recurse
$count = (Get-ChildItem -Recurse -File $dest | Measure-Object).Count
Write-Output "已同步 $count 个文件到 $dest"

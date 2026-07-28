# render-all.ps1 - Render all mermaid blocks in docs/执行流程.md to PNG via mermaid.ink

$ErrorActionPreference = "Stop"
$mdFile = Join-Path $PSScriptRoot "..\执行流程.md"
$imgDir = Join-Path $PSScriptRoot "."

# Write this script as UTF-8 with BOM so PowerShell reads Chinese paths correctly
$utf8Bom = New-Object System.Text.UTF8Encoding($true)
[System.IO.File]::WriteAllText($PSCommandPath, (Get-Content $PSCommandPath -Raw), $utf8Bom)

$content = Get-Content $mdFile -Raw -Encoding UTF8

# Find all mermaid code blocks
$matches = [regex]::Matches($content, '(?ms)```mermaid\s*\n(.*?)\n```')
Write-Host "Found $($matches.Count) mermaid blocks"

$imgPaths = @()
for ($i = 0; $i -lt $matches.Count; $i++) {
  $code = $matches[$i].Groups[1].Value
  $imgName = "diagram-{0:D2}.png" -f ($i + 1)
  $imgPath = Join-Path $imgDir $imgName
  $relPath = "images/$imgName"

  $bytes = [System.Text.Encoding]::UTF8.GetBytes($code)
  # URL-safe base64: + -> -, / -> _, strip = padding
  # (mermaid.ink 解析标准 base64 时把末尾 == 当成 URL 参数分隔符导致 404)
  $b64 = [Convert]::ToBase64String($bytes).Replace('+', '-').Replace('/', '_').TrimEnd('=')
  $url = "https://mermaid.ink/img/$b64" + "?type=png&bgColor=white"

  Write-Host "[$($i+1)] $imgName (code=$($code.Length) bytes)..." -NoNewline
  try {
    $r = [System.Net.HttpWebRequest]::Create($url)
    $r.Timeout = 60000
    $r.UserAgent = "PowerShell/5.1"
    $resp = $r.GetResponse()
    $stream = $resp.GetResponseStream()
    $fs = [System.IO.File]::Create($imgPath)
    $stream.CopyTo($fs)
    $fs.Close()
    $stream.Close()
    $resp.Close()
    $file = Get-Item $imgPath
    Write-Host " OK ($($file.Length) bytes)" -ForegroundColor Green
    $imgPaths += $relPath
  } catch {
    Write-Host " FAIL: $($_.Exception.Message)" -ForegroundColor Red
    $imgPaths += $null
  }
}

Write-Host ""
Write-Host "Replacing mermaid blocks with image embeds..."
$newContent = $content
for ($i = $matches.Count - 1; $i -ge 0; $i--) {
  if ($imgPaths[$i]) {
    $oldBlock = $matches[$i].Groups[0].Value
    $caption = "Diagram $($i+1)"
    $replacement = "![$caption]($($imgPaths[$i]))"
    $newContent = $newContent.Substring(0, $matches[$i].Index) + $replacement + $newContent.Substring($matches[$i].Index + $oldBlock.Length)
  }
}

[System.IO.File]::WriteAllText($mdFile, $newContent, $utf8Bom)
Write-Host "Updated $mdFile"
Write-Host ""
Write-Host "=== Final image files ==="
Get-ChildItem $imgDir -Filter "*.png" | ForEach-Object { Write-Host "  $($_.Name) - $($_.Length) bytes" }

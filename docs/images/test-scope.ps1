$baseUrl = "https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image"

function Test {
  $url = "$baseUrl?test=1"
  Write-Host "URL: $url"
  try {
    $r = [System.Net.HttpWebRequest]::Create($url)
    Write-Host "OK"
  } catch {
    Write-Host "Error: $($_.Exception.Message)"
  }
}

Test

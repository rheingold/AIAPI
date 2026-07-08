$ErrorActionPreference = 'Stop'
$body = @{
  jsonrpc = '2.0'
  id = 95
  method = 'tools/call'
  params = @{
    name = 'AutomateUI'
    arguments = @{
      helper = 'NativeWin'
      action = 'FETCH_WEBPAGE_RENDER'
      proc = 'https://www.google.com/search?q=idos.cz+tramvaj+2+Stara+osada+Brno+odjezdy'
      value = (@{ headless = $false; background = $false; waitMs = 2500 } | ConvertTo-Json -Compress)
    }
  }
} | ConvertTo-Json -Depth 8 -Compress

try {
  $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:4457/mcp' -Method POST -ContentType 'application/json' -TimeoutSec 180 -Body $body
  $resp | ConvertTo-Json -Depth 8 -Compress | Out-File -FilePath "$env:TEMP\google-render-final.json" -Encoding utf8
  Write-Host "REQUEST COMPLETED"
} catch {
  Write-Host "REQUEST FAILED: $($_.Exception.Message)"
}

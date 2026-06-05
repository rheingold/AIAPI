# One-shot deploy: stop service, copy exe, restart
$serviceName = "AIAPIService"
$src = "C:\Users\plachy\Documents\Dev\VSCplugins\AIAPI\dist\release\aiapi-server.exe"
$dest = "C:\Program Files\AIAPI\aiapi-server.exe"

Write-Host "Stopping $serviceName..."
Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
Start-Sleep -Seconds 3

Write-Host "Copying exe..."
Copy-Item -Path $src -Destination $dest -Force
Write-Host "Copied: $((Get-Item $dest).LastWriteTime)  $((Get-Item $dest).Length) bytes"

Write-Host "Starting $serviceName..."
Start-Service -Name $serviceName
Start-Sleep -Seconds 5
Write-Host "Service status: $((Get-Service -Name $serviceName).Status)"

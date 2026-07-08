# Test script to verify that the AIAPIService is running and responding
Write-Host "Testing AIAPIService..."

try {
    # Check if service is running
    $service = Get-Service -Name AIAPIService -ErrorAction Stop
    Write-Host "Service Status: $($service.Status)"
    
    if ($service.Status -eq "Running") {
        Write-Host "✓ Service is running"
        
        # Test basic connectivity to MCP port (4457)
        $port = 4457
        $tcpClient = New-Object System.Net.Sockets.TcpClient
        $result = $tcpClient.ConnectAsync("localhost", $port)
        $tcpClient.Close()
        
        if ($result.Wait(1000)) {
            Write-Host "✓ Service is listening on port $port"
        } else {
            Write-Host "✗ Service not responding on port $port"
        }
    } else {
        Write-Host "✗ Service is not running"
    }
} catch {
    Write-Host "Error: $_"
}

Write-Host "Test completed."
$root = "c:\Users\plachy\Documents\Dev\VSCplugins\AIAPI"
$files = Get-ChildItem $root -Recurse -Filter "scenarios.xml" | Where-Object { $_.FullName -notmatch "node_modules" }
$count = 0
foreach ($f in $files) {
    $c = [System.IO.File]::ReadAllText($f.FullName)
    $orig = $c
    $c = $c.Replace('<steps>', '<Steps>')
    $c = $c.Replace('</steps>', '</Steps>')
    $c = $c.Replace('</step>', '</Step>')
    $c = $c.Replace('<step/>', '<Step/>')
    $c = $c.Replace('<description lang=', '<Description lang=')
    $c = $c.Replace('<description>', '<Description>')
    $c = $c.Replace('</description>', '</Description>')
    $c = [System.Text.RegularExpressions.Regex]::Replace($c, '<step ', '<Step ')
    if ($c -ne $orig) {
        [System.IO.File]::WriteAllText($f.FullName, $c)
        $count++
        Write-Host "Updated: $($f.FullName)"
    } else {
        Write-Host "No change: $($f.FullName)"
    }
}
Write-Host "Done - $count files updated"

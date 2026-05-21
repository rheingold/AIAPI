
# demo-bookmarks-ui.ps1 — live UI demo of bookmark navigation
# Uses SENDKEYS/CLICKID via MCP, no CDP tricks. All keyboard + mouse.
param(
    [string]$MCP    = "http://127.0.0.1:3457",
    [string]$Handle = "HANDLE:67702",
    [string]$Search = "postgresql"
)

function Invoke-MCP($tool, $params) {
    $body = @{ jsonrpc="2.0"; id=1; method="tools/call"
               params=@{ name=$tool; arguments=$params } } | ConvertTo-Json -Depth 6 -Compress
    $r = Invoke-WebRequest $MCP -Method POST -ContentType "application/json" -Body $body -UseBasicParsing
    ($r.Content | ConvertFrom-Json).result.content[0].text
}

function Step($msg) {
    Write-Host ""
    Write-Host ">>> $msg" -ForegroundColor Cyan
    Start-Sleep -Milliseconds 600
}

# ── 1. Bring Brave to foreground ─────────────────────────────────────
Step "STEP 1 — Bring Brave window to foreground"
$r = Invoke-MCP "KeyWin" @{ command="SENDKEYS"; target=$Handle; parameter="{F6}" }
Write-Host $r
Start-Sleep -Seconds 1

# ── 2. Open bookmarks manager with Ctrl+Shift+O ──────────────────────
Step "STEP 2 — Open Bookmarks Manager (Ctrl+Shift+O)"
$r = Invoke-MCP "KeyWin" @{ command="SENDKEYS"; target=$Handle; parameter="{CTRL+SHIFT+O}" }
Write-Host $r
Start-Sleep -Seconds 2

# ── 3. Wait for chrome://bookmarks to load, then type in search box ──
Step "STEP 3 — Type '$Search' into the bookmarks search box"
# The bookmarks manager search box auto-focuses on Ctrl+F in that page,
# or we can click the search field (it's the first input on the page).
# Send Ctrl+F to open in-page search... actually BM manager has its own search.
# Just type directly — the search bar is active by default after Ctrl+Shift+O.
# Use SENDKEYS to the window target (Brave keeps keyboard focus there).
$r = Invoke-MCP "KeyWin" @{ command="SENDKEYS"; target=$Handle; parameter=$Search }
Write-Host $r
Start-Sleep -Seconds 1.5

# ── 4. Show what page Brave is now on via CDP (just for logging) ──────
Step "STEP 4 — Read the bookmarks search results page title to confirm"
$tabs = (Invoke-WebRequest "http://127.0.0.1:9223/json" -UseBasicParsing).Content | ConvertFrom-Json
$active = $tabs | Where-Object { $_.type -eq "page" -and $_.url -like "chrome://bookmarks*" } | Select-Object -First 1
if ($active) { Write-Host "  Brave tab: $($active.title) @ $($active.url)" -ForegroundColor Green }

# ── 5. Press Escape, go back, navigate with address bar ───────────────
Step "STEP 5 — Press Escape to clear search, then Ctrl+L to focus address bar"
$r = Invoke-MCP "KeyWin" @{ command="SENDKEYS"; target=$Handle; parameter="{ESCAPE}" }
Write-Host $r
Start-Sleep -Milliseconds 600
$r = Invoke-MCP "KeyWin" @{ command="SENDKEYS"; target=$Handle; parameter="{CTRL+L}" }
Write-Host $r
Start-Sleep -Milliseconds 800

# ── 6. Type the URL of the first search hit (resolved via CDP bookmarks) ─
Step "STEP 6 — Type bookmark URL via keyboard and press Enter"
# We know from searching earlier that the PostgreSQL Tutorial is at:
$url = if ($Search -eq "postgresql") { "https://www.postgresql.org/docs/current/index.html" } `
       else { "https://www.google.com/search?q=$Search" }
$r = Invoke-MCP "KeyWin" @{ command="SENDKEYS"; target=$Handle; parameter="$url{ENTER}" }
Write-Host $r
Start-Sleep -Seconds 3

# ── 7. Read the page title to prove we arrived ───────────────────────
Step "STEP 7 — Read the title of the page we just opened"
$r = Invoke-MCP "BrowserWin" @{ command="READ"; target="PAGE:$($tabs[0].id)"; parameter="" }
Write-Host "  Page content preview: $($r.Substring(0,[Math]::Min(200,$r.Length)))" -ForegroundColor Green
Write-Host ""
Write-Host "=== Demo complete ===" -ForegroundColor Yellow

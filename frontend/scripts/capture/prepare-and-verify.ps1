param([switch]$Hold)
$ErrorActionPreference = 'Stop'
$frontendRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$os = Get-CimInstance Win32_OperatingSystem
$freeGiB = $os.FreePhysicalMemory / 1MB
$cpuLoad = (Get-CimInstance Win32_Processor).LoadPercentage
if ($freeGiB -lt 3 -or ($null -ne $cpuLoad -and $cpuLoad -gt 65)) {
    throw ('Resource guard: need at least 3 GiB free RAM and CPU <=65%; free={0:N2} GiB CPU={1}. No build/browser/recording started.' -f $freeGiB,$cpuLoad)
}
if (Get-NetTCPConnection -LocalPort 3217 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 3217 is in use; refusing to connect to or stop an existing server.'
}
# Clear inherited operational configuration in this child shell, then set loopback-only public config.
Get-ChildItem Env: | Where-Object {
    $_.Name -match 'KEY|TOKEN|SECRET|PASSWORD|SMTP|BYOK|DELEGATION|DATASOURCE|DATABASE|^DB_|^VERCEL|^NEXT_PUBLIC_'
} | ForEach-Object { Remove-Item -LiteralPath ('Env:' + $_.Name) }
$env:NEXT_PUBLIC_API_BASE_URL = 'http://localhost:8080'
$env:NEXT_PUBLIC_SITE_URL = 'http://127.0.0.1:3217'
$env:PLAYWRIGHT_BASE_URL = 'http://127.0.0.1:3217'
$env:NEXT_TELEMETRY_DISABLED = '1'
$env:NODE_OPTIONS = '--max-old-space-size=768'
Push-Location -LiteralPath $frontendRoot
try {
    & node --test tests/capture-network-guard.test.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Network isolation checks failed.' }
    & node node_modules/next/dist/bin/next build --webpack
    if ($LASTEXITCODE -ne 0) { throw 'Isolated frontend build failed.' }
    $nodeExe = (Get-Command node).Source
    $server = Start-Process -FilePath $nodeExe -WorkingDirectory $frontendRoot -WindowStyle Hidden -PassThru -ArgumentList @('node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3217')
    try {
        $ready = $false
        for ($attempt = 0; $attempt -lt 30; $attempt++) {
            if ($server.HasExited) { throw 'Our isolated frontend server exited.' }
            try { Invoke-WebRequest -Uri 'http://127.0.0.1:3217/workspace' -TimeoutSec 2 -UseBasicParsing | Out-Null; $ready=$true; break } catch { Start-Sleep -Milliseconds 500 }
        }
        if (-not $ready) { throw 'Isolated server startup timed out.' }
        if ($Hold) { & node scripts/capture/workspace-demo.mjs --hold } else { & node scripts/capture/workspace-demo.mjs }
        if ($LASTEXITCODE -ne 0) { throw 'Isolated browser verification failed.' }
    } finally {
        # Only the exact server process started above. Never stop another task's server.
        if (-not $server.HasExited) { Stop-Process -Id $server.Id }
    }
} finally { Pop-Location }

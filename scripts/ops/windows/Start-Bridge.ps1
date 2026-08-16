param(
  [string]$RepositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")),
  [string]$NodeExecutable = "node.exe",
  [string]$BridgeEntry
)
$ErrorActionPreference = "Stop"
$root = [System.IO.Path]::GetFullPath($RepositoryRoot)
$runtimeLogs = Join-Path $root "apps\bridge\runtime\logs"
$outputLog = Join-Path $runtimeLogs "bridge-background.log"
$maxBytes = 1048576
New-Item -ItemType Directory -Path $runtimeLogs -Force | Out-Null

function Write-BridgeBackgroundLog {
  param([string]$Event, [hashtable]$Detail = @{})
  if ((Test-Path -LiteralPath $outputLog) -and (Get-Item -LiteralPath $outputLog).Length -ge $maxBytes) {
    Move-Item -LiteralPath $outputLog -Destination "$outputLog.1" -Force
  }
  $record = [ordered]@{ timestamp = (Get-Date -Format o); event = $Event }
  foreach ($key in $Detail.Keys) {
    if ($key -notmatch '(?i)token|secret|authorization|password') { $record[$key] = $Detail[$key] }
  }
  Add-Content -LiteralPath $outputLog -Value ($record | ConvertTo-Json -Compress)
}

if ([string]::IsNullOrWhiteSpace($BridgeEntry)) {
  $BridgeEntry = Join-Path $root "apps\bridge\dist\index.js"
}
$BridgeEntry = [System.IO.Path]::GetFullPath($BridgeEntry)
$exitCode = 1
Set-Location -LiteralPath $root

try {
  if (-not (Test-Path -LiteralPath $BridgeEntry -PathType Leaf)) {
    throw "Compiled Bridge entry point not found: $BridgeEntry. Reinstall the scheduled task to prepare it."
  }
  $node = (Get-Command $NodeExecutable -CommandType Application -ErrorAction Stop).Source
  Write-BridgeBackgroundLog "LAUNCHER_STARTED" @{ bridgeEntry = $BridgeEntry; processOwner = "WAITING" }
  & $node $BridgeEntry 2>&1 | ForEach-Object {
    Write-BridgeBackgroundLog "BRIDGE_OUTPUT" @{ message = [string]$_ }
  }
  $exitCode = $LASTEXITCODE
  if ($null -eq $exitCode) { $exitCode = 1 }
  Write-BridgeBackgroundLog "BRIDGE_PROCESS_EXITED" @{ exitCode = $exitCode }
} catch {
  $exitCode = 1
  Write-BridgeBackgroundLog "LAUNCHER_FAILED" @{ error = $_.Exception.Message; exitCode = $exitCode }
} finally {
  Write-BridgeBackgroundLog "LAUNCHER_EXITING" @{ exitCode = $exitCode }
}
exit $exitCode

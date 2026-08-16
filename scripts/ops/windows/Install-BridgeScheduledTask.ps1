param([string]$TaskName = "ChatGPT Local Orchestrator Bridge")
$ErrorActionPreference = "Stop"
$repositoryRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$packages = @(
  "@local-orchestrator/contracts",
  "@local-orchestrator/projects",
  "@local-orchestrator/orchestrator",
  "@local-orchestrator/bridge"
)
Push-Location -LiteralPath $repositoryRoot
try {
  foreach ($package in $packages) {
    & pnpm.cmd --filter $package build
    if ($LASTEXITCODE -ne 0) { throw "Failed to prepare $package for background Bridge startup (exit $LASTEXITCODE)." }
  }
} finally {
  Pop-Location
}
$launcher = (Resolve-Path (Join-Path $PSScriptRoot "Start-Bridge.ps1")).Path
$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$launcher`""
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description "Starts the project-owned ChatGPT Local Orchestrator Bridge launcher at user logon." -Force | Out-Null
Write-Host "Installed current-user scheduled task: $TaskName"

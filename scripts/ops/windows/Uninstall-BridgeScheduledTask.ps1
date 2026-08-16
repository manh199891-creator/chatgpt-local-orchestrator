param([string]$TaskName = "ChatGPT Local Orchestrator Bridge")
$ErrorActionPreference = "Stop"
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($null -ne $task) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
Write-Host "Removed scheduled task if present: $TaskName"

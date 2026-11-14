# 로그온할 때 라벨 에이전트가 자동으로 뜨도록 예약 작업을 등록한다. 관리자 PowerShell에서 한 번 실행한다.
# 인쇄 로그(PrintService/Operational)도 여기서 켠다(기본은 꺼져 있다).
# 로그온할 때 뜨는 작업이라, 프린터 PC가 로그온 화면에 머물러 있으면 에이전트도 안 돈다(자동 로그온을 쓰거나 로그온해 둔다).
#   .\install-task.ps1            등록
#   .\install-task.ps1 -Remove    제거
param([switch]$Remove)

$ErrorActionPreference = 'Stop'
$taskName = 'AgeLabelAgent'
$script = Join-Path $PSScriptRoot 'label-agent.ps1'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
  Write-Host "작업 '$taskName'을 제거했습니다."
  return
}

if (-not (Test-Path (Join-Path $PSScriptRoot 'agent.config.json'))) { throw 'agent.config.json이 없습니다. agent.config.example.json을 복사해 값을 채운 뒤 다시 실행하세요.' }

wevtutil sl 'Microsoft-Windows-PrintService/Operational' /e:true
if ($LASTEXITCODE -ne 0) { throw '인쇄 로그를 켜지 못했습니다. 관리자 권한 PowerShell에서 실행했는지 확인하세요.' }
Write-Host '인쇄 로그(PrintService/Operational)를 켰습니다.'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description '라벨 인쇄 완료를 대시보드에 알립니다' -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Host "작업 '$taskName'을 등록하고 시작했습니다. 상태 확인: Get-ScheduledTask -TaskName $taskName"

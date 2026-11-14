# 라벨 출력 에이전트 — 프린터가 연결된 Windows PC에서 돌린다.
# Windows 인쇄 완료 이벤트(PrintService/Operational, 이벤트 307)에서 'AGE-LABEL-<작업 id>' 문서를 찾아,
# 대시보드 DB의 confirm_label_print 함수에 "이 작업 N장 인쇄됨"을 알린다. 설치·등록은 README.md 참고.
#
# 주의(2026-11-14): 이 스크립트는 프린터 PC에서 실제로 돌려 보지 못했다(개발 PC에 Windows·PowerShell이 없다).
#   처음 설치할 때 README의 "확인 순서"를 꼭 따라 하고, 특히 라벨을 뺀 상태·커버를 연 상태에서 307 이벤트가 어떻게 찍히는지 확인한다.

param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot 'agent.config.json')
)

$ErrorActionPreference = 'Stop'
# 오래된 Windows PowerShell 5.1은 TLS 1.2가 기본이 아닐 수 있다.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$logName = 'Microsoft-Windows-PrintService/Operational'
# src/lib/labels/print-job.ts의 JOB_TITLE_PATTERN과 같아야 한다.
$jobPattern = 'AGE-LABEL-([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})'

function Write-Log([string]$message) {
  Write-Host ('{0:yyyy-MM-dd HH:mm:ss} {1}' -f (Get-Date), $message)
}

if (-not (Test-Path $ConfigPath)) { throw "설정 파일이 없습니다: $ConfigPath (agent.config.example.json을 복사해 만드세요)" }
$config = Get-Content -Raw -Encoding UTF8 $ConfigPath | ConvertFrom-Json
foreach ($key in 'supabaseUrl', 'anonKey', 'secret') {
  if ([string]::IsNullOrWhiteSpace($config.$key)) { throw "설정 파일에 $key 값이 없습니다." }
}
$baseUrl = $config.supabaseUrl.TrimEnd('/')
$pollSeconds = if ($config.pollSeconds) { [int]$config.pollSeconds } else { 3 }
$printerFilter = $config.printerName   # 비워 두면 모든 프린터의 작업을 본다
$statePath = Join-Path $PSScriptRoot 'agent.state.json'

# 이미 처리한 시점부터 이어 읽는다. 처음에는 지금부터(옛 이벤트로 옛 작업을 확정하지 않는다).
$lastTime = Get-Date
if (Test-Path $statePath) {
  try { $lastTime = [datetime]::Parse((Get-Content -Raw $statePath | ConvertFrom-Json).lastTime) } catch { Write-Log '상태 파일을 읽지 못해 지금부터 시작합니다.' }
}
$seenRecordIds = New-Object 'System.Collections.Generic.HashSet[long]'

function Save-State([datetime]$time) {
  @{ lastTime = $time.ToString('o') } | ConvertTo-Json | Set-Content -Encoding UTF8 $statePath
}

function Confirm-Job([string]$jobId, [int]$pages) {
  $body = @{ p_job_id = $jobId; p_pages = $pages; p_secret = $config.secret } | ConvertTo-Json
  $headers = @{ apikey = $config.anonKey; Authorization = "Bearer $($config.anonKey)" }
  return Invoke-RestMethod -Method Post -Uri "$baseUrl/rest/v1/rpc/confirm_label_print" -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([System.Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 20
}

Write-Log "라벨 에이전트 시작: $($baseUrl), $($pollSeconds)초마다 확인, 프린터 필터=[$($printerFilter)], 시작 시점=$($lastTime)"

while ($true) {
  try {
    # 307 = 문서가 인쇄됨. Properties: [0]=작업 번호 [1]=문서 이름 [2]=소유자 [3]=컴퓨터 [4]=프린터 [5]=포트 [6]=크기 [7]=인쇄한 페이지 수
    # 이벤트가 하나도 없으면 'No events were found' 오류가 나므로 그것만 걸러 내고, 로그가 꺼져 있거나 권한이 없는 경우는 로그로 남긴다.
    $events = @(Get-WinEvent -FilterHashtable @{ LogName = $logName; Id = 307; StartTime = $lastTime.AddSeconds(-1) } -ErrorAction SilentlyContinue -ErrorVariable listError | Sort-Object TimeCreated)
    foreach ($err in $listError) {
      if ($err.Exception.Message -notmatch 'No events were found') { Write-Log "인쇄 로그를 읽지 못했습니다: $($err.Exception.Message)" }
    }
    $advance = $lastTime
    foreach ($event in $events) {
      if ($seenRecordIds.Contains([long]$event.RecordId)) { continue }
      $props = $event.Properties
      $docName = [string]$props[1].Value
      $printer = [string]$props[4].Value
      $pages = [int]$props[7].Value
      $match = [regex]::Match($docName, $jobPattern)
      if ($match.Success -and ([string]::IsNullOrWhiteSpace($printerFilter) -or $printer -eq $printerFilter)) {
        $jobId = $match.Groups[1].Value.ToLower()
        try {
          $result = Confirm-Job -jobId $jobId -pages $pages
          Write-Log "작업 $($jobId) 확정 요청: $($pages) 페이지, 프린터=$($printer) → $($result.status) $($result.confirmed)"
        } catch {
          # 서버가 요청 자체를 거절한 오류(400·404·409·422 등)는 같은 요청을 되풀이해도 소용없으니 기록만 하고 넘어간다(뒤 이벤트가 막히지 않게).
          # 인증(401·403)·한도(429)·서버(5xx)·네트워크 오류는 일시적이거나 설정 문제이므로 다시 던져서 이 이벤트부터 재시도한다.
          $status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { 0 }
          if ($status -ge 400 -and $status -lt 500 -and $status -notin 401, 403, 429) {
            Write-Log "작업 $($jobId) 확정 거절(HTTP $($status))이라 건너뜁니다: $($_.ErrorDetails.Message)"
          } else {
            throw
          }
        }
      }
      [void]$seenRecordIds.Add([long]$event.RecordId)
      if ($event.TimeCreated -gt $advance) { $advance = $event.TimeCreated }
    }
    if ($advance -gt $lastTime) {
      $lastTime = $advance
      Save-State $lastTime
    }
    if ($seenRecordIds.Count -gt 5000) { $seenRecordIds.Clear() }
  } catch {
    # 네트워크·서버 오류 등: 상태를 앞으로 옮기지 않았으니 다음 주기에 같은 이벤트를 다시 시도한다(함수가 같은 작업의 중복 확정을 막는다).
    Write-Log "오류(다음 주기에 다시 시도합니다): $($_.Exception.Message) $($_.ErrorDetails.Message)"
  }
  Start-Sleep -Seconds $pollSeconds
}

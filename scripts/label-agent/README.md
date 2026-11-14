# 라벨 출력 에이전트

프린터가 연결된 **Windows PC**에서 돌면서, 라벨이 실제로 인쇄되면 대시보드에 알린다. 설정의 "출력 기록 방식"을
"프린터 PC가 인쇄 완료를 확인하면 기록"으로 두었을 때만 쓴다. 설계·한계는 `docs/decisions/2026-11-14-label-print-spooler-confirm.md`.

> **미검증**: 이 에이전트와 307 이벤트 가정은 프린터 PC에서 돌려 보지 못했다. 아래 "확인 순서"를 꼭 따라 하고, 결과가 다르면 이 파일과 결정 문서를 고친다.

## 동작
1. 대시보드가 출력 작업을 만들고 인쇄 창의 문서 제목을 `AGE-LABEL-<작업 id>`로 바꿔 인쇄한다(Chrome이 문서 제목을 인쇄 작업 이름으로 쓴다고 알려져 있다).
2. Windows가 인쇄를 마치면 인쇄 로그에 이벤트 307("문서 … 이(가) … 프린터에서 인쇄됨", 페이지 수 포함)을 남긴다.
3. 에이전트가 307에서 `AGE-LABEL-…` 문서를 찾아 DB 함수 `confirm_label_print(작업 id, 페이지 수, 비밀)`를 부른다.
4. 함수가 앞에서부터 그 페이지 수만큼의 라벨을 "출력"으로 기록한다(바코드 행·출력 이력·출력한 박스 종류).

## 설치 (프린터 PC, 한 번)
1. **마이그레이션 0061 적용**: Supabase SQL 편집기에서 `supabase/migrations/0061_label_print_spooler.sql` 실행.
2. **에이전트 비밀 만들기**: 긴 무작위 문자열(40자 이상)을 만든다. PowerShell의 `Get-Random`은 암호학적 난수가 아니므로 아래처럼 쓴다. 그 값은 PC의 설정 파일에만 두고, DB에는 해시만 넣는다.
   ```powershell
   $b = New-Object byte[] 30; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
   ```
   (이 함수는 anon 키로 누구나 부를 수 있고 시도 횟수 제한이 없다. 비밀이 길고 무작위여야 안전하다.)
   Supabase SQL 편집기에서 (비밀을 바꿔서) 실행:
   ```sql
   insert into label_agent_keys (secret_hash, name)
   values (encode(extensions.digest('여기에 방금 만든 비밀', 'sha256'), 'hex'), '통영 프린터 PC');
   ```
3. **파일 복사**: 이 폴더(`scripts/label-agent`)를 프린터 PC에 복사(예: `C:\label-agent`).
4. **설정 파일**: `agent.config.example.json`을 `agent.config.json`으로 복사해 `supabaseUrl`, `anonKey`(공개 키), `secret`(2번의 비밀)을 채운다. 프린터가 여러 대면 `printerName`에 이름을 적는다.
5. **등록**: 관리자 PowerShell에서 `cd C:\label-agent; .\install-task.ps1`. 인쇄 로그를 켜고, 로그온할 때마다 자동으로 뜨는 예약 작업을 만든다.
6. **켜기**: 대시보드 라벨 설정 → "출력 기록 방식" → "프린터 PC가 인쇄 완료를 확인하면 기록".

## 확인 순서 (처음 한 번, 꼭)
1. 에이전트 창이 없어도 된다. 직접 보려면 `.\label-agent.ps1`을 일반 PowerShell에서 실행하면 로그가 보인다(예약 작업과 동시에 두 개를 돌리지 않는다).
2. **정상 출력**: 라벨 1장을 출력한다. 로그에 `작업 … 확정 요청: 1 페이지 … → printed`가 나오고, 대시보드에서 "출력 확인 중"이 몇 초 안에 "출력"으로 바뀌는지 본다. 안 바뀌면:
   - 이벤트 뷰어 → 응용 프로그램 및 서비스 로그 → Microsoft → Windows → PrintService → Operational에 307이 찍히는지.
   - 307의 "문서 이름"에 `AGE-LABEL-…`이 있는지(없으면 인쇄 작업 이름이 페이지 제목이 아닌 것이다 → 결정 문서의 "작업 이름" 항목을 다시 설계해야 한다).
3. **라벨을 뺀 상태**로 1장 출력(용지 없음): 307이 찍히면서 `printed`가 되는지, 오류로 남는지. 찍힌다면 이 방식은 "프린터로 넘김"까지만 보증한다. 결과를 결정 문서에 적는다.
4. **커버를 연 상태**로 1장, **연속 3장** 출력도 같은 방식으로 본다.
5. 취소: 인쇄 창을 취소하면 아무 일도 없어야 하고, 대시보드는 30분 뒤 "미출력"으로 돌아간다.

## 문제 해결
- 로그에 `unauthorized`(HTTP 401·403 포함): 설정 파일의 `secret`이 DB에 넣은 해시의 원본과 다르다(2번 SQL을 다시 확인).
- 로그에 `permission denied`·`function … does not exist`: 마이그레이션 0061이 적용되지 않았다.
- 대시보드에 "출력 확인 중"만 계속: 에이전트가 안 돈다(`Get-ScheduledTask -TaskName AgeLabelAgent`), 인쇄 로그가 꺼져 있다(`wevtutil gl Microsoft-Windows-PrintService/Operational`), 또는 위 2번.
- 로그에 `확정 거절(HTTP 4xx)이라 건너뜁니다`: 서버가 그 요청을 거절한 것이다(작업 없음·형식 오류 등). 메시지를 확인한다. 반복되는 일시 오류는 로그가 `다음 주기에 다시 시도합니다`로 남는다.
- 급할 때: 라벨 설정에서 "출력 버튼을 누르면 기록"으로 되돌리면 예전 동작이다.

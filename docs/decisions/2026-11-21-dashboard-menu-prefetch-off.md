# 주문 목록에서 메뉴 Link 미리 불러오기 끄기 (2026-11-21)

## 문제
주문 목록(`/dashboard`)에서 화면이 한 번 갱신될 때마다 현재 화면 요청 1건 외에 메뉴 `_rsc` 요청이 7~8건 더 나갔다(2026-11-20 실측에서 "갱신 1회에 `_rsc` 9건").
원인은 설치된 Next 문서(`link.md`, `use-router.md`, `glossary.md`)상 다음과 같다.
- 사이드바·하단 탭 `Link`는 기본값(`prefetch` 자동)이라 화면에 보이면 `loading.js` 경계까지 미리 불러온다(운영 빌드에서만).
- `router.refresh()`와 `revalidatePath`는 Router Cache를 비우므로, 비워질 때마다 화면 안 메뉴 `Link`가 다시 미리 불러온다.
주문 목록은 실시간 갱신·서버 액션으로 갱신이 가장 잦은 화면이다(칠판, 입력 PC).
DB는 병목이 아니라서(앱 쿼리 평균 2~5ms) 요청 수를 줄이는 것이 목표다.

## 결정
`dashboard-shell.tsx`의 사이드바·하단 탭 `Link`에 `prefetch={menuPrefetch}`를 준다. `menuPrefetch`는 `pathname === '/dashboard'`일 때만 `false`, 그 외는 `undefined`(기본값)다.
바꾸지 않은 것: 다른 화면의 미리 불러오기, 메뉴 구성·권한, 줄 높이·`monitor-rows` 규칙, 필기·캔버스 코드, 실시간 갱신 로직(`use-live-refresh`), `staleTimes` 같은 실험 옵션.
쓰지 않은 대안: `staleTimes`(실험 옵션), hover 방식 미리 불러오기(터치에서 동작하지 않음).

## 검증 (이 Mac, 운영 빌드(`next start`), 테스트 DB, `window.next.router.refresh()`로 갱신)
같은 코드에서 `false`를 `undefined`로만 임시로 바꿔 다시 빌드해 수정 전 값을 쟀다. 수정본으로 복원한 뒤 다시 쟀고, 복원한 파일은 처음 검증한 파일과 같다.
| 측정 | 수정 전 | 수정 후 |
|---|---|---|
| `/dashboard`를 열 때 `_rsc` 요청 | 22건 | 1건 |
| 갱신 1번당 `_rsc` 요청 | 8건(`/dashboard` 1 + 메뉴 7) | 1건(`/dashboard`만), 2번 반복해도 같음 |
- 메뉴 클릭 이동: `/dashboard`에서 `/scan`으로 정상 이동(클릭→주소 변경 103ms, 이 값은 미리 불러오기를 켠 상태와 비교하지 않았다).
- 적용 범위: `/scan`으로 이동한 뒤에는 `_rsc` 요청이 다시 발생해 `/dashboard`에서만 꺼진다.
- `tsc --noEmit`, `npm run lint`, `npm test`(665), `npm run build` 통과.

## 확인하지 못한 것
- **칠판(스마트 칠판)에서의 확인**: `/dashboard`에서 다른 메뉴로 이동할 때 로딩이 느려지는지.
- 운영 환경(Vercel)의 실제 요청 수 변화. 이번 측정은 테스트 DB의 로컬 운영 빌드다.
- 배포 후 계측(`perf_events`의 `nav` p50)이 나빠지지 않았는지. `build`(47a0e42 이후 값)로 전후를 비교한다.
- 갱신 때 다른 요청이 더 나가는지는 `/dashboard` 외에는 이번 범위가 아니다.

## 되돌리기
`dashboard-shell.tsx`의 `menuPrefetch` 한 줄과 `Link`의 `prefetch` 속성 두 곳을 되돌리면 된다(PR revert).

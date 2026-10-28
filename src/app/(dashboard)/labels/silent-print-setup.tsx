'use client';
import { useState } from 'react';
import { Copy, Download } from 'lucide-react';

// 웹 페이지는 보안상 브라우저의 인쇄 창을 건너뛸 수 없다(프로그램이 사용자 몰래 프린터로 보내지 못하게 하려는 규칙).
// Chrome은 --kiosk-printing 옵션으로 시작한 창에서만 인쇄 창 없이 기본 프린터로 바로 보낸다. 그래서 이 옵션을 붙여 이 시스템을 여는
// 바로가기를 만들어 준다. 일반 Chrome 창과 섞이지 않도록 별도 프로필(로그인은 이 창에서 한 번만)로 연다.
const PROFILE_NAME = 'age-label-print';

// 한글은 넣지 않는다(메모장 없이 cmd가 코드 페이지에 따라 깨뜨릴 수 있다).
const windowsScript = (url: string) =>
  [
    '@echo off',
    'rem Opens Chrome in kiosk-printing mode: no print dialog, prints straight to the default printer.',
    'set CHROME=chrome',
    'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set CHROME="%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set CHROME="%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    `start "" %CHROME% --user-data-dir="%LOCALAPPDATA%\\${PROFILE_NAME}" --kiosk-printing --app=${url}`,
    '',
  ].join('\r\n');

const macCommand = (url: string) => `open -na "Google Chrome" --args --user-data-dir="$HOME/.${PROFILE_NAME}" --kiosk-printing --app=${url}`;

export function SilentPrintSetup({ topSize, sideSize }: { topSize: string; sideSize: string }) {
  const [copied, setCopied] = useState(false);
  const targetUrl = () => `${window.location.origin}/packing-log`;

  const downloadWindows = () => {
    const blob = new Blob([windowsScript(targetUrl())], { type: 'application/octet-stream' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'age-label-print.bat';
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const copyMac = async () => {
    try {
      await navigator.clipboard.writeText(macCommand(targetUrl()));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt('아래 명령을 복사해서 터미널에 붙여넣으세요.', macCommand(targetUrl()));
    }
  };

  return (
    <details className="lb-guide" open>
      <summary>바로 출력 설정 (출력용 PC에서 처음 한 번)</summary>
      <p className="ak-muted" style={{ margin: '0.5rem 0 0' }}>
        출력 버튼을 누를 때 인쇄 창이 뜨지 않고 바로 프린터로 나가게 합니다. 브라우저 규칙상 이 시스템 화면만으로는 인쇄 창을 건너뛸 수 없어서, 아래 바로가기로 연 창에서만 바로 출력됩니다.
      </p>
      <ol>
        <li>
          <strong>프린터 준비</strong>: 라벨 프린터를 <strong>기본 프린터</strong>로 지정하고, 프린터 기본 설정에서 용지 크기를 라벨 크기({topSize}, {sideSize})로 등록하고 인쇄 여백은 없음(0)으로 둡니다.
        </li>
        <li>
          <strong>바로가기 만들기</strong>: 출력용 PC에서 아래 버튼으로 바로가기를 받습니다.
          <div className="lb-shortcut">
            <button className="ak-btn ak-btn-primary" onClick={downloadWindows}><Download size={14} /> Windows 바로가기 받기 (.bat)</button>
            <button className="ak-btn" onClick={copyMac}><Copy size={14} /> {copied ? '복사했습니다' : 'Mac 명령 복사'}</button>
          </div>
          <span className="ak-muted">Windows는 받은 <code>age-label-print.bat</code>을 바탕화면에 두고 더블클릭합니다. Mac은 복사한 명령을 터미널에 붙여넣어 실행합니다.</span>
        </li>
        <li>
          <strong>한 번 로그인</strong>: 바로가기로 열린 창(별도 Chrome 프로필)에서 이 시스템에 로그인합니다. 이후에는 그대로 유지됩니다.
        </li>
        <li>
          <strong>사용</strong>: 라벨 출력은 항상 이 바로가기로 연 창에서 합니다. 박스 할당 / 라벨 출력의 <strong>출력</strong> 버튼을 누르면 확인 없이 기본 프린터로 나갑니다.
        </li>
      </ol>
      <p className="ak-muted">
        이 창에서는 모든 인쇄가 확인 없이 기본 프린터로 나갑니다. 일반 업무(주문 입력, 대시보드 등)는 평소 쓰는 브라우저에서 하세요. 바로가기를 거치지 않고 열면 예전처럼 인쇄 창이 뜹니다.
      </p>
    </details>
  );
}

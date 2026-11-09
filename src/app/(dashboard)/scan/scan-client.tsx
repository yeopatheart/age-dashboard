'use client';
import '@/components/admin/admin.css';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { AlertTriangle, Camera, CheckCircle2, Check, ChevronDown, Copy, Keyboard, ScanLine, Share2, Undo2, X, XCircle } from 'lucide-react';
import { scanBarcode, undoScan, type ScanResult } from './actions';
import { useCan } from '@/components/permissions-context';
import { playTone, unlockAudio } from '@/lib/sound/tones';
import { cleanShareText } from '@/lib/share-text';
import { buildLoadedListText, NO_TERMINAL, type PackageCount } from '@/lib/scan-share-text';
import { undoneSummary, type UndoneBox } from '@/lib/scan-text';
import type { ScanShareTemplate } from '@/lib/scan-share-template';

export interface ScanCard {
  id: string;
  number: number;
  business: string;
  roundLabel: string | null; // 같은 날 1·2차가 둘 다 있는 업체만(목록에서 같은 이름의 카드를 구분한다)
  terminal: string;
  loaded: number;
  total: number;
  packages: PackageCount; // 합포장을 한 덩이로 센 박스 수(퀵 기사님께 보내는 목록용)
}

interface Banner {
  tone: 'ok' | 'dup' | 'bad';
  title: string;
  detail: string;
  labelId?: string; // 방금 처리한 박스(되돌리기용)
  box?: UndoneBox; // 방금 처리한 박스의 업체·번호·합포장(취소했을 때 무엇을 취소했는지 보여 주려고 함께 들고 있는다)
  seq?: number; // 몇 번째 결과인지(연속으로 같은 색이 나와도 새 스캔임을 알아보게 배너를 다시 그린다)
  count?: number; // 이번 접속에서 상차한 박스 수(성공했을 때만)
  progress?: { loaded: number; total: number }; // 이 업체의 상차 현황(박스를 찾았을 때만)
  done?: boolean; // 방금 이 업체의 마지막 박스까지 상차됨
}

// 최근 스캔 목록의 한 줄. 카메라가 켜져 있을 때는 맨 위 줄에서 방금 스캔을 되돌린다(labelId·box·seq는 되돌리기용).
interface RecentItem {
  time: string;
  text: string;
  tone: Banner['tone'];
  labelId?: string;
  box?: UndoneBox;
  seq?: number;
  undone?: boolean;
}

// 초록 조준선(정사각형, CSS .sc-guide). 카메라는 화면에 그려진 이 상자의 위치를 그대로 읽어 안쪽만 잘라서 읽는다 — 조준선 밖에 보이는 QR은 읽지 않는다.
const SCAN_INTERVAL_MS = 80;
const DUPLICATE_IGNORE_MS = 2500; // 카메라가 같은 QR을 연속으로 읽는 것을 무시하는 시간

// 최근 스캔: 화면 맨 아래에 두고 기본은 접어 둔다. 제목 줄에 마지막 스캔 한 줄만 보이고, 눌러야 기록 전체가 펼쳐진다.
// (방금 스캔을 되돌리는 버튼은 여기가 아니라 영상 바로 아래의 "마지막 스캔" 줄에 있다.)
function RecentList({ items }: { items: RecentItem[] }) {
  const [open, setOpen] = useState(false);
  const latest = items[0];
  return (
    <section className="sc-card sc-recent-card">
      <button type="button" className="sc-recent-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        <strong>최근 스캔</strong>
        <span className={`sc-recent-last sc-r-${latest.tone}`}>{latest.text}{latest.undone ? ' (취소됨)' : ''}</span>
        <ChevronDown size={18} className={open ? 'sc-chev sc-chev-open' : 'sc-chev'} aria-hidden />
      </button>
      {open && (
        <ul className="sc-recent">
          {items.map((r, i) => (
            <li key={`${r.seq ?? 'x'}-${i}`} className={`sc-r-${r.tone}`}>
              <span>{r.time}</span>
              <em>{r.text}{r.undone ? ' (취소됨)' : ''}</em>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ScanClient({ orderDate, today, cards, shareTemplate }: { orderDate: string; today: string; cards: ScanCard[]; shareTemplate: ScanShareTemplate }) {
  const can = useCan();
  const canScan = can('scan:scan');
  const canUndo = can('scan:undo');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [recent, setRecent] = useState<RecentItem[]>([]);
  const [manual, setManual] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  const busy = useRef(false);
  const seq = useRef(0);
  const loadedCount = useRef(0);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const beep = useCallback((tone: Banner['tone']) => {
    // 성공은 짧게 한 번, 이미 상차됨은 두 번, 실패는 길게 두 번 — 소리를 못 듣는 곳에서도 진동으로 구분한다. (iOS Safari는 진동을 지원하지 않는다.)
    navigator.vibrate?.(tone === 'ok' ? 60 : tone === 'dup' ? [80, 60, 80] : [200, 80, 200]);
    // 소리를 못 내는 환경(자동재생 제한 등)이면 진동과 화면 표시만으로 알린다(playTone이 조용히 넘어간다).
    void playTone(tone === 'ok' ? 'scan-ok' : tone === 'dup' ? 'scan-dup' : 'scan-fail');
  }, []);

  const reportFailure = useCallback(() => {
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const next: Banner = { tone: 'bad', title: '전송 실패 — 처리되지 않았습니다', detail: '신호를 확인하고 같은 라벨을 다시 비춰 주세요' };
    setBanner({ ...next, seq: ++seq.current });
    setRecent((prev) => [{ time, text: next.title, tone: next.tone }, ...prev].slice(0, 8));
    beep(next.tone);
  }, [beep]);

  const handleResult = useCallback(
    (result: ScanResult) => {
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      let next: Banner;
      if (result.status === 'loaded') {
        const b = result.box;
        next = { tone: 'ok', title: `${b.business} ${b.boxNo}번`, detail: `${b.terminal || '터미널 없음'}${b.mergedSeqs.length ? ` · 합포장 ${b.mergedSeqs.join('·')}번 함께 상차` : ''}`, labelId: b.labelId, box: { business: b.business, boxNo: b.boxNo, mergedSeqs: b.mergedSeqs }, progress: { loaded: b.loadedCount, total: b.totalCount }, done: b.loadedCount >= b.totalCount };
      } else if (result.status === 'duplicate') {
        const b = result.box;
        const at = b.loadedAt ? new Date(b.loadedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        next = { tone: 'dup', title: '이미 상차된 박스', detail: `${b.business} ${b.boxNo}번${at ? ` · ${at}에 처리됨` : ''}`, labelId: b.labelId, box: { business: b.business, boxNo: b.boxNo, mergedSeqs: b.mergedSeqs }, progress: { loaded: b.loadedCount, total: b.totalCount } };
      } else if (result.status === 'past') {
        const [, month, day] = result.date.split('-');
        next = { tone: 'bad', title: `${Number(month)}/${Number(day)} 날짜의 라벨입니다`, detail: `오늘(${today}) 박스가 아니라서 상차하지 않았습니다 · ${result.code}` };
      } else {
        next = { tone: 'bad', title: result.status === 'invalid' ? '우리 라벨이 아닙니다' : '출력된 적 없는 번호', detail: result.code };
      }
      if (result.status === 'loaded') loadedCount.current += 1;
      const bannerSeq = ++seq.current;
      setBanner({ ...next, seq: bannerSeq, count: result.status === 'loaded' ? loadedCount.current : undefined });
      // 이미 상차된 박스는 제목에 업체가 없어서, 기록에는 어느 박스인지 함께 적는다.
      const text = result.status === 'duplicate' && next.box ? `${next.box.business} ${next.box.boxNo}번 · 이미 상차됨` : next.title;
      setRecent((prev) => [{ time, text, tone: next.tone, labelId: next.labelId, box: next.box, seq: bannerSeq }, ...prev].slice(0, 8));
      beep(next.tone);
    },
    [beep, today],
  );

  const submitCode = useCallback(
    async (raw: string) => {
      const code = raw.replace(/\s+/g, '');
      if (!code || busy.current) return;
      const now = Date.now();
      if (last.current && last.current.code === code) {
        const stillInView = now - last.current.at < DUPLICATE_IGNORE_MS;
        // 무시하는 동안에도 시각을 갱신한다 — 같은 박스를 계속 비추고 있어도 2.5초 뒤 서버로 다시 가서 초록 "상차됨" 배너가
        // 노란 "이미 상차된 박스"로 바뀌는 일이 없고, QR이 시야에서 사라진 뒤에만 다시 읽는다.
        last.current.at = now;
        if (stillInView) return;
      } else {
        last.current = { code, at: now };
      }
      busy.current = true;
      try {
        handleResult(await scanBarcode(code));
      } catch {
        // 신호가 약한 적재칸 등에서 전송이 실패한 경우. 처리되지 않았다는 것을 분명히 알리고, 같은 박스를 바로 다시 스캔할 수 있게 한다.
        last.current = null;
        reportFailure();
      } finally {
        busy.current = false;
      }
    },
    [handleResult, reportFailure],
  );

  const stopCamera = useCallback(() => {
    controlsRef.current?.stop();
    controlsRef.current = null;
    void wakeLockRef.current?.release().catch(() => {});
    wakeLockRef.current = null;
    setCameraOn(false);
  }, []);

  const startCamera = async () => {
    setCameraError(null);
    if (!videoRef.current) return;
    try {
      void unlockAudio(); // 버튼을 누른 순간에 켜야 브라우저가 소리를 허용한다
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.QR_CODE]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      const video = videoRef.current;
      // 영상만 받는다(마이크 없음). 해상도는 칸이 작은 QR도 읽히도록 넉넉히 요청한다.
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
      video.srcObject = stream;
      await video.play();

      // 화면 전체가 아니라 조준선 안쪽만 잘라서(canvas) 읽는다. 영상은 object-fit: cover로 화면에 꽉 차게 그려지므로,
      // 화면 좌표의 조준선 영역을 영상 원본 좌표로 되돌려 잘라낸다.
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      let stopped = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const tick = () => {
        if (stopped) return;
        try {
          const { clientWidth: cw, clientHeight: ch, videoWidth: vw, videoHeight: vh } = video;
          const guide = guideRef.current?.getBoundingClientRect();
          if (ctx && guide && cw > 0 && ch > 0 && vw > 0 && vh > 0) {
            const scale = Math.max(cw / vw, ch / vh);
            const offsetX = (vw * scale - cw) / 2;
            const offsetY = (vh * scale - ch) / 2;
            const box = video.getBoundingClientRect();
            const sx = (guide.left - box.left + offsetX) / scale;
            const sy = (guide.top - box.top + offsetY) / scale;
            const sw = guide.width / scale;
            const sh = guide.height / scale;
            canvas.width = Math.round(sw);
            canvas.height = Math.round(sh);
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            void submitCode(reader.decodeFromCanvas(canvas).getText());
          }
        } catch {
          // 조준선 안에 읽을 수 있는 QR이 없는 프레임이다(정상).
        }
        timer = setTimeout(tick, SCAN_INTERVAL_MS);
      };
      tick();
      controlsRef.current = {
        stop: () => {
          stopped = true;
          clearTimeout(timer);
          stream.getTracks().forEach((t) => t.stop());
          video.srcObject = null;
        },
      };
      setCameraOn(true);
      // 스캔하는 동안 화면이 꺼져 카메라가 멈추지 않게 한다(지원하지 않는 브라우저에서는 그냥 넘어간다).
      wakeLockRef.current = (await navigator.wakeLock?.request('screen').catch(() => null)) ?? null;
    } catch (e) {
      setCameraError(e instanceof Error && e.name === 'NotAllowedError' ? '카메라 사용이 허용되지 않았습니다. 브라우저 주소창의 카메라 권한을 허용해주세요.' : '카메라를 시작하지 못했습니다. 위 입력칸이나 블루투스 스캐너를 쓰세요.');
    }
  };
  useEffect(
    () => () => {
      controlsRef.current?.stop();
      void wakeLockRef.current?.release().catch(() => {});
    },
    [],
  );

  // "이미 상차된 박스" 배너의 취소 버튼은 실수로 누르기 쉬워서 4초 안에 한 번 더 눌러야 취소된다(방금 스캔한 박스의 되돌리기는 바로 실행).
  const [armedSeq, setArmedSeq] = useState<number | null>(null);
  const armTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(armTimer.current), []);
  // 되돌릴 수 있는 방금 스캔(성공·이미 상차됨 결과이고 아직 되돌리지 않은 것). 맨 위 기록이 이 조건이 아니면 되돌릴 줄을 보이지 않는다.
  const lastUndoable = recent[0]?.labelId && !recent[0].undone ? recent[0] : null;
  // 되돌릴 대상은 결과 배너(카메라가 꺼져 있을 때)나 "마지막 스캔" 줄(카메라가 켜져 있을 때)이 넘겨 준다.
  const undo = async (target: { labelId?: string; box?: UndoneBox; tone: Banner['tone']; seq?: number }) => {
    if (!target.labelId) return;
    if (target.tone === 'dup' && armedSeq !== target.seq) {
      setArmedSeq(target.seq ?? null);
      clearTimeout(armTimer.current);
      armTimer.current = setTimeout(() => setArmedSeq(null), 4000);
      return;
    }
    clearTimeout(armTimer.current);
    setArmedSeq(null);
    const result = await undoScan(target.labelId);
    if (result.error) return setBanner({ tone: 'bad', title: '되돌리지 못했습니다', detail: result.error, seq: ++seq.current });
    const done = target.box ? undoneSummary(target.box) : { title: '상차를 취소했습니다', detail: '이 박스는 다시 상차 전 상태입니다.' };
    const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    setBanner({ tone: 'dup', title: done.title, detail: done.detail, seq: ++seq.current });
    // 되돌린 줄은 더 되돌릴 수 없게 표시하고, 취소했다는 기록을 맨 위에 남긴다.
    setRecent((prev) => [{ time, text: done.title, tone: 'dup' as const }, ...prev.map((r) => (r.seq === target.seq ? { ...r, undone: true } : r))].slice(0, 8));
    last.current = null;
  };


  // 터미널별 합계와 아직 안 끝난 업체
  const terminals = useMemo(() => {
    const map = new Map<string, { loaded: number; total: number }>();
    for (const c of cards) {
      const key = c.terminal || NO_TERMINAL;
      const t = map.get(key) ?? { loaded: 0, total: 0 };
      t.loaded += c.loaded;
      t.total += c.total;
      map.set(key, t);
    }
    // 터미널마다 퀵 기사님께 따로 보낼 상차 완료 글(상차된 박스가 없으면 null)
    return [...map.entries()].map(([name, v]) => ({ name, ...v, text: buildLoadedListText(orderDate, cards, name, shareTemplate) }));
  }, [cards, orderDate, shareTemplate]);
  const totalLoaded = cards.reduce((s, c) => s + c.loaded, 0);
  const totalBoxes = cards.reduce((s, c) => s + c.total, 0);
  const visibleCards = onlyPending ? cards.filter((c) => c.loaded < c.total) : cards;
  const isToday = orderDate === today;

  // 터미널별 상차 완료 글을 퀵 기사님께 보낸다. 공유는 지원하는 브라우저(주로 휴대폰)에서만 보이고, 복사는 항상 쓸 수 있다.
  const canShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === 'function',
    () => false,
  );
  const [copiedTerminal, setCopiedTerminal] = useState<string | null>(null);
  const copyList = async (terminal: string, text: string) => {
    try {
      await navigator.clipboard.writeText(cleanShareText(text));
      setCopiedTerminal(terminal);
      window.setTimeout(() => setCopiedTerminal((cur) => (cur === terminal ? null : cur)), 2500);
    } catch {
      window.prompt('아래 글을 복사해서 붙여넣으세요.', cleanShareText(text));
    }
  };
  const shareList = async (terminal: string, text: string) => {
    try {
      await navigator.share({ text: cleanShareText(text) });
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return; // 공유 창을 닫은 것이다
      await copyList(terminal, text);
    }
  };

  return (
    <div className="sc-root">
      <div className="page-header">
        <div className="page-header-icon"><ScanLine size={20} /></div>
        <div>
          <h1 className="page-title">상차 스캔</h1>
        </div>
      </div>

      {!isToday && <p className="sc-warn">{orderDate} 날짜의 상차 현황입니다. 오늘 상차를 스캔하려면 오늘 날짜로 돌아가세요.</p>}

      <section className="sc-card sc-scan">
        <form
          className="sc-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode(manual);
            setManual('');
          }}
        >
          <Keyboard size={16} />
          <input className="ak-input" value={manual} onChange={(e) => setManual(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="라벨 번호 12자리 입력" />
          <button className="ak-btn ak-btn-primary" type="submit" disabled={!canScan || !manual.trim()}>확인</button>
        </form>

        {/* 카메라가 꺼져 있을 때는 영역 전체가 시작 버튼이다. 켜면 영상과 조준선이 나오고, 끄기 버튼은 모서리에 작게 둔다.
            video는 항상 그려 둔다(시작할 때 영상을 연결하려면 요소가 있어야 하고, 숨기면 일부 브라우저가 재생하지 않는다). */}
        <div className={`sc-video ${cameraOn ? '' : 'sc-video-off'}`}>
          <video ref={videoRef} muted playsInline disablePictureInPicture disableRemotePlayback controlsList="nodownload noplaybackrate noremoteplayback" />
          {cameraOn ? (
            <>
              <div ref={guideRef} className="sc-guide" />
              <div className="sc-hint">라벨의 QR 코드를 초록 네모 안에 맞추세요</div>
              {/* 스캔 결과를 영상 아래쪽에 작은 띠로 잠깐 보여 준다(영상을 적게 가리게; 조준선 안의 QR은 띠와 상관없이 계속 읽힌다). 몇 초 뒤 저절로 사라지고 바로 다음 스캔으로 넘어간다. 방금 스캔을 되돌리는 버튼은 영상 바로 아래 "마지막 스캔" 줄에 있다. */}
              {banner?.seq !== undefined && (
                <div key={banner.seq} className={`sc-flash sc-${banner.tone} ${banner.done ? 'sc-ok-done' : ''}`} aria-hidden="true">
                  {banner.tone === 'bad' ? <XCircle size={26} /> : banner.tone === 'dup' ? <AlertTriangle size={26} /> : <CheckCircle2 size={26} />}
                  <div className="sc-flash-text">
                    <div className="sc-title">{banner.title}</div>
                    {banner.done && <div className="sc-detail">이 업체 상차 완료</div>}
                  </div>
                  {banner.progress && <strong className="sc-flash-prog">{banner.progress.loaded}/{banner.progress.total}</strong>}
                </div>
              )}
              <button className="sc-stop" onClick={stopCamera} aria-label="카메라 끄기"><X size={18} /></button>
            </>
          ) : (
            <button className="sc-start" onClick={startCamera} disabled={!canScan}>
              <Camera size={34} />
              스캔 시작하기
            </button>
          )}
        </div>
        {cameraError && <p className="ak-error">{cameraError}</p>}

        {/* 카메라가 켜져 있을 때 방금 스캔을 되돌리는 줄. 결과 띠는 금방 사라지므로 이 줄이 다음 스캔 전까지(시간 제한 없이) 남는다. 카메라를 끈 상태에서는 아래 결과 배너의 버튼을 쓴다. */}
        {cameraOn && canUndo && lastUndoable && (
          <div className="sc-last">
            <span className={`sc-last-text sc-r-${lastUndoable.tone}`}>{lastUndoable.text}</span>
            <button type="button" className="sc-undo sc-undo-inline" onClick={() => void undo(lastUndoable)}>
              <Undo2 size={16} /> {lastUndoable.tone === 'dup' ? (armedSeq === lastUndoable.seq ? '정말 취소? 한 번 더' : '상차 취소') : '되돌리기'}
            </button>
          </div>
        )}

        {/* 카메라가 켜져 있을 때는 결과를 영상 위에만 보여 준다(같은 내용이 위아래로 겹쳐 자리를 차지하지 않게). 카메라를 끈 수기 입력에서만 아래 배너를 쓴다. */}
        {banner && !cameraOn && (
          <div key={banner.seq} className={`sc-banner sc-${banner.tone} ${banner.done ? 'sc-ok-done' : ''} sc-pop`} aria-live="polite" role="status">
            {banner.tone === 'bad' ? <XCircle size={40} /> : banner.tone === 'dup' ? <AlertTriangle size={40} /> : <CheckCircle2 size={40} />}
            <div className="sc-title">{banner.title}</div>
            {banner.progress && (
              <div className="sc-progress">
                <strong>{banner.progress.loaded}/{banner.progress.total}</strong>
                <span>{banner.done ? '이 업체 상차 완료' : '이 업체 상차 현황'}</span>
              </div>
            )}
            <div className="sc-detail">{banner.detail}</div>
            {banner.count !== undefined && <div className="sc-count">이번 접속 {banner.count}번째 상차</div>}
            {banner.labelId && canUndo && (
              <button className="sc-undo" onClick={() => void undo(banner)}><Undo2 size={16} /> {banner.tone === 'dup' ? (armedSeq === banner.seq ? '정말 취소할까요? 한 번 더 누르세요' : '상차를 취소할래요') : '잘못 스캔했어요 (되돌리기)'}</button>
            )}
          </div>
        )}

      </section>

      <section className="sc-card">
        <div className="sc-head">
          <h2>상차 현황 {totalBoxes > 0 && <span className="sc-total">{totalLoaded}/{totalBoxes}박스</span>}</h2>
          {cards.length > 0 && (
            <label className="sc-check"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> 미완료 업체만</label>
          )}
        </div>
        {cards.length === 0 ? (
          <p className="ak-muted">이 날짜에 라벨을 출력한 업체가 없습니다. 박스 할당 화면에서 라벨을 출력하면 여기에 나타납니다.</p>
        ) : (
          <>
            <div className="sc-terminals">
              {terminals.map((t) => (
                <div key={t.name} className={`sc-term ${t.loaded === t.total ? 'sc-term-done' : ''}`}>
                  <div className="sc-term-name">{t.name}</div>
                  <div className="sc-term-row">
                    <div className="sc-term-count">{t.loaded}/{t.total}</div>
                    <div className="sc-share">
                      {canShare && (
                        <button className="sc-ic sc-ic-primary" onClick={() => t.text && shareList(t.name, t.text)} disabled={!t.text} aria-label={`${t.name} 상차 완료 목록 공유`} title="공유"><Share2 size={15} /></button>
                      )}
                      <button className="sc-ic" onClick={() => t.text && copyList(t.name, t.text)} disabled={!t.text} aria-label={copiedTerminal === t.name ? `${t.name} 복사됨` : `${t.name} 상차 완료 목록 복사`} title={copiedTerminal === t.name ? '복사됨' : '복사'}>{copiedTerminal === t.name ? <Check size={15} /> : <Copy size={15} />}</button>
                    </div>
                  </div>
                  <div className="sc-bar"><span style={{ width: `${t.total ? (t.loaded / t.total) * 100 : 0}%` }} /></div>
                </div>
              ))}
            </div>
            {visibleCards.length > 0 && (
              <ul className="sc-list">
                {visibleCards.map((c) => (
                  <li key={c.id} className={c.loaded === c.total ? 'sc-done' : ''}>
                    <span className="sc-tag">{c.terminal || '-'}</span>
                    <span className="sc-name">{c.business}{c.roundLabel ? ` ${c.roundLabel}` : ''}</span>
                    <span className="sc-prog">{c.loaded}/{c.total}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      {recent.length > 0 && <RecentList items={recent} />}

      <style>{`
        .sc-root { display: flex; flex-direction: column; gap: var(--space-block); max-width: 42rem; width: 100%; min-width: 0; }
        .sc-warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; border-radius: 12px; padding: 0.6rem 0.9rem; font-size: var(--fs-md); font-weight: 700; }
        .sc-banner { border-radius: 16px; padding: 0.8rem 0.9rem; display: flex; flex-direction: column; align-items: center; gap: 0.3rem; text-align: center; border: 3px solid transparent; }
        .sc-pop { animation: sc-pop 0.28s ease-out; }
        @keyframes sc-pop { 0% { transform: scale(0.94); } 60% { transform: scale(1.03); } 100% { transform: scale(1); } }
        .sc-count { font-size: var(--fs-sm); font-weight: 700; opacity: 0.85; }
        .sc-ok { background: #dcfce7; border-color: #22c55e; color: #14532d; }
        .sc-ok-done { background: #bbf7d0; border-color: #15803d; }
        .sc-progress { display: flex; align-items: baseline; justify-content: center; gap: 0.5rem; }
        .sc-progress strong { font-size: 1.8rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
        .sc-progress span { font-size: var(--fs-md); font-weight: 800; }
        .sc-hint { position: absolute; top: 0.6rem; left: 0.6rem; right: 3.6rem; padding: 0.35rem 0.7rem; border-radius: 999px; background: rgba(15, 23, 42, 0.65); color: #fff; font-size: var(--fs-sm); font-weight: 700; text-align: center; pointer-events: none; word-break: keep-all; }
        .sc-flash { position: absolute; left: 0; right: 0; bottom: 0; display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.8rem; text-align: left; border-width: 3px 0 0; border-style: solid; pointer-events: none; animation: sc-flash 2.4s ease-out forwards; }
        .sc-flash-text { flex: 1; min-width: 0; }
        .sc-flash .sc-title { font-size: var(--fs-lg); line-height: 1.2; }
        .sc-flash .sc-detail { font-size: var(--fs-sm); }
        .sc-flash-prog { flex: none; font-size: 1.6rem; font-weight: 900; line-height: 1; font-variant-numeric: tabular-nums; }
        .sc-flash.sc-ok, .sc-flash.sc-dup, .sc-flash.sc-bad { opacity: 0.96; }
        @keyframes sc-flash { 0%, 70% { opacity: 0.96; } 100% { opacity: 0; visibility: hidden; } }
        @media (prefers-reduced-motion: reduce) { .sc-flash { animation-duration: 2.4s !important; } }
        .sc-dup { background: #fef9c3; border-color: #eab308; color: #713f12; }
        .sc-bad { background: #fee2e2; border-color: #ef4444; color: #7f1d1d; }
        .sc-title { font-size: 1.4rem; font-weight: 900; line-height: 1.25; word-break: keep-all; }
        .sc-detail { font-size: var(--fs-md); font-weight: 600; word-break: keep-all; }
        .sc-undo { margin-top: 0.4rem; min-height: 2.75rem; padding: 0 1.1rem; border-radius: 999px; border: 2px solid currentColor; background: rgba(255, 255, 255, 0.6); font-weight: 800; display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; }
        .sc-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: var(--space-card); display: flex; flex-direction: column; gap: var(--space-inner); box-shadow: var(--shadow-sm); }
        .sc-card h2 { font-size: var(--fs-lg); font-weight: 800; display: flex; align-items: center; gap: 0.5rem; }
        .sc-total { font-size: var(--fs-lg); color: var(--primary); }
        .sc-scan { padding: 0.7rem; }
        .sc-video { position: relative; background: #0f172a; border-radius: 14px; overflow: hidden; aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; }
        .sc-video-off { aspect-ratio: 16 / 9; background: #f1f5f9; }
        .sc-video-off video { visibility: hidden; }
        .sc-start { position: absolute; inset: 0; width: 100%; border: 2px dashed #94a3b8; border-radius: 14px; background: transparent; color: #1e293b; font-size: var(--fs-num); font-weight: 900; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; cursor: pointer; }
        .sc-start:active { background: #e2e8f0; }
        .sc-stop { position: absolute; top: 0.6rem; right: 0.6rem; width: 2.5rem; height: 2.5rem; border-radius: 999px; border: 0; background: rgba(15, 23, 42, 0.65); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .sc-video video { width: 100%; height: 100%; object-fit: cover; }
        .sc-guide { position: absolute; left: 50%; top: 50%; height: 72%; aspect-ratio: 1; transform: translate(-50%, -50%); border: 3px solid rgba(34, 197, 94, 0.9); border-radius: 10px; box-shadow: 0 0 0 999px rgba(15, 23, 42, 0.35); pointer-events: none; }
        .sc-manual { display: flex; align-items: center; gap: 0.5rem; }
        .sc-manual .ak-input { flex: 1; min-width: 0; height: 2.75rem; font-size: var(--fs-lg); }
        .sc-manual .ak-btn { height: 2.75rem; }
        .sc-terminals { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.5rem; }
        .sc-term { border: 1px solid var(--border); border-radius: 12px; padding: 0.55rem 0.7rem; display: flex; flex-direction: column; gap: 0.25rem; }
        .sc-term-done { background: #f0fdf4; border-color: #86efac; }
        .sc-term-name { font-size: var(--fs-sm); font-weight: 800; color: var(--muted-foreground); }
        .sc-term-row { display: flex; align-items: center; justify-content: space-between; gap: 0.2rem 0.4rem; flex-wrap: wrap; }
        .sc-term-count { font-size: var(--fs-num); font-weight: 900; }
        .sc-share { display: flex; gap: 0.3rem; }
        .sc-ic { width: var(--chip-h); height: var(--chip-h); border-radius: 999px; border: 1px solid var(--border); background: #fff; color: var(--foreground); display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; }
        .sc-ic-primary { background: var(--primary); border-color: var(--primary); color: #fff; }
        .sc-ic:disabled { opacity: 0.45; cursor: default; }
        .sc-bar { height: 6px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
        .sc-bar span { display: block; height: 100%; background: #22c55e; }
        .sc-check { display: flex; align-items: center; gap: 0.4rem; font-size: var(--fs-md); font-weight: 700; }
        .sc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .sc-list li { display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.2rem; border-bottom: 1px solid #f1f5f9; font-size: var(--fs-lg); }
        .sc-done { color: #15803d; }
        .sc-tag { flex: none; font-size: var(--fs-xs); font-weight: 800; background: #f1f5f9; border-radius: 999px; padding: 0.15rem 0.6rem; }
        .sc-name { flex: 1; min-width: 0; font-weight: 800; word-break: keep-all; }
        .sc-prog { flex: none; font-weight: 900; }
        .sc-recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; font-size: var(--fs-md); font-weight: 600; }
        .sc-head { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; flex-wrap: wrap; }
        .sc-recent-card { padding: 0.5rem 0.7rem; gap: 0.4rem; }
        .sc-last { display: flex; align-items: center; gap: 0.5rem; min-height: 2.75rem; min-width: 0; }
        .sc-last-text { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 700; font-size: var(--fs-md); }
        .sc-recent-toggle { width: 100%; min-width: 0; min-height: 2.75rem; display: flex; align-items: center; gap: 0.5rem; background: none; border: 0; padding: 0; text-align: left; cursor: pointer; font-size: var(--fs-md); }
        .sc-recent-toggle strong { font-size: var(--fs-lg); font-weight: 800; flex: none; }
        .sc-recent-last { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
        .sc-chev { flex: none; color: var(--muted-foreground); transition: transform 0.15s; }
        .sc-chev-open { transform: rotate(180deg); }
        .sc-undo-inline { margin: 0; flex: none; min-height: 2.5rem; padding: 0 0.8rem; font-size: var(--fs-sm); white-space: nowrap; }
        .sc-recent li { display: flex; align-items: center; gap: 0.5rem; min-width: 0; }
        .sc-recent span { color: var(--muted-foreground); font-variant-numeric: tabular-nums; flex: none; }
        .sc-recent em { font-style: normal; min-width: 0; flex: 1 1 auto; }
        .sc-r-bad { color: #b91c1c; }
        .sc-r-dup { color: #a16207; }
      `}</style>
    </div>
  );
}

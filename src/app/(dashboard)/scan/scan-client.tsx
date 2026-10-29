'use client';
import '@/components/admin/admin.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrowserMultiFormatReader } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';
import { AlertTriangle, Camera, CheckCircle2, Keyboard, ScanLine, Undo2, X, XCircle } from 'lucide-react';
import { scanBarcode, undoScan, type ScanResult } from './actions';
import { useCan } from '@/components/permissions-context';

export interface ScanCard {
  id: string;
  number: number;
  business: string;
  terminal: string;
  loaded: number;
  total: number;
}

interface Banner {
  tone: 'ok' | 'dup' | 'bad';
  title: string;
  detail: string;
  labelId?: string; // 방금 처리한 박스(되돌리기용)
}

// 초록 조준선(화면 폭·높이에 대한 비율). 카메라는 이 안쪽만 잘라서 읽는다 — 조준선 밖에 보이는 바코드는 읽지 않는다.
const GUIDE = { left: 0.08, right: 0.08, top: 0.35, bottom: 0.35 };
const SCAN_INTERVAL_MS = 80;
const DUPLICATE_IGNORE_MS = 2500; // 카메라가 같은 바코드를 연속으로 읽는 것을 무시하는 시간

export function ScanClient({ orderDate, today, cards }: { orderDate: string; today: string; cards: ScanCard[] }) {
  const can = useCan();
  const canScan = can('scan:scan');
  const canUndo = can('scan:undo');
  const [banner, setBanner] = useState<Banner | null>(null);
  const [recent, setRecent] = useState<{ time: string; text: string; tone: Banner['tone'] }[]>([]);
  const [manual, setManual] = useState('');
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [onlyPending, setOnlyPending] = useState(true);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const last = useRef<{ code: string; at: number } | null>(null);
  const busy = useRef(false);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  const beep = useCallback((tone: Banner['tone']) => {
    navigator.vibrate?.(tone === 'ok' ? 60 : [120, 60, 120]);
    try {
      const ctx = (audioRef.current ??= new AudioContext());
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = tone === 'ok' ? 880 : 220;
      gain.gain.value = 0.15;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + (tone === 'ok' ? 0.12 : 0.35));
    } catch {
      // 소리를 못 내는 환경(자동재생 제한 등)이면 진동과 화면 표시만으로 알린다.
    }
  }, []);

  const handleResult = useCallback(
    (result: ScanResult) => {
      const time = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
      let next: Banner;
      if (result.status === 'loaded') {
        const b = result.box;
        next = { tone: 'ok', title: `${b.business} ${b.boxNo}번`, detail: `${b.terminal || '터미널 없음'} · 이 업체 ${b.loadedCount}/${b.totalCount}박스${b.mergedSeqs.length ? ` · 합포장 ${b.mergedSeqs.join('·')}번 함께 상차` : ''}`, labelId: b.labelId };
      } else if (result.status === 'duplicate') {
        const b = result.box;
        const at = b.loadedAt ? new Date(b.loadedAt).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false }) : '';
        next = { tone: 'dup', title: '이미 상차된 박스', detail: `${b.business} ${b.boxNo}번${at ? ` · ${at}에 처리됨` : ''}`, labelId: b.labelId };
      } else {
        next = { tone: 'bad', title: result.status === 'invalid' ? '우리 라벨이 아닙니다' : '출력된 적 없는 바코드', detail: result.code };
      }
      setBanner(next);
      setRecent((prev) => [{ time, text: next.title, tone: next.tone }, ...prev].slice(0, 8));
      beep(next.tone);
    },
    [beep],
  );

  const submitCode = useCallback(
    async (raw: string) => {
      const code = raw.replace(/\s+/g, '');
      if (!code || busy.current) return;
      const now = Date.now();
      if (last.current && last.current.code === code && now - last.current.at < DUPLICATE_IGNORE_MS) return;
      last.current = { code, at: now };
      busy.current = true;
      try {
        handleResult(await scanBarcode(code));
      } finally {
        busy.current = false;
      }
    },
    [handleResult],
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
      audioRef.current ??= new AudioContext(); // 버튼을 누른 순간에 켜야 브라우저가 소리를 허용한다
      const hints = new Map();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, [BarcodeFormat.CODE_128]);
      hints.set(DecodeHintType.TRY_HARDER, true);
      const reader = new BrowserMultiFormatReader(hints);
      const video = videoRef.current;
      // 영상만 받는다(마이크 없음). 해상도는 막대가 가늘어도 읽히도록 넉넉히 요청한다.
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
          if (ctx && cw > 0 && ch > 0 && vw > 0 && vh > 0) {
            const scale = Math.max(cw / vw, ch / vh);
            const offsetX = (vw * scale - cw) / 2;
            const offsetY = (vh * scale - ch) / 2;
            const sx = (cw * GUIDE.left + offsetX) / scale;
            const sy = (ch * GUIDE.top + offsetY) / scale;
            const sw = (cw * (1 - GUIDE.left - GUIDE.right)) / scale;
            const sh = (ch * (1 - GUIDE.top - GUIDE.bottom)) / scale;
            canvas.width = Math.round(sw);
            canvas.height = Math.round(sh);
            ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
            void submitCode(reader.decodeFromCanvas(canvas).getText());
          }
        } catch {
          // 조준선 안에 읽을 수 있는 바코드가 없는 프레임이다(정상).
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
      setCameraError(e instanceof Error && e.name === 'NotAllowedError' ? '카메라 사용이 허용되지 않았습니다. 브라우저 주소창의 카메라 권한을 허용해주세요.' : '카메라를 시작하지 못했습니다. 아래 입력칸이나 블루투스 스캐너를 쓰세요.');
    }
  };
  useEffect(
    () => () => {
      controlsRef.current?.stop();
      void wakeLockRef.current?.release().catch(() => {});
    },
    [],
  );

  const undo = async () => {
    if (!banner?.labelId) return;
    const result = await undoScan(banner.labelId);
    if (result.error) return setBanner({ tone: 'bad', title: '되돌리지 못했습니다', detail: result.error });
    setBanner({ tone: 'dup', title: '상차를 취소했습니다', detail: '이 박스는 다시 상차 전 상태입니다.' });
    last.current = null;
  };

  // 터미널별 합계와 아직 안 끝난 업체
  const terminals = useMemo(() => {
    const map = new Map<string, { loaded: number; total: number }>();
    for (const c of cards) {
      const key = c.terminal || '터미널 없음';
      const t = map.get(key) ?? { loaded: 0, total: 0 };
      t.loaded += c.loaded;
      t.total += c.total;
      map.set(key, t);
    }
    return [...map.entries()].map(([name, v]) => ({ name, ...v }));
  }, [cards]);
  const totalLoaded = cards.reduce((s, c) => s + c.loaded, 0);
  const totalBoxes = cards.reduce((s, c) => s + c.total, 0);
  const visibleCards = onlyPending ? cards.filter((c) => c.loaded < c.total) : cards;
  const isToday = orderDate === today;

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
        {/* 카메라가 꺼져 있을 때는 영역 전체가 시작 버튼이다. 켜면 영상과 조준선이 나오고, 끄기 버튼은 모서리에 작게 둔다.
            video는 항상 그려 둔다(시작할 때 영상을 연결하려면 요소가 있어야 하고, 숨기면 일부 브라우저가 재생하지 않는다). */}
        <div className={`sc-video ${cameraOn ? '' : 'sc-video-off'}`}>
          <video ref={videoRef} muted playsInline disablePictureInPicture disableRemotePlayback controlsList="nodownload noplaybackrate noremoteplayback" />
          {cameraOn ? (
            <>
              <div className="sc-guide" style={{ left: `${GUIDE.left * 100}%`, right: `${GUIDE.right * 100}%`, top: `${GUIDE.top * 100}%`, bottom: `${GUIDE.bottom * 100}%` }} />
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

        {banner && (
          <div className={`sc-banner sc-${banner.tone}`} aria-live="polite" role="status">
            {banner.tone === 'bad' ? <XCircle size={40} /> : banner.tone === 'dup' ? <AlertTriangle size={40} /> : <CheckCircle2 size={40} />}
            <div className="sc-title">{banner.title}</div>
            <div className="sc-detail">{banner.detail}</div>
            {banner.labelId && canUndo && (
              <button className="sc-undo" onClick={undo}><Undo2 size={16} /> {banner.tone === 'dup' ? '상차를 취소할래요' : '잘못 스캔했어요 (되돌리기)'}</button>
            )}
          </div>
        )}

        <form
          className="sc-manual"
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode(manual);
            setManual('');
          }}
        >
          <Keyboard size={16} />
          <input className="ak-input" value={manual} onChange={(e) => setManual(e.target.value)} inputMode="numeric" autoComplete="off" placeholder="바코드 번호 12자리 입력" />
          <button className="ak-btn ak-btn-primary" type="submit" disabled={!canScan || !manual.trim()}>확인</button>
        </form>
      </section>

      <section className="sc-card">
        <h2>상차 현황 {totalBoxes > 0 && <span className="sc-total">{totalLoaded}/{totalBoxes}박스</span>}</h2>
        {cards.length === 0 ? (
          <p className="ak-muted">이 날짜에 라벨을 출력한 업체가 없습니다. 박스 할당 화면에서 라벨을 출력하면 여기에 나타납니다.</p>
        ) : (
          <>
            <div className="sc-terminals">
              {terminals.map((t) => (
                <div key={t.name} className={`sc-term ${t.loaded === t.total ? 'sc-term-done' : ''}`}>
                  <div className="sc-term-name">{t.name}</div>
                  <div className="sc-term-count">{t.loaded}/{t.total}</div>
                  <div className="sc-bar"><span style={{ width: `${t.total ? (t.loaded / t.total) * 100 : 0}%` }} /></div>
                </div>
              ))}
            </div>
            <label className="sc-check"><input type="checkbox" checked={onlyPending} onChange={(e) => setOnlyPending(e.target.checked)} /> 상차가 끝나지 않은 업체만</label>
            <ul className="sc-list">
              {visibleCards.length === 0 && <li className="ak-muted">모든 업체의 상차가 끝났습니다.</li>}
              {visibleCards.map((c) => (
                <li key={c.id} className={c.loaded === c.total ? 'sc-done' : ''}>
                  <span className="sc-tag">{c.terminal || '-'}</span>
                  <span className="sc-name">{c.business}</span>
                  <span className="sc-prog">{c.loaded}/{c.total}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {recent.length > 0 && (
        <section className="sc-card">
          <h2>최근 스캔</h2>
          <ul className="sc-recent">
            {recent.map((r, i) => (
              <li key={i} className={`sc-r-${r.tone}`}><span>{r.time}</span>{r.text}</li>
            ))}
          </ul>
        </section>
      )}

      <style>{`
        .sc-root { display: flex; flex-direction: column; gap: 0.9rem; max-width: 42rem; margin: 0 auto; width: 100%; min-width: 0; }
        .sc-warn { background: #fffbeb; border: 1px solid #fcd34d; color: #92400e; border-radius: 12px; padding: 0.6rem 0.9rem; font-size: 0.875rem; font-weight: 700; }
        .sc-banner { border-radius: 18px; padding: 1.1rem 1rem; display: flex; flex-direction: column; align-items: center; gap: 0.5rem; text-align: center; border: 3px solid transparent; }
        .sc-ok { background: #dcfce7; border-color: #22c55e; color: #14532d; }
        .sc-dup { background: #fef9c3; border-color: #eab308; color: #713f12; }
        .sc-bad { background: #fee2e2; border-color: #ef4444; color: #7f1d1d; }
        .sc-title { font-size: 1.7rem; font-weight: 900; line-height: 1.25; word-break: keep-all; }
        .sc-detail { font-size: 1rem; font-weight: 600; word-break: keep-all; }
        .sc-undo { margin-top: 0.4rem; min-height: 2.75rem; padding: 0 1.1rem; border-radius: 999px; border: 2px solid currentColor; background: rgba(255, 255, 255, 0.6); font-weight: 800; display: inline-flex; align-items: center; gap: 0.4rem; cursor: pointer; }
        .sc-card { background: #fff; border: 1px solid var(--border); border-radius: var(--radius-lg); padding: 0.9rem 1rem; display: flex; flex-direction: column; gap: 0.7rem; box-shadow: var(--shadow-sm); }
        .sc-card h2 { font-size: 0.9375rem; font-weight: 800; display: flex; align-items: center; gap: 0.5rem; }
        .sc-total { font-size: 1rem; color: var(--primary); }
        .sc-scan { padding: 0.7rem; }
        .sc-video { position: relative; background: #0f172a; border-radius: 14px; overflow: hidden; aspect-ratio: 4 / 3; display: flex; align-items: center; justify-content: center; }
        .sc-video-off { aspect-ratio: 16 / 9; background: #f1f5f9; }
        .sc-video-off video { visibility: hidden; }
        .sc-start { position: absolute; inset: 0; width: 100%; border: 2px dashed #94a3b8; border-radius: 14px; background: transparent; color: #1e293b; font-size: 1.35rem; font-weight: 900; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 0.6rem; cursor: pointer; }
        .sc-start:active { background: #e2e8f0; }
        .sc-stop { position: absolute; top: 0.6rem; right: 0.6rem; width: 2.5rem; height: 2.5rem; border-radius: 999px; border: 0; background: rgba(15, 23, 42, 0.65); color: #fff; display: flex; align-items: center; justify-content: center; cursor: pointer; }
        .sc-video video { width: 100%; height: 100%; object-fit: cover; }
        .sc-guide { position: absolute; border: 3px solid rgba(34, 197, 94, 0.9); border-radius: 10px; box-shadow: 0 0 0 999px rgba(15, 23, 42, 0.35); pointer-events: none; }
        .sc-manual { display: flex; align-items: center; gap: 0.5rem; }
        .sc-manual .ak-input { flex: 1; min-width: 0; height: 2.75rem; font-size: 1rem; }
        .sc-manual .ak-btn { height: 2.75rem; }
        .sc-terminals { display: grid; grid-template-columns: repeat(auto-fill, minmax(8.5rem, 1fr)); gap: 0.5rem; }
        .sc-term { border: 1px solid var(--border); border-radius: 12px; padding: 0.55rem 0.7rem; display: flex; flex-direction: column; gap: 0.25rem; }
        .sc-term-done { background: #f0fdf4; border-color: #86efac; }
        .sc-term-name { font-size: 0.8125rem; font-weight: 800; color: var(--muted-foreground); }
        .sc-term-count { font-size: 1.35rem; font-weight: 900; }
        .sc-bar { height: 6px; border-radius: 999px; background: #e2e8f0; overflow: hidden; }
        .sc-bar span { display: block; height: 100%; background: #22c55e; }
        .sc-check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.875rem; font-weight: 700; }
        .sc-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
        .sc-list li { display: flex; align-items: center; gap: 0.6rem; padding: 0.55rem 0.2rem; border-bottom: 1px solid #f1f5f9; font-size: 1rem; }
        .sc-done { color: #15803d; }
        .sc-tag { flex: none; font-size: 0.75rem; font-weight: 800; background: #f1f5f9; border-radius: 999px; padding: 0.15rem 0.6rem; }
        .sc-name { flex: 1; min-width: 0; font-weight: 800; word-break: keep-all; }
        .sc-prog { flex: none; font-weight: 900; }
        .sc-recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.25rem; font-size: 0.875rem; font-weight: 600; }
        .sc-recent span { color: var(--muted-foreground); margin-right: 0.5rem; font-variant-numeric: tabular-nums; }
        .sc-r-bad { color: #b91c1c; }
        .sc-r-dup { color: #a16207; }
      `}</style>
    </div>
  );
}

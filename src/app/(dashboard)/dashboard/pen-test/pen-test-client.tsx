'use client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { clearCanvas, endInk, extendInk, fitCanvas, startInk, type InkCursor } from '@/lib/ink/canvas';

// 스마트 칠판 입력 진단 화면: 칠판의 브라우저가 펜·손가락·손바닥·지우개를 어떤 입력(pointerType, 접촉 크기, 압력)으로 전달하는지 기록한다.
// 펜으로 상품에 동그라미를 치면 포장 완료로 올리는 기능이 가능한지는 이 값에 달려 있다(2026-11-14 조사). 중량 인식은 하지 않기로 했다. 서버에는 아무것도 보내지 않는다.
// 사용: 아래에서 "지금 시험하는 입력"을 고른 뒤 흰 영역에 10번 정도 문지르고, 다음 입력으로 넘어간다. 끝나면 "결과 복사"를 눌러 붙여 넣어 전달한다.
const KINDS = ['펜', '손가락', '손바닥', '지우개', '젖은 손'] as const;
type Kind = (typeof KINDS)[number];

interface Stat {
  strokes: number;
  events: number;
  types: Record<string, number>; // pointerType별 pointerdown 수
  maxW: number; // 가장 큰 접촉 폭(px)
  maxH: number;
  pressures: Set<number>; // 관측된 압력 값(0.5 고정이면 압력을 못 읽는 장치)
  maxTouches: number; // 한 번에 동시에 눌린 포인터 수(손바닥·유령 터치 확인)
}

const subscribeNothing = () => () => {};
const readEnv = () =>
  [
    `userAgent: ${navigator.userAgent}`,
    `maxTouchPoints: ${navigator.maxTouchPoints}`,
    `PointerEvent 지원: ${'PointerEvent' in window}`,
    `화면(screen): ${screen.width}x${screen.height}, 창(inner): ${window.innerWidth}x${window.innerHeight}, devicePixelRatio: ${window.devicePixelRatio}`,
    `pointer: fine=${window.matchMedia('(pointer: fine)').matches}, any-pointer fine=${window.matchMedia('(any-pointer: fine)').matches}, hover=${window.matchMedia('(hover: hover)').matches}`,
  ].join('\n');

const emptyStat = (): Stat => ({ strokes: 0, events: 0, types: {}, maxW: 0, maxH: 0, pressures: new Set(), maxTouches: 0 });
const TYPE_COLOR: Record<string, string> = { pen: '#dc2626', touch: '#2563eb', mouse: '#16a34a' };

export function PenTestClient() {
  const [kind, setKind] = useState<Kind>('펜');
  const kindRef = useRef<Kind>(kind);
  const [stats, setStats] = useState<Record<Kind, Stat>>(() => Object.fromEntries(KINDS.map((k) => [k, emptyStat()])) as Record<Kind, Stat>);
  const [last, setLast] = useState('');
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const active = useRef(new Map<number, InkCursor>());
  const inkStyle = (pointerType: string) => ({ color: TYPE_COLOR[pointerType] ?? '#9333ea', width: 3 });
  // 환경 정보는 브라우저에서만 읽는다(서버 렌더에는 navigator가 없어 빈 문자열). 값이 문자열이라 같은 값이면 다시 그리지 않는다.
  const env = useSyncExternalStore(subscribeNothing, readEnv, () => '');

  useEffect(() => {
    kindRef.current = kind;
  }, [kind]);

  // 캔버스 그림 해상도를 화면의 실제 픽셀(CSS 크기 × devicePixelRatio)에 맞춘다 — 칠판은 배율이 3이라 CSS 크기로 그리면 선이 깨져 보인다.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      fitCanvas(canvas);
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const record = (e: React.PointerEvent<HTMLCanvasElement>, phase: 'down' | 'move' | 'up') => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (phase === 'down') {
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 이미 사라진 접촉(유령 터치 등)은 캡처할 수 없다. 진단 도구는 어떤 입력에도 멈추지 않고 그대로 기록한다.
      }
      active.current.set(e.pointerId, startInk({ x, y }));
    }
    const cursor = active.current.get(e.pointerId);
    const ctx = canvas.getContext('2d');
    if (ctx && cursor) {
      const style = inkStyle(e.pointerType);
      ctx.strokeStyle = style.color;
      ctx.lineWidth = style.width;
      if (phase === 'move') {
        // 브라우저가 모아 둔 중간 점까지 모두 이어서(보고 빈도가 낮은 칠판에서도) 선이 끊기지 않게 한다. 지원하지 않으면 현재 점만 쓴다.
        const points = e.nativeEvent.getCoalescedEvents?.() ?? [];
        let next = cursor;
        for (const p of points.length > 0 ? points : [e.nativeEvent]) next = extendInk(ctx, next, { x: p.clientX - rect.left, y: p.clientY - rect.top });
        active.current.set(e.pointerId, next);
      } else if (phase === 'up') {
        endInk(ctx, cursor);
      }
    }
    if (phase === 'up') active.current.delete(e.pointerId);

    const k = kindRef.current;
    const simultaneous = active.current.size + (phase === 'up' ? 1 : 0);
    setStats((prev) => {
      const s = prev[k];
      const next: Stat = {
        ...s,
        events: s.events + 1,
        strokes: s.strokes + (phase === 'down' ? 1 : 0),
        types: phase === 'down' ? { ...s.types, [e.pointerType || '(빈 값)']: (s.types[e.pointerType || '(빈 값)'] ?? 0) + 1 } : s.types,
        maxW: Math.max(s.maxW, Math.round(e.width)),
        maxH: Math.max(s.maxH, Math.round(e.height)),
        pressures: new Set(s.pressures).add(Math.round(e.pressure * 100) / 100),
        maxTouches: Math.max(s.maxTouches, simultaneous),
      };
      return { ...prev, [k]: next };
    });
    setLast(`${phase} · pointerType=${e.pointerType || '(빈 값)'} · id=${e.pointerId} · 폭×높이=${Math.round(e.width)}×${Math.round(e.height)} · pressure=${e.pressure} · buttons=${e.buttons} · primary=${e.isPrimary}`);
  };

  const clearInk = () => {
    const ctx = canvasRef.current?.getContext('2d');
    if (ctx) clearCanvas(ctx);
  };
  const resetAll = () => {
    clearInk();
    setStats(Object.fromEntries(KINDS.map((k) => [k, emptyStat()])) as Record<Kind, Stat>);
    setLast('');
  };

  const report = () =>
    [
      '[펜 입력 진단 결과]',
      env,
      ...KINDS.map((k) => {
        const s = stats[k];
        const types = Object.entries(s.types).map(([t, n]) => `${t}:${n}`).join(', ') || '입력 없음';
        return `- ${k}: 획 ${s.strokes}, pointerType {${types}}, 최대 접촉 ${s.maxW}×${s.maxH}px, 압력 값 {${[...s.pressures].sort().join(', ')}}, 동시 접촉 최대 ${s.maxTouches}`;
      }),
    ].join('\n');

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(report());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // 복사가 막힌 기기(칠판 브라우저 등)는 아래 결과 상자의 글자를 직접 선택해 전달한다
    }
  };

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-3 p-2">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold text-slate-800">펜 입력 진단</h1>
        <Link href="/dashboard" className="text-sm font-bold text-slate-600 hover:text-slate-900">← 주문 목록</Link>
      </div>
      <p className="text-sm leading-relaxed text-slate-600">
        스마트 칠판에서 이 화면을 열고, 아래에서 시험할 입력을 고른 뒤 흰 영역에 10번쯤 문질러 보세요. 펜(빨강)·손가락(파랑)·마우스(초록)는 색이 달라집니다. 끝나면 &quot;결과 복사&quot;를 눌러 붙여 넣어 전달해 주세요. 서버에는 아무것도 저장하지 않습니다.
      </p>

      <pre className="whitespace-pre-wrap break-all rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700">{env || '환경 정보를 읽는 중…'}</pre>

      <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label="지금 시험하는 입력">
        {KINDS.map((k) => (
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={kind === k}
            onClick={() => setKind(k)}
            className={`h-11 rounded-lg border px-4 text-sm font-bold ${kind === k ? 'border-[#003057] bg-[#003057] text-white' : 'border-slate-300 bg-white text-slate-700'}`}
          >
            {k} <span className="font-medium opacity-80">· 획 {stats[k].strokes}</span>
          </button>
        ))}
        <button type="button" onClick={clearInk} className="h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">그림 지우기</button>
        <button type="button" onClick={resetAll} className="h-11 rounded-lg border border-slate-300 bg-white px-4 text-sm font-bold text-slate-700">기록 모두 지우기</button>
      </div>

      <canvas
        ref={canvasRef}
        className="h-[45vh] w-full rounded-xl border-2 border-dashed border-slate-300 bg-white"
        style={{ touchAction: 'none' }}
        onPointerDown={(e) => record(e, 'down')}
        onPointerMove={(e) => record(e, 'move')}
        onPointerUp={(e) => record(e, 'up')}
        onPointerCancel={(e) => record(e, 'up')}
        onContextMenu={(e) => e.preventDefault()}
      />

      <p className="min-h-5 break-all text-xs text-slate-500">{last || '마지막 입력이 여기에 표시됩니다.'}</p>

      <div className="flex items-center gap-2">
        <button type="button" onClick={copy} className="h-11 rounded-lg bg-[#003057] px-5 text-sm font-bold text-white">{copied ? '복사했습니다' : '결과 복사'}</button>
        <span className="text-xs text-slate-500">복사가 안 되면 아래 상자의 글자를 길게 눌러 선택해 전달하세요.</span>
      </div>
      <textarea readOnly value={report()} rows={9} className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-700" />
    </div>
  );
}

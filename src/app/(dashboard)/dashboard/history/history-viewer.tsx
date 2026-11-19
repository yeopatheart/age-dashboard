'use client';
import { Download, Loader2, X, ZoomIn } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Segmented } from '@/components/segmented';
import type { BoardGroup, SnapshotMeta, SummaryCard } from '@/lib/ink/history-view';
import type { InkStroke } from '@/lib/ink/store';
import { saveBoardImage } from './board-image';
import { HistoryBoard } from './history-board';

// 스냅샷 화면(표 + 필기)을 보여 주고, 누르면 확대하고, 이미지로 저장한다. 읽기 전용이라 서버에 아무것도 쓰지 않는다.

interface Props {
  cards: SummaryCard[];
  meta: SnapshotMeta;
  strokes: InkStroke[];
  snapshotKey: string;
  group: BoardGroup; // 버스 주문·별도 주문(표 모양이 다르다)
  sepCompact: boolean; // 별도 주문 표가 새 촘촘한 모양인지(날짜로 정한다)
  caption: string; // 저장하는 이미지 위 띠와 확대 창 제목에 쓰는 글자("2026-11-18 · 모니터 1 · 10:32 기록")
  filename: string;
  toolbar: ReactNode; // 이미지 저장 버튼과 같은 줄 왼쪽에 놓는 것(화면 탭)
  children?: ReactNode; // 그 줄 아래·표 위에 놓는 안내
}

// 별도 주문 표는 칠판 팝업 크기(배율 1)까지만 키운다. 줄이 높아(옛 51px) 더 키우면 화면 하나에 8~9줄밖에 안 보인다(2026-11-19 사용자 요청: 1.0배).
const SEP_MAX_SCALE = 1;

type SaveState = { kind: 'idle' } | { kind: 'saving' } | { kind: 'done' } | { kind: 'error'; message: string };

const ZOOM_LEVELS = [
  { key: 'fit', label: '화면에 맞춤', scale: null },
  { key: '150', label: '150%', scale: 1.5 },
  { key: '200', label: '200%', scale: 2 },
  { key: '300', label: '300%', scale: 3 },
] as const;
type ZoomKey = (typeof ZOOM_LEVELS)[number]['key'];

function useSave(caption: string, filename: string) {
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const save = async (root: HTMLElement | null) => {
    if (!root || state.kind === 'saving') return;
    clearTimeout(timer.current);
    setState({ kind: 'saving' });
    try {
      await saveBoardImage(root, caption, filename);
      setState({ kind: 'done' });
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : '이미지를 저장하지 못했습니다.' });
    }
    timer.current = setTimeout(() => setState({ kind: 'idle' }), 4000);
  };
  return { state, save };
}

function SaveButton({ state, onClick }: { state: SaveState; onClick: () => void }) {
  const saving = state.kind === 'saving';
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" onClick={onClick} disabled={saving} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60">
        {saving ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
        {saving ? '이미지 만드는 중…' : '이미지로 저장'}
      </button>
      <span role="status" aria-live="polite" className={`text-xs font-semibold ${state.kind === 'error' ? 'text-rose-600' : 'text-emerald-700'}`}>
        {state.kind === 'done' && '저장했습니다'}
        {state.kind === 'error' && state.message}
      </span>
    </span>
  );
}

function ZoomModal({ cards, meta, strokes, snapshotKey, group, sepCompact, caption, filename, onClose }: Omit<Props, 'toolbar' | 'children'> & { onClose: () => void }) {
  const [level, setLevel] = useState<ZoomKey>('fit');
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const { state, save } = useSave(caption, filename);
  const scale = ZOOM_LEVELS.find((l) => l.key === level)?.scale ?? null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-[80] flex flex-col bg-slate-900/75 p-2 sm:p-4" role="dialog" aria-modal="true" aria-label={`${caption} 확대 보기`} onClick={onClose}>
      <div className="mx-auto flex min-h-0 w-full max-w-[2400px] flex-1 flex-col overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-slate-200 px-3 py-2">
          <h2 className="mr-auto min-w-0 truncate text-sm font-bold text-slate-900">{caption}</h2>
          <Segmented<ZoomKey> label="확대 비율" value={level} items={ZOOM_LEVELS.map((l) => ({ key: l.key, label: l.label }))} onSelect={setLevel} />
          <SaveButton state={state} onClick={() => void save(bodyRef.current)} />
          <button ref={closeRef} type="button" onClick={onClose} aria-label="닫기" className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-600 hover:bg-slate-50">
            <X size={18} />
          </button>
        </div>
        <div ref={bodyRef} className="min-h-0 flex-1 overflow-auto bg-slate-100 p-3">
          <HistoryBoard cards={cards} meta={meta} strokes={strokes} snapshotKey={`${snapshotKey}-zoom`} group={group} sepCompact={sepCompact} fixedScale={scale} maxScale={3} />
        </div>
      </div>
    </div>,
    document.body,
  );
}

export function HistoryViewer({ toolbar, children, ...props }: Props) {
  const [zoomOpen, setZoomOpen] = useState(false);
  const boardRef = useRef<HTMLDivElement>(null);
  const { state, save } = useSave(props.caption, props.filename);

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        <span className="flex-1" />
        <SaveButton state={state} onClick={() => void save(boardRef.current)} />
      </div>
      {children}
      <div
        ref={boardRef}
        role="button"
        tabIndex={0}
        aria-label="필기 화면 확대"
        onClick={() => setZoomOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setZoomOpen(true);
          }
        }}
        className="group relative cursor-zoom-in rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-slate-900/60"
      >
        <HistoryBoard cards={props.cards} meta={props.meta} strokes={props.strokes} snapshotKey={props.snapshotKey} group={props.group} sepCompact={props.sepCompact} maxScale={props.group === 'sep' ? SEP_MAX_SCALE : undefined} />
        <span className="pointer-events-none absolute right-2 top-2 hidden items-center gap-1 rounded-full bg-slate-900/80 px-2.5 py-1 text-xs font-semibold text-white group-hover:inline-flex group-focus-visible:inline-flex">
          <ZoomIn size={13} /> 눌러서 확대
        </span>
      </div>
      {zoomOpen && <ZoomModal {...props} onClose={() => setZoomOpen(false)} />}
    </div>
  );
}

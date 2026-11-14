'use client';
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { X } from 'lucide-react';
import { getPackingEditorData } from '../packing-log/actions';
import type { PackingBoxType, PackingBusiness } from '@/lib/packing/types';

// 박스 할당 화면의 편집 영역은 화면에 쓰는 스타일·드래그 코드가 많아서 팝업을 열 때만 읽는다.
const PackingLogClient = dynamic(() => import('../packing-log/packing-log-client').then((m) => m.PackingLogClient), {
  ssr: false,
  loading: () => <p className="px-4 py-10 text-center text-sm text-slate-400">불러오는 중…</p>,
});

interface Loaded {
  row: PackingBusiness;
  boxes: PackingBoxType[];
  orderDate: string;
  today: string;
  allowPast: boolean;
}

// 주문 목록의 박스 열을 누르면 뜨는 박스 할당 팝업: 박스 할당 화면(/packing-log)과 같은 편집 영역에서 이 업체의 박스를 고치고 다시 제출한다.
// 제출하면 팝업이 닫히고 주문 목록은 서버 액션이 보낸 새 화면으로 갱신된다. 주문이 바뀐 뒤의 박스 재확인 경고도 같은 화면에서 해결한다.
export function BoxAssignModal({ dailyBusinessId, title, onClose }: { dailyBusinessId: string; title: string; onClose: () => void }) {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; data: Loaded }>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getPackingEditorData(dailyBusinessId)
      .then((result) => {
        if (cancelled) return;
        if (result.error !== null) setState({ status: 'error', message: result.error });
        else setState({ status: 'ready', data: { row: result.row, boxes: result.boxes, orderDate: result.orderDate, today: result.today, allowPast: result.allowPast } });
      })
      .catch(() => !cancelled && setState({ status: 'error', message: '박스 할당 정보를 읽지 못했습니다. 잠시 뒤 다시 시도해 주세요.' }));
    return () => {
      cancelled = true;
    };
  }, [dailyBusinessId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[72] flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-[2px]" onClick={onClose}>
      <div role="dialog" aria-label={`${title} 박스 할당`} className="flex max-h-[92vh] w-full max-w-5xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-shrink-0 items-center justify-between rounded-t-2xl px-6 py-3" style={{ backgroundColor: '#003057' }}>
          <h3 className="text-sm font-bold tracking-wide text-white">박스 할당 — {title}</h3>
          <button onClick={onClose} aria-label="닫기" className="text-white/70 transition-colors hover:text-white"><X className="h-4 w-4" /></button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {state.status === 'loading' && <p className="px-4 py-10 text-center text-sm text-slate-400">불러오는 중…</p>}
          {state.status === 'error' && <p className="px-4 py-10 text-center text-sm font-bold text-rose-600">{state.message}</p>}
          {state.status === 'ready' && (
            <PackingLogClient embedded orderDate={state.data.orderDate} today={state.data.today} allowPast={state.data.allowPast} rows={[state.data.row]} boxes={state.data.boxes} onSubmitted={onClose} />
          )}
        </div>
      </div>
    </div>
  );
}

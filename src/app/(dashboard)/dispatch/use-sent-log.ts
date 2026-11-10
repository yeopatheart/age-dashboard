'use client';
import { useCallback, useState } from 'react';
import type { DispatchKind, DispatchMethod, SentEntry } from '@/lib/dispatch-log';
import { recordSent } from './actions';

// 보냄 기록 상태. initial은 서버가 읽어 온 항목별 최근 기록이고, record가 성공하면 화면에 바로 반영한다(새로고침 없이).
// enabled=false(마이그레이션 0052 전)면 기록하지 않는다. 기록이 실패해도 보내기 자체는 이미 끝난 일이라 막지 않고 error로만 알린다.
export function useSentLog(kind: DispatchKind, initial: Record<string, SentEntry>, enabled: boolean) {
  const [entries, setEntries] = useState(initial);
  const [error, setError] = useState<string | null>(null);

  const record = useCallback(
    async (orderDate: string, key: string, method: DispatchMethod, hash: string | null) => {
      if (!enabled) return;
      const result = await recordSent({ orderDate, kind, key, method, contentHash: hash }).catch(() => ({ error: '연결을 확인한 뒤 다시 시도해주세요.', sentAt: null }));
      if (result.error || !result.sentAt) {
        setError(`보냄 기록을 남기지 못했습니다. ${result.error ?? ''}`.trim());
        return;
      }
      setError(null);
      setEntries((prev) => ({ ...prev, [key]: { method, hash, sentAt: result.sentAt as string } }));
    },
    [kind, enabled],
  );

  return { entries, record, error };
}

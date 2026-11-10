// 보내기 기록의 순수 로직(서버·클라이언트 공용): 글 해시, 항목마다 가장 최근 기록 고르기, 상태·표시 글.
// 저장·조회는 dispatch-log-server.ts와 dispatch/actions.ts가 한다.

export type DispatchKind = 'driver' | 'receipt' | 'customer'; // 기사 글 | 영수증 카드 | 고객사 정산 메시지
export type DispatchMethod = 'share' | 'copy';

export interface DispatchLogRow {
  kind: DispatchKind;
  key: string;
  method: DispatchMethod;
  contentHash: string | null;
  sentAt: string; // ISO 시각
}

// 화면이 쓰는 항목별 가장 최근 기록.
export interface SentEntry {
  method: DispatchMethod;
  hash: string | null;
  sentAt: string;
}

export type SentState = 'none' | 'sent' | 'changed';

// 글 해시(FNV-1a 32비트, 16진 8자리). 보안용이 아니라 "보낸 뒤 글이 달라졌나"만 가리는 용도라 동기 함수로 충분하다.
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// kind에 맞는 행들에서 key마다 sentAt이 가장 늦은 기록만 남긴다(입력 순서와 무관).
export function latestByKey(rows: DispatchLogRow[], kind: DispatchKind): Record<string, SentEntry> {
  const out: Record<string, SentEntry> = {};
  for (const r of rows) {
    if (r.kind !== kind) continue;
    const prev = out[r.key];
    if (!prev || Date.parse(r.sentAt) > Date.parse(prev.sentAt)) out[r.key] = { method: r.method, hash: r.contentHash, sentAt: r.sentAt };
  }
  return out;
}

// 기록이 없으면 'none', 보낸 글과 지금 글의 해시가 둘 다 있고 다르면 'changed'(보낸 뒤 글이 바뀜), 아니면 'sent'.
export function sentState(entry: SentEntry | undefined, currentHash?: string): SentState {
  if (!entry) return 'none';
  if (entry.hash && currentHash && entry.hash !== currentHash) return 'changed';
  return 'sent';
}

// 한국 시각 HH:MM.
export function formatSentTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

// 카드에 붙일 글. 공유는 "보냄", 복사는 "복사"(붙여넣기까지 확인된 것이 아니라서 다르게 쓴다). 기록이 없으면 null.
export function sentLabel(entry: SentEntry | undefined, state: SentState): string | null {
  if (!entry || state === 'none') return null;
  const time = formatSentTime(entry.sentAt);
  const verb = entry.method === 'share' ? '보냄' : '복사';
  return state === 'changed' ? `${verb} ${time} 이후 변경됨` : `${verb} ✓ ${time}`;
}

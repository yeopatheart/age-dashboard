// 라벨 출력 확정(스풀러 방식)에서 쓰는 순수 규칙. DB·화면 어디서나 쓸 수 있게 접근 코드는 넣지 않는다.
// 흐름은 supabase/migrations/0061_label_print_spooler.sql 맨 위 설명 참고.

// 출력 확정 방식: 'button' = 출력 버튼을 누르면 바로 출력으로 기록(예전 동작, 기본), 'spooler' = 프린터 PC의 에이전트가 인쇄 완료를 알려야 기록.
export type LabelConfirmMode = 'button' | 'spooler';
export const LABEL_CONFIRM_KEY = 'labelConfirmMode';
export const normalizeConfirmMode = (value: unknown): LabelConfirmMode => (value === 'spooler' ? 'spooler' : 'button');

// 인쇄 작업 이름(= 인쇄할 때의 문서 제목). 에이전트가 Windows 인쇄 이벤트의 문서 이름에서 이 규칙으로 작업 id를 찾는다.
// scripts/label-agent/label-agent.ps1의 정규식과 같아야 한다.
const PRINT_JOB_TITLE_PREFIX = 'AGE-LABEL-';
export const printJobTitle = (jobId: string) => `${PRINT_JOB_TITLE_PREFIX}${jobId}`;
const JOB_TITLE_PATTERN = /AGE-LABEL-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i;
export function jobIdFromTitle(title: string): string | null {
  return JOB_TITLE_PATTERN.exec(title)?.[1]?.toLowerCase() ?? null;
}

// 에이전트가 아직 확정하지 않은 작업을 "출력 확인 중"으로 보여 주는 시간(분). 이보다 오래된 pending은 확인 실패로 보고 다시 출력할 수 있게 한다.
export const PENDING_VISIBLE_MINUTES = 30;

export interface PrintJobItem {
  daily_business_id: string;
  seq: number;
  barcode: string;
  printed_box_type: string | null;
}

export interface PendingJob {
  items: PrintJobItem[];
  createdAt: string;
}

// 한 업체 카드에서 "출력 확인 중"인 박스 순번(보여 주는 시간 안의 pending 작업만).
export function pendingSeqsOf(jobs: PendingJob[], dailyBusinessId: string, now: Date): number[] {
  const cutoff = now.getTime() - PENDING_VISIBLE_MINUTES * 60_000;
  const seqs = new Set<number>();
  for (const job of jobs) {
    if (new Date(job.createdAt).getTime() < cutoff) continue;
    for (const item of job.items) if (item.daily_business_id === dailyBusinessId) seqs.add(item.seq);
  }
  return [...seqs].sort((a, b) => a - b);
}

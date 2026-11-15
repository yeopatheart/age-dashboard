// 주문 확정(commitOrderLines)이 중간에 실패했을 때의 뒷정리와 화면에 보여 줄 문구.
//
// 확정은 업체 카드 → 상품 줄 순으로 따로 저장한다. 상품 저장이 실패하면 카드만 남아 주문 목록에 고객사명만 보이는 반쪽 상태가 된다(2026-11-15).
// 그래서 상품 줄이 저장되기 전에 실패하면 이번 확정이 새로 만든 카드를 지운다. 상품 줄이 이미 저장된 뒤의 실패는 카드를 지우지 않는다(지우면 저장된 줄이 같이 사라진다).

export interface CleanupResult {
  attempted: number;
  error: string | null;
}

// 이번 확정이 새로 만든 카드를 지운다. deleteByIds는 호출한 쪽이 DB 삭제 호출을 넘겨 준다(테스트에서 가짜로 바꿀 수 있게).
export async function deleteCreatedCards(
  createdIds: string[],
  deleteByIds: (ids: string[]) => PromiseLike<{ error: { message: string } | null }>,
): Promise<CleanupResult> {
  if (createdIds.length === 0) return { attempted: 0, error: null };
  try {
    const { error } = await deleteByIds(createdIds);
    return { attempted: createdIds.length, error: error?.message ?? null };
  } catch (e) {
    return { attempted: createdIds.length, error: e instanceof Error ? e.message : String(e) };
  }
}

// redirect()·notFound() 같은 Next.js의 흐름 제어는 오류처럼 던져진다. 화면 문구로 바꾸지 않고 그대로 다시 던져야 한다.
export function isFrameworkSignal(error: unknown): boolean {
  const digest = (error as { digest?: unknown } | null)?.digest;
  return typeof digest === 'string' && digest.startsWith('NEXT_');
}

// 화면에 보여 줄 문구. 운영에서는 던진 오류의 문구가 가려지므로(React error #441) 결과 값으로 돌려준다.
// itemsSaved: 새 상품 줄이 이미 저장된 뒤의 실패면 "저장하지 않았습니다"가 거짓이다 — 같은 내용을 다시 확정하면 새 줄이 두 번 들어간다.
export function commitFailureMessage(error: unknown, cleaned: CleanupResult, itemsSaved = false): string {
  const reason = error instanceof Error ? error.message : '알 수 없는 오류';
  if (itemsSaved) return `새 상품은 저장됐지만 일부 기존 줄의 수정·취소·메모가 반영되지 않았습니다(${reason}). 같은 내용을 다시 확정하지 말고, 주문 목록에서 확인해 고쳐 주세요.`;
  if (cleaned.error) return `${reason} (이번에 만든 업체 카드 ${cleaned.attempted}개를 정리하지 못했습니다. 주문 목록에 상품 없는 업체가 남아 있으면 알려 주세요: ${cleaned.error})`;
  return `${reason} — 저장하지 않았습니다.`;
}

// 작업을 size개씩 묶어 차례로 실행한다(묶음 안에서는 동시에). 쓰기 요청이 수백 건 한꺼번에 나가면 8초 제한에 걸려 일부가 끊긴다.
export async function runInChunks<T>(tasks: (() => PromiseLike<T>)[], size: number): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < tasks.length; i += size) {
    out.push(...(await Promise.all(tasks.slice(i, i + size).map((run) => run()))));
  }
  return out;
}

// supabase 결과 배열에서 첫 오류 문구를 찾는다.
export function firstResultError(results: unknown[]): string | null {
  for (const result of results) {
    const message = (result as { error?: { message?: string } | null } | null | undefined)?.error?.message;
    if (message) return message;
  }
  return null;
}

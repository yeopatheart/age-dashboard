// 서버가 Supabase(DB·Auth)를 부를 때 일시적 실패를 한두 번 다시 시도하고, 응답이 안 오면 끊는다(순수 함수: fetch를 주입해서 테스트한다).
// 주문 목록은 화면을 새로 받을 때마다 DB 요청이 10건 넘게 나가는데, 그중 하나라도 순간적으로 실패하면(네트워크 순간 끊김, 게이트웨이 502/503/504)
// 서버 컴포넌트가 오류를 던져 화면 전체가 "화면을 불러오지 못했습니다"로 바뀌고 깜빡였다. 요청이 많을수록 한 번쯤 실패할 확률이 올라간다.
// 읽기(GET·HEAD)만 다시 시도한다: 쓰기(POST·PATCH·DELETE)를 다시 보내면 같은 주문이 두 번 들어갈 수 있다.
const RETRY_STATUS = new Set([502, 503, 504, 520, 521, 522, 523, 524]);
export const MAX_ATTEMPTS = 3; // 처음 1번 + 다시 2번
export const ATTEMPT_TIMEOUT_MS = 8_000; // 한 번의 요청이 이보다 오래 걸리면 끊고(다시 시도하고) 서버리스 함수 제한시간까지 매달리지 않는다
const BACKOFF_MS = [150, 400];

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

const methodOf = (input: RequestInfo | URL, init?: RequestInit): string => (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();

export function createRetryingFetch(
  base: FetchLike = (input, init) => fetch(input, init),
  options: { sleep?: (ms: number) => Promise<void>; timeoutMs?: number } = {},
): FetchLike {
  const sleep = options.sleep ?? ((ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const timeoutMs = options.timeoutMs ?? ATTEMPT_TIMEOUT_MS;
  return async (input, init) => {
    const method = methodOf(input, init);
    const idempotent = method === 'GET' || method === 'HEAD';
    const attempts = idempotent ? MAX_ATTEMPTS : 1;
    let lastError: unknown;
    for (let attempt = 0; attempt < attempts; attempt++) {
      if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? 400);
      // 한 번의 요청 제한시간. 호출한 쪽이 이미 취소 신호를 줬으면 그것도 따른다.
      const controller = new AbortController();
      const callerSignal = init?.signal;
      const onCallerAbort = () => controller.abort(callerSignal?.reason);
      if (callerSignal) {
        if (callerSignal.aborted) throw callerSignal.reason ?? new DOMException('Aborted', 'AbortError');
        callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }
      const timer = setTimeout(() => controller.abort(new DOMException('Timeout', 'TimeoutError')), timeoutMs);
      try {
        const response = await base(input, { ...init, signal: controller.signal });
        if (idempotent && RETRY_STATUS.has(response.status) && attempt < attempts - 1) {
          lastError = new Error(`HTTP ${response.status}`);
          continue;
        }
        return response;
      } catch (error) {
        if (callerSignal?.aborted) throw error; // 호출한 쪽이 취소한 것은 다시 시도하지 않는다
        lastError = error;
        if (attempt >= attempts - 1) throw error;
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', onCallerAbort);
      }
    }
    throw lastError;
  };
}

// Supabase는 한 번에 최대 1000행만 돌려준다. 더 많을 수 있는 조회(이력 전체, 상품·업체 전체)는 페이지로 나눠 모두 읽는다.
// 보통은 첫 페이지 하나로 끝난다(요청 1회). 첫 페이지가 꽉 차 있으면 나머지를 여러 장(FETCH_CONCURRENCY)씩 한꺼번에 보내고
// 짧은 페이지가 나오면 거기서 끝낸다 — 이력이 쌓여도 왕복이 페이지 수만큼 늘지 않는다. 정렬이 안정적인 쿼리(.order('id') 등)에만 쓴다.
export const FETCH_PAGE = 1000;
const FETCH_CONCURRENCY = 4;

type PageResult<T> = { data: T[] | null; error: { message: string } | null };

export async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<PageResult<T>>, errorPrefix = ''): Promise<T[]> {
  const unwrap = ({ data, error }: PageResult<T>) => {
    if (error) throw new Error(`${errorPrefix}${error.message}`);
    return data ?? [];
  };
  const all = unwrap(await page(0, FETCH_PAGE - 1));
  if (all.length < FETCH_PAGE) return all;
  for (let start = FETCH_PAGE; ; start += FETCH_PAGE * FETCH_CONCURRENCY) {
    const batch = await Promise.all(Array.from({ length: FETCH_CONCURRENCY }, (_, i) => page(start + i * FETCH_PAGE, start + (i + 1) * FETCH_PAGE - 1)));
    for (const result of batch) {
      const rows = unwrap(result);
      all.push(...rows);
      if (rows.length < FETCH_PAGE) return all;
    }
  }
}

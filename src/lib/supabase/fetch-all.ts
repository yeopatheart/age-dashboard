// Supabase는 한 번에 최대 1000행만 돌려준다. 더 많을 수 있는 조회(이력 전체, 상품·업체 전체)는 페이지로 나눠 모두 읽는다.
export const FETCH_PAGE = 1000;

export async function fetchAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  errorPrefix = '',
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await page(from, from + FETCH_PAGE - 1);
    if (error) throw new Error(`${errorPrefix}${error.message}`);
    all.push(...(data ?? []));
    if ((data ?? []).length < FETCH_PAGE) return all;
  }
}

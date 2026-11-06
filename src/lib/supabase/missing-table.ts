// 마이그레이션이 아직 적용되지 않아 테이블이 없을 때(PostgREST PGRST205 "Could not find the table 'public.x' in the schema cache")를
// 알아보고, 어떤 마이그레이션을 적용해야 하는지 알려 준다. 운영 환경은 서버 오류 문구를 화면에 보여 주지 않아서(Next가 가린다)
// 그냥 던지면 사용자는 "에러"만 보고 원인을 알 수 없다 — 화면에서 이 값으로 안내를 대신 보여 준다.
// 오류를 조용히 삼키지 않는다: 이 경우가 아니면 호출한 쪽이 그대로 다시 던진다.

// 테이블 → 그 테이블을 만드는 마이그레이션 파일. 새 마이그레이션으로 테이블을 추가하는 화면은 여기에 한 줄씩 더한다.
const MIGRATION_OF_TABLE: Record<string, string> = {
  seller_businesses: '0042_settlement_masters.sql',
  suppliers: '0042_settlement_masters.sql',
  product_suppliers: '0042_settlement_masters.sql',
  settlement_sales: '0043_settlement_sales.sql',
  settlement_purchases: '0044_settlement_purchases.sql',
  settlement_receipts: '0047_settlement_receipts.sql',
};

// 오류가 "테이블 없음"이면 그 테이블 이름(못 읽으면 'unknown'), 아니면 null.
export function missingTable(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  if (!/Could not find the table|schema cache/i.test(message)) return null;
  return /'public\.([a-z_]+)'/.exec(message)?.[1] ?? 'unknown';
}

// 없는 테이블들에 필요한 마이그레이션 파일 이름(중복 없이, 번호 순서대로).
export function migrationsFor(tables: string[]): string[] {
  const files = tables.map((t) => MIGRATION_OF_TABLE[t]).filter((f): f is string => !!f);
  return [...new Set(files)].sort();
}

// 조회를 기다려서 행을 돌려주되, "테이블 없음"이면 던지지 않고 없는 테이블 이름을 함께 돌려준다(화면이 안내를 보여 줄 수 있게).
// 그 밖의 오류는 그대로 다시 던진다.
export async function rowsOrMissing<T>(load: PromiseLike<T[]>): Promise<{ rows: T[]; missing: string | null }> {
  try {
    return { rows: await load, missing: null };
  } catch (e) {
    const table = missingTable(e);
    if (!table) throw e;
    return { rows: [], missing: table };
  }
}

// rowsOrMissing와 같지만 행 배열이 아닌 값(여러 조회를 묶은 객체 등)을 돌려주는 조회용.
export async function valueOrMissing<T>(load: PromiseLike<T>): Promise<{ value: T | null; missing: string | null }> {
  try {
    return { value: await load, missing: null };
  } catch (e) {
    const table = missingTable(e);
    if (!table) throw e;
    return { value: null, missing: table };
  }
}

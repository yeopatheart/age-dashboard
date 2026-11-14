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
  label_designs: '0050_label_designs.sql',
  dispatch_log: '0052_dispatch_log.sql',
  board_ink: '0057_board_ink.sql',
  packing_submit_events: '0055_ops_event_log.sql',
  ops_event_log: '0055_ops_event_log.sql', // 테이블이 아니라 order_items에 더한 열(AI 보정 여부 ai_repaired)
  settlement_sales_edit: '0048_settlement_sales_edit.sql', // 테이블이 아니라 settlement_sales에 더한 열(품목·수량·단위 수정)
  label_printed_box_type: '0051_label_printed_box_type.sql', // 테이블이 아니라 box_labels에 더한 열(출력한 박스 종류)
  label_print_jobs: '0061_label_print_spooler.sql', // 라벨 출력 확정(스풀러 방식)
  settlement_shipping: '0062_settlement_shipping.sql',
  shipping_settings: '0062_settlement_shipping.sql', // 테이블이 아니라 terminals(quick_allowed)에 더한 열
  shipping_rates: '0063_customer_seller_terminal_rates.sql', // terminals에 더한 배송비 기본 금액 열(bus_rate·quick_rate·parcel_rate)
  business_fields: '0063_customer_seller_terminal_rates.sql', // businesses에 더한 열(legal_name·seller_id·uses_quick)
  order_item_base: '0060_order_item_base_quantity.sql', // 테이블이 아니라 order_items에 더한 열(처음 입력한 수량·단위)
};

// 오류가 "테이블 없음"이면 그 테이블 이름(못 읽으면 'unknown'), 아니면 null.
export function missingTable(error: unknown): string | null {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  // 마이그레이션 0047이 기존 테이블에 더한 열(단가 unit_price, 직인 seal_image)이 없을 때도 같은 안내를 한다.
  // 마이그레이션 0048이 settlement_sales에 더한 열(품목·수량·단위 수정값)이 없을 때도 같은 안내를 한다.
  // 마이그레이션 0051이 box_labels에 더한 열(printed_box_type)이 없을 때도 같은 안내를 한다.
  // 마이그레이션 0055가 order_items에 더한 열(ai_repaired)이 없을 때도 같은 안내를 한다.
  if (/ai_repaired/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'ops_event_log';
  // 마이그레이션 0062가 terminals에 더한 열(퀵 가능), 0063이 더한 열(터미널 배송비 금액, 고객사 사업자명·사업자구분·퀵 이용)이 없을 때도 같은 안내를 한다.
  if (/bus_rate|quick_rate|parcel_rate/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'shipping_rates';
  if (/legal_name|uses_quick|businesses\.seller_id/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'business_fields';
  if (/quick_allowed/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'shipping_settings';
  // 마이그레이션 0060이 order_items에 더한 열(base_quantity, base_unit)이 없을 때도 같은 안내를 한다.
  if (/base_quantity|base_unit/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'order_item_base';
  if (/printed_box_type/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'label_printed_box_type';
  if (/product_override|quantity_override|unit_override/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'settlement_sales_edit';
  if (/unit_price|seal_image/.test(message) && /does not exist|schema cache|Could not find/i.test(message)) return 'settlement_receipts';
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

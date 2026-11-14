import { Receipt } from 'lucide-react';
import { createClient } from '@/lib/supabase/server';
import { requireMenu } from '@/lib/permissions/access';
import { fetchAll } from '@/lib/supabase/fetch-all';
import { migrationsFor, rowsOrMissing, valueOrMissing } from '@/lib/supabase/missing-table';
import { AdminHeader } from '@/components/admin/admin-kit';
import { MigrationNotice } from '@/components/migration-notice';
import { todayKST } from '@/lib/order-date';
import { parseSettlementDate } from '@/lib/settlement/url';
import { loadSalesAndCards, loadShippingRows, loadStoredPurchases, loadSupplierDirectory } from '@/lib/settlement/server';
import { loadReceipts } from '@/lib/settlement/receipt-server';
import { buildPurchaseRows } from '@/lib/settlement/purchases';
import { SettlementBar } from './settlement-bar';
import { SettlementSection } from './settlement-section';
import { SheetClient } from './sheet-client';
import { PurchasesClient } from './purchases-client';

// 정산: 출고가 끝난 주문을 정산표(판매 + 배송비, 고객별 묶음)와 매입내역으로 보여 주고 수량·단가·판매가·사업자 구분·입금 여부·메모를 입력한다.
// 정산은 하루(출고일) 단위다. ?d=YYYY-MM-DD(기본 오늘, 미래는 오늘로 본다)로 날짜를 정하고, 두 구역(정산표·매입내역)이 같은 날짜를 쓴다.
export default async function SettlementPage({ searchParams }: { searchParams: Promise<{ d?: string; v?: string }> }) {
  const accessCheck = requireMenu('settlement'); // 권한 확인도 다른 조회와 같이 보낸다(보호는 await로 확정)
  const { d, v } = await searchParams;
  const today = todayKST();
  const date = parseSettlementDate(d, today);
  const supabase = await createClient();

  const header = <AdminHeader icon={<Receipt size={20} />} title="정산" sub="출고가 끝난 주문이 고객별로 묶인 정산표로 올라옵니다. 수량(실중량)·단가·판매가를 엑셀처럼 입력하면 바로 저장되고, 배송비는 터미널 설정으로 자동 계산됩니다. 기간별 매출·이익 그래프는 리포트의 판매·수익에서 봅니다." />;

  const [, salesAndCards, sellers, inputsTable, stored, directory, receipts] = await Promise.all([
    accessCheck,
    valueOrMissing(loadSalesAndCards(supabase, date, date)),
    rowsOrMissing(fetchAll((a, b) => supabase.from('seller_businesses').select('id, name').order('name').order('id').range(a, b), '사업자 조회 실패: ')),
    // 출고 완료 줄이 없는 기간에는 입력값 테이블을 조회하지 않으므로, 없는 마이그레이션을 한 번에 알려 주려고 존재만 따로 확인한다.
    rowsOrMissing(
      supabase
        .from('settlement_sales')
        .select('order_item_id')
        .limit(1)
        .then(({ error }) => {
          if (error) throw new Error(error.message);
          return [] as never[];
        }),
    ),
    // 매입내역에 쓰는 값. 0044를 적용하기 전이면 매입내역만 안내를 보여 주고 판매내역은 계속 쓴다.
    rowsOrMissing(loadStoredPurchases(supabase, date, date)),
    valueOrMissing(loadSupplierDirectory(supabase)),
    // 영수증 이력(0047): 판매내역에서 "이미 발행됨" 경고를 하는 데만 쓴다(목록은 영수증 메뉴). 적용 전이면 경고만 빠진다.
    rowsOrMissing(loadReceipts(supabase, date, date)),
  ]);

  // 마이그레이션(0042 사업자, 0043 판매 입력값)을 적용하기 전에 배포되면 테이블이 없다. 운영 화면은 서버 오류 문구를 가려서 "에러"만 보이므로 안내를 대신 보여 준다.
  const sales = { rows: salesAndCards.value?.rows ?? [], missing: salesAndCards.missing };
  const missing = [sales.missing, sellers.missing, inputsTable.missing].filter((x): x is string => !!x);
  if (missing.length > 0) {
    return (
      <div className="ak-page">
        {header}
        <MigrationNotice feature="정산" migrations={migrationsFor(missing)} />
      </div>
    );
  }

  // 매입내역의 행(출고일 × 품목)은 판매내역에서 계산하고, 사용자가 입력해서 저장한 값을 붙인다.
  const purchaseMissing = [stored.missing, directory.missing].filter((x): x is string => !!x);
  const purchaseNotice = (feature: string) => <MigrationNotice feature={feature} migrations={migrationsFor(purchaseMissing)} />;
  const purchaseRows = purchaseMissing.length === 0 && directory.value ? buildPurchaseRows(sales.rows, stored.rows) : null;
  // 화면에 나온 품목의 매입처 연결만 보낸다(전체 상품의 연결을 다 보내지 않는다).
  const shown = new Set((purchaseRows ?? []).map((r) => r.product));
  const supplierIdsByProduct = Object.fromEntries(Object.entries(directory.value?.supplierIdsByProduct ?? {}).filter(([name]) => shown.has(name)));

  // 배송비(0062): 출고 완료 카드마다 저장한 값 + 설정으로 만든 제안. 마이그레이션 전이면 배송비 구역만 안내를 보여 주고 나머지는 계속 쓴다.
  const shipping = await valueOrMissing(loadShippingRows(supabase, salesAndCards.value?.doneCards ?? [], sales.rows));
  // 고객 단위 사업자·입금(0064)·배송비(0062·0063) 마이그레이션 전이면 정산표 위에 안내를 보여 주고, 표의 나머지는 계속 쓴다.
  const sheetMissing = [...(salesAndCards.value?.cardSettingsAvailable === false ? ['settlement_cards'] : []), ...(shipping.missing ? [shipping.missing] : [])];

  // 날짜를 옮기면 입력 중이던 값·선택을 새로 시작한다(key가 바뀌면 화면 상태가 초기화된다).
  const key = `${date}-${v ?? ''}`; // v: 엑셀 가져오기 뒤 구역을 새로 그리려고 붙이는 값
  return (
    <div className="ak-page">
      {header}
      <SettlementBar
        key={date}
        date={date}
        today={today}
        data={{
          date,
          sales: sales.rows,
          shipping: shipping.value?.rows ?? null,
          purchases: purchaseRows,
          sellers: sellers.rows,
          suppliers: directory.value?.suppliers ?? [],
          shippingCustomers: (shipping.value?.cards ?? []).map((c) => c.customer),
        }}
      />
      <div className="ak-split">
        <SettlementSection id="sales" title="정산표" hint="판매 · 배송비" openOnMobile>
          {sheetMissing.length > 0 && <MigrationNotice feature="정산표의 고객 단위 입금·사업자구분과 배송비" migrations={migrationsFor(sheetMissing)} />}
          <SheetClient
            key={key}
            rows={sales.rows}
            shipping={shipping.value?.rows ?? null}
            cards={(shipping.value?.cards ?? []).map((c) => ({ cardId: c.cardId, boxes: c.boxes }))}
            sellers={sellers.rows}
            date={date}
            issued={receipts.missing ? [] : receipts.rows.map((r) => ({ orderDate: r.orderDate, customerName: r.customerName, sellerId: r.sellerId, receiptNo: r.receiptNo }))}
          />
        </SettlementSection>
        <SettlementSection id="purchases" title="매입내역">
          {purchaseRows && directory.value ? (
            <PurchasesClient key={key} rows={purchaseRows} sellers={sellers.rows} suppliers={directory.value.suppliers} supplierIdsByProduct={supplierIdsByProduct} />
          ) : (
            purchaseNotice('매입내역')
          )}
        </SettlementSection>
      </div>
    </div>
  );
}

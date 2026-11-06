// 영수증 한 장(품목표 15행)을 그리는 화면 컴포넌트. 기존 Auto-Receipt의 영수증 디자인을 그대로 옮겼다(폭 420px, 흑백, 명조 본문).
// 이미지(PNG)로 바꿀 때 이 요소를 그대로 찍으므로 폭·글꼴을 바꾸면 결과 이미지가 달라진다. 이미지 변환은 receipt-image.ts.
import { formatWon } from '@/lib/money';
import { formatRegistrationNo } from '@/lib/sellers';
import { formatQuantity, RECEIPT_PAGE_ROWS, type ReceiptLine, type ReceiptSnapshot } from '@/lib/settlement/receipt';

export const RECEIPT_WIDTH_PX = 420;
// 글꼴은 본문이 Noto Serif KR, 숫자·이름 칸이 Noto Sans KR이다(둘 다 @fontsource로 앱에 포함, 이미지 변환 때 필요한 조각만 넣는다).
export const RECEIPT_SERIF = "'Noto Serif KR', serif";
export const RECEIPT_SANS = "'Noto Sans KR', sans-serif";

export interface ReceiptSheetProps {
  snapshot: ReceiptSnapshot;
  pageLines: ReceiptLine[]; // 이 장에 찍을 품목 줄(최대 15줄)
  numberLabel: string; // 왼쪽 위 NO. (여러 장이면 7-1, 7-2)
  pageIndex: number;
  pageCount: number;
  sealImage: string | null; // 직인 PNG data URL. 없으면 "(인)"만 찍힌다
}

const DASH = '　'; // 빈 칸이 줄 높이를 잃지 않게 넣는 전각 공백

export function ReceiptSheet({ snapshot, pageLines, numberLabel, pageIndex, pageCount, sealImage }: ReceiptSheetProps) {
  const { seller, customerName, orderDate, total } = snapshot;
  const rows = Array.from({ length: RECEIPT_PAGE_ROWS }, (_, i) => pageLines[i]);
  const pageSum = pageLines.reduce((sum, l) => sum + l.amount, 0);
  const recipientSize = customerName.length > 15 ? '14px' : customerName.length > 10 ? '16px' : '18px';

  return (
    <div
      data-receipt-sheet
      className="w-[420px] bg-white text-black text-sm border-2 border-black p-2 pb-2 relative"
      style={{ fontFamily: RECEIPT_SERIF, letterSpacing: '-0.02em', boxSizing: 'border-box' }}
    >
      {/* 제목 */}
      <div className="mb-2 border-black relative">
        <div className="flex justify-center items-center relative mb-1 border-b border-black pb-1">
          <div className="absolute left-0 top-0 text-xs font-bold leading-none">NO. {numberLabel}</div>
          <div className="text-xl font-bold tracking-[0.3em] py-1">영 수 증</div>
        </div>
        <div className="flex flex-col items-end pb-1 border-b-2 border-black border-double">
          <div className="flex items-baseline gap-1 w-full justify-end">
            <span className="leading-tight text-right break-all" style={{ fontFamily: RECEIPT_SANS, fontSize: recipientSize }}>
              {customerName}
            </span>
            <span className="shrink-0">귀하</span>
          </div>
          <div className="text-[10px] scale-90 origin-right leading-none mt-1">(공급받는 자용)</div>
        </div>
      </div>

      {/* 공급자 */}
      <div className="flex w-full border border-black border-b-0">
        <div className="w-8 border-r border-black flex flex-col items-center justify-center text-center font-bold leading-tight py-2">
          <span>공</span>
          <span>급</span>
          <span>자</span>
        </div>
        <div className="flex-1 flex flex-col">
          <div className="flex border-b border-black">
            <div className="w-24 text-center border-r border-black py-1 flex items-center justify-center">등록번호</div>
            <div className="flex-1 text-center py-1 font-bold tracking-widest flex items-center justify-center text-sm" style={{ fontFamily: RECEIPT_SANS }}>
              {formatRegistrationNo(seller.registrationNo)}
            </div>
          </div>
          <div className="flex border-b border-black relative">
            <div className="w-24 text-center border-r border-black py-1 flex items-center justify-center">상 호</div>
            <div className="w-32 pl-2 py-1 flex items-center text-sm border-r border-black" style={{ fontFamily: RECEIPT_SANS }}>
              {seller.name}
            </div>
            <div className="w-12 border-r border-black flex items-center justify-center py-1">성 명</div>
            <div className="flex-1 pl-2 py-1 flex items-center text-sm relative" style={{ fontFamily: RECEIPT_SANS }}>
              {seller.representative ?? ''}
              <div className="text-xs absolute right-2 flex items-center h-full"> (인) </div>
              {sealImage && (
                // eslint-disable-next-line @next/next/no-img-element -- 이미지로 변환하는 화면이라 data URL을 그대로 쓴다
                <img
                  src={sealImage}
                  alt="직인"
                  className="absolute translate-x-1/2 top-1/2 -translate-y-1/2 object-contain opacity-85 pointer-events-none max-w-none w-[120px] h-[120px] right-[16px]"
                  style={{ mixBlendMode: 'multiply' }}
                />
              )}
            </div>
          </div>
          <div className="flex border-b border-black">
            <div className="w-24 text-center border-r border-black py-1 flex items-center justify-center">
              사 업 장
              <br />
              소재지
            </div>
            <div className="flex-1 pl-2 text-[10px] flex items-center leading-tight">{seller.address ?? ''}</div>
          </div>
          <div className="flex">
            <div className="w-24 text-center border-r border-black py-1 flex items-center justify-center">업 태</div>
            <div className="w-24 text-center border-r border-black py-1 text-xs flex items-center justify-center">{seller.businessType ?? ''}</div>
            <div className="w-16 text-center border-r border-black py-1 flex items-center justify-center">종목</div>
            <div className="flex-1 text-center py-1 text-xs flex items-center justify-center">{seller.businessItem ?? ''}</div>
          </div>
        </div>
      </div>

      {/* 작성일 · 총액 */}
      <div className="flex w-full border border-black mb-1">
        <div className="w-[100px] text-center border-r border-black py-1 text-xs shrink-0">작성년월일</div>
        <div className="flex-1 text-center border-r border-black py-1 text-xs">공급대가총액</div>
        <div className="w-[40px] text-center py-1 text-xs shrink-0 tracking-tighter">비 고</div>
      </div>
      <div className="flex w-full border border-black">
        <div className="w-[100px] shrink-0 text-center border-r border-black text-base h-8 flex items-center justify-center" style={{ fontFamily: RECEIPT_SANS }}>
          {orderDate.replace(/-/g, '.')}
        </div>
        <div className="flex-1 px-2 border-r border-black h-8 flex items-center text-base" style={{ fontFamily: RECEIPT_SANS }}>
          ₩ {formatWon(total)}
        </div>
        <div className="w-[40px] shrink-0 h-8"></div>
      </div>
      <div className="flex w-full border border-black mb-2 border-t-0 bg-white items-center justify-center font-bold text-sm py-1">공 급 내 역</div>

      {/* 품목표 머리 */}
      <div className="flex w-full border border-black bg-gray-50 text-center font-medium">
        <div className="w-[30px] border-r border-black py-1 whitespace-nowrap text-xs shrink-0">월일</div>
        <div className="flex-1 border-r border-black py-1 whitespace-nowrap text-xs">품 목</div>
        <div className="w-[85px] border-r border-black py-1 whitespace-nowrap text-xs shrink-0">수 량</div>
        <div className="w-[50px] border-r border-black py-1 whitespace-nowrap text-xs shrink-0 tracking-tighter">단 가</div>
        <div className="w-[85px] py-1 whitespace-nowrap text-[11px] leading-tight shrink-0">공급대가(금액)</div>
      </div>

      {/* 품목 15행(빈 행은 첫 칸에 대각선) */}
      <div className="border border-t-0 border-black relative">
        {rows.map((line, i) => (
          <div key={i} className="flex border-b border-black last:border-b-0 h-7 w-full" style={line ? {} : { color: 'transparent' }}>
            <div
              className="w-[30px] border-r border-black relative overflow-hidden flex items-center justify-center shrink-0"
              style={{ background: line ? 'none' : 'linear-gradient(to top right, transparent calc(50% - 0.7px), #bbb 50%, transparent calc(50% + 0.7px))' }}
            ></div>
            <div
              className="flex-1 border-r border-black px-1 break-all flex items-center min-w-0"
              style={{
                fontFamily: RECEIPT_SANS,
                fontSize: !line ? '14px' : line.product.length > 22 ? '9px' : line.product.length > 14 ? '11px' : '14px',
                lineHeight: !line ? '1.2' : line.product.length > 14 ? '1.1' : '1.2',
              }}
            >
              {line?.product || DASH}
            </div>
            <div className="w-[85px] border-r border-black px-1 text-center text-sm flex items-center justify-center overflow-hidden whitespace-nowrap text-ellipsis tracking-tighter shrink-0" style={{ fontFamily: RECEIPT_SANS }}>
              {line ? formatQuantity(line.quantity, line.unit) : DASH}
            </div>
            <div className="w-[50px] border-r border-black shrink-0 flex items-center justify-center text-sm tracking-tighter whitespace-nowrap overflow-hidden" style={{ fontFamily: RECEIPT_SANS }}>
              {line?.unitPrice != null ? formatWon(line.unitPrice) : DASH}
            </div>
            <div className="w-[85px] px-1 text-right text-sm flex items-center justify-end overflow-hidden whitespace-nowrap tracking-tighter shrink-0" style={{ fontFamily: RECEIPT_SANS }}>
              {line ? formatWon(line.amount) : DASH}
            </div>
          </div>
        ))}
      </div>

      {/* 합계(여러 장이면 장별 소계) */}
      <div className="flex w-full border border-black border-t-0 bg-gray-50">
        <div className="flex-1 text-center font-bold py-1">{pageCount > 1 ? `소 계 (${pageIndex + 1}/${pageCount})` : '합 계'}</div>
        <div className="w-[220px] shrink-0 px-1 flex text-base items-center justify-end border-l border-black" style={{ fontFamily: RECEIPT_SANS }}>
          ₩ {formatWon(pageSum)}
        </div>
      </div>

      <div className="text-center text-xs mt-1 pb-4">위 금액을 청구(영수)함</div>
    </div>
  );
}

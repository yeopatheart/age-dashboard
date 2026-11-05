// 정산 화면의 주소. 기간(?g=day|week|month, ?d=기준일)과 탭(?t=purchases, 판매내역은 생략)을 한 곳에서 만든다.
import type { Granularity } from '@/lib/report';

export type SettlementTab = 'sales' | 'purchases';

export const settlementUrl = (g: Granularity, d: string, tab: SettlementTab = 'sales') => `/settlement?g=${g}&d=${d}${tab === 'purchases' ? '&t=purchases' : ''}`;

// "오늘" 버튼: 기간은 기본값(오늘, 일)으로 돌리고 탭만 유지한다.
export const settlementTodayUrl = (tab: SettlementTab = 'sales') => (tab === 'purchases' ? '/settlement?t=purchases' : '/settlement');

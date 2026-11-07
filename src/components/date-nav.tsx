'use client';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { getPeriod, shiftAnchor, type Granularity } from '@/lib/report';

// 날짜·기간 선택 줄 — 앱 전체에서 이것 하나만 쓴다: [‹] [날짜 알약] [›] [오늘]. 모양(.dn-*)은 globals.css의 "공용 날짜·구분 컨트롤" 한 곳에서 정한다.
// 메뉴마다 따로 만들면 버튼 모양·크기·글자가 제각각이 된다(2026-11-07에 5가지로 갈라져 있던 것을 합쳤다).
//  - 날짜 알약은 글자만 보이고, 진짜 날짜 입력칸은 투명하게 겹쳐 있다. 누르면 기기의 날짜 선택이 열린다(PC는 showPicker).
//    입력칸 글자는 16px라 iOS가 눌렀을 때 화면을 확대하지 않는다.
//  - "오늘"은 오늘이 아닐 때만 나온다(채운 색).
function DateStepper({
  text,
  pickValue,
  max,
  onPick,
  onPrev,
  onNext,
  nextDisabled,
  showToday,
  onToday,
  label,
  prevTitle,
  nextTitle,
  grow = false,
}: {
  text: string;
  pickValue: string;
  max: string;
  onPick: (date: string) => void;
  onPrev: () => void;
  onNext: () => void;
  nextDisabled: boolean;
  showToday: boolean;
  onToday: () => void;
  label: string;
  prevTitle: string;
  nextTitle: string;
  grow?: boolean;
}) {
  return (
    <div className={`dn-root ${grow ? 'dn-grow' : ''}`} role="group" aria-label={label}>
      <button type="button" className="dn-btn" onClick={onPrev} title={prevTitle} aria-label={prevTitle}><ChevronLeft size={14} /></button>
      <span className="dn-date-wrap">
        <span className="dn-date-text" aria-hidden>{text}</span>
        <input
          type="date"
          className="dn-date"
          value={pickValue}
          max={max}
          onChange={(e) => e.target.value && onPick(e.target.value)}
          onClick={(e) => {
            // PC 브라우저는 날짜 칸을 눌러도 선택창이 바로 열리지 않아 직접 연다(터치 기기는 기기 선택창이 열린다).
            if (window.matchMedia('(pointer: fine)').matches) {
              try {
                e.currentTarget.showPicker();
              } catch {
                // 지원하지 않는 브라우저는 입력칸을 직접 편집한다
              }
            }
          }}
          aria-label={label}
        />
      </span>
      <button type="button" className="dn-btn" onClick={onNext} disabled={nextDisabled} title={nextTitle} aria-label={nextTitle}><ChevronRight size={14} /></button>
      {showToday && <button type="button" className="dn-today" onClick={onToday}>오늘</button>}
    </div>
  );
}

// 하루 단위(박스 할당·주문 입력·대시보드·주문 목록). 미래 날짜는 고를 수 없다.
export function DateNav({ value, today, onChange, label = '날짜', grow = false }: { value: string; today: string; onChange: (date: string) => void; label?: string; grow?: boolean }) {
  const shift = (days: number) => {
    const d = new Date(`${value}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    const next = d.toISOString().slice(0, 10);
    if (next <= today) onChange(next);
  };
  return (
    <DateStepper
      text={value.replaceAll('-', '.')}
      pickValue={value}
      max={today}
      onPick={onChange}
      onPrev={() => shift(-1)}
      onNext={() => shift(1)}
      nextDisabled={value >= today}
      showToday={value !== today}
      onToday={() => onChange(today)}
      label={label}
      prevTitle="전날"
      nextTitle="다음날"
      grow={grow}
    />
  );
}

// 일·주·월 단위(정산·영수증·리포트). 가운데 알약에 기간 이름(예: 2026.11.02 ~ 11.08)을 보여 주고, 누르면 기준 날짜를 고른다.
export function PeriodNav({
  granularity,
  anchor,
  today,
  periodLabel,
  onChange,
  label = '기간 기준 날짜',
  grow = false,
}: {
  granularity: Granularity;
  anchor: string;
  today: string;
  periodLabel: string;
  onChange: (anchor: string) => void;
  label?: string;
  grow?: boolean;
}) {
  const nextAnchor = shiftAnchor(granularity, anchor, 1);
  return (
    <DateStepper
      text={periodLabel}
      pickValue={anchor}
      max={today}
      onPick={onChange}
      onPrev={() => onChange(shiftAnchor(granularity, anchor, -1))}
      onNext={() => onChange(nextAnchor)}
      nextDisabled={getPeriod(granularity, nextAnchor).from > today} // 아직 오지 않은 기간으로는 못 간다
      showToday={getPeriod(granularity, anchor).from !== getPeriod(granularity, today).from}
      onToday={() => onChange(today)}
      label={label}
      prevTitle="이전"
      nextTitle="다음"
      grow={grow}
    />
  );
}

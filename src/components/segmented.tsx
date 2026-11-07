import Link from 'next/link';

// 구분 선택(일/주/월, 전체/기본/별도, 보기 전환 …) — 앱 전체에서 이 모양 하나만 쓴다(.sg-*, globals.css "공용 날짜·구분 컨트롤").
// 항목에 href가 있으면 주소 이동(Link), 없으면 버튼이다. fill이면 가로 폭을 꽉 채워 나눈다(휴대폰의 한 줄 구분).
export interface SegmentedItem<K extends string> {
  key: K;
  label: string;
  href?: string;
}

export function Segmented<K extends string>({
  items,
  value,
  onSelect,
  label,
  fill = false,
}: {
  items: SegmentedItem<K>[];
  value: K;
  onSelect?: (key: K) => void;
  label: string;
  fill?: boolean;
}) {
  return (
    <div className={`sg-root ${fill ? 'sg-fill' : ''}`} role="group" aria-label={label}>
      {items.map((item) => {
        const className = `sg-item ${item.key === value ? 'sg-on' : ''}`;
        return item.href ? (
          <Link key={item.key} href={item.href} className={className} aria-current={item.key === value ? 'true' : undefined}>{item.label}</Link>
        ) : (
          <button key={item.key} type="button" className={className} aria-pressed={item.key === value} onClick={() => onSelect?.(item.key)}>{item.label}</button>
        );
      })}
    </div>
  );
}

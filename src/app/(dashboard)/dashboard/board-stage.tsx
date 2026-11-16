'use client';
import { useLayoutEffect, useRef, useState } from 'react';
import { stageLayout, type StageLayout } from '@/lib/board-stage';

export interface StageInfo {
  native: boolean; // 배율 없이 그리는 중(칠판)이면 true. 펜으로 쓸 수 있는 것도 이때뿐이다.
  scale: number;
}

interface Props {
  enabled: boolean; // 모니터 1·2일 때만 기준 화면으로 그린다(전체보기·휴대폰은 창을 그대로 쓴다)
  onChange: (info: StageInfo) => void;
  children: React.ReactNode;
}

// 모니터 1·2의 도구줄과 표를 칠판 크기의 기준 화면(src/lib/board-stage.ts)에 그리고, 창이 다르면 통째로 확대·축소한다.
// 같은 줄이 같은 모니터에 나오고 필기가 같은 위치에 보이게 하려는 것이다. 모달·팝업은 이 안에 넣지 않는다(화면 좌표로 위치를 잡는다).
// 바깥 영역은 항상 같은 요소로 두어서 모니터를 바꿔도 안쪽 표가 다시 만들어지지 않는다.
export function BoardStage({ enabled, onChange, children }: Props) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<StageLayout | null>(null);
  const reported = useRef<StageInfo>({ native: true, scale: 1 });

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const measure = () => {
      const next = stageLayout(el.clientWidth, el.clientHeight);
      setLayout((prev) => (prev && prev.native === next.native && prev.scale === next.scale && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scaled = enabled && layout !== null && !layout.native;
  const info: StageInfo = scaled && layout ? { native: false, scale: layout.scale } : { native: true, scale: 1 };
  useLayoutEffect(() => {
    if (reported.current.native === info.native && reported.current.scale === info.scale) return;
    reported.current = info;
    onChange(info);
  });

  return (
    <div ref={outerRef} data-board-stage-outer className="relative h-[calc(100vh-24px)] w-full min-w-0 overflow-hidden">
      {scaled && layout ? (
        <div className="absolute flex flex-col" style={{ left: layout.left, top: layout.top, width: layout.width, height: layout.height, transform: `scale(${layout.scale})`, transformOrigin: 'top left' }}>
          {children}
        </div>
      ) : (
        <div className="flex h-full w-full flex-col">{children}</div>
      )}
    </div>
  );
}

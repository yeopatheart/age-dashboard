'use client';
import { useEffect, useRef } from 'react';
import { inkBlockers, type BoardEnvReport, type InkWriterTerms } from '@/lib/board-env';
import { reportBoardEnv } from './actions';

interface Props {
  monitor: string;
  orderDate: string;
  today: string;
  penParam: string | null;
  inkHidden: boolean;
  stageScale: number;
  inkWriter: boolean;
  terms: InkWriterTerms;
}

const FIRST_REPORT_MS = 3_000; // 화면이 자리잡은 뒤(기준 화면·권한 측정이 끝난 뒤) 한 번
const CHECK_MS = 20_000; // 그 뒤 판정이 바뀌었는지 확인한다(바뀔 때만 다시 보낸다)
const MAX_REPORTS = 5;
const SIDEBAR_KEY = 'age-dashboard-sidebar-collapsed';

// 터치가 있는 기기(스마트 칠판)가 주문 목록을 열면 "펜으로 쓸 수 있는가, 아니면 왜 막혔는가"를 서버 로그에 한 줄 남긴다(src/lib/board-env.ts).
// 화면에는 아무것도 그리지 않고 동작도 바꾸지 않는다. 보내지 못해도(연결 끊김) 조용히 넘어간다.
export function BoardEnvReporter(props: Props) {
  const latest = useRef(props);
  useEffect(() => {
    latest.current = props;
  });
  const sent = useRef({ count: 0, lastKey: '' });

  useEffect(() => {
    if (navigator.maxTouchPoints < 1 && latest.current.penParam !== '1') return; // 터치가 없는 PC는 남기지 않는다
    const startedAt = Date.now();
    const send = () => {
      const p = latest.current;
      const blockers = inkBlockers(p.terms);
      const key = JSON.stringify([p.inkWriter, blockers, p.stageScale]);
      if (sent.current.count >= MAX_REPORTS || key === sent.current.lastKey) return;
      sent.current = { count: sent.current.count + 1, lastKey: key };
      const outer = document.querySelector<HTMLElement>('[data-board-stage-outer]');
      const vv = window.visualViewport;
      let sidebarCollapsed: boolean | null = null;
      try {
        const raw = localStorage.getItem(SIDEBAR_KEY);
        sidebarCollapsed = raw === null ? null : raw === '1';
      } catch {
        // localStorage가 막혀 있으면 알 수 없다
      }
      const report: BoardEnvReport = {
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        devicePixelRatio: window.devicePixelRatio,
        visualViewportWidth: vv ? vv.width : null,
        visualViewportHeight: vv ? vv.height : null,
        visualViewportScale: vv ? vv.scale : null,
        maxTouchPoints: navigator.maxTouchPoints,
        userAgent: navigator.userAgent,
        platform: navigator.platform,
        monitor: p.monitor,
        orderDate: p.orderDate,
        today: p.today,
        sidebarCollapsed,
        penParam: p.penParam,
        stageOuterWidth: outer ? outer.clientWidth : null,
        stageOuterHeight: outer ? outer.clientHeight : null,
        stageScale: p.stageScale,
        terms: p.terms,
        inkWriter: p.inkWriter,
        blockers,
        inkHidden: p.inkHidden,
        seq: sent.current.count,
        sinceLoadMs: Date.now() - startedAt,
      };
      void reportBoardEnv(report).catch(() => undefined);
    };
    const first = setTimeout(send, FIRST_REPORT_MS);
    const check = setInterval(send, CHECK_MS);
    return () => {
      clearTimeout(first);
      clearInterval(check);
    };
  }, []);

  return null;
}

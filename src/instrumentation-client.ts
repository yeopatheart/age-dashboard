// 브라우저에서 앱보다 먼저 실행된다. 성능 계측을 시작하고 메뉴 이동의 시작 시점을 받는다(src/lib/perf-client.ts).
import { onTransitionStart, startPerf } from '@/lib/perf-client';

startPerf();

export function onRouterTransitionStart(url: string) {
  onTransitionStart(url);
}

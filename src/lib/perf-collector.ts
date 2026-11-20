// 계측 기록을 모았다가 묶어서 보낸다(순수 로직, 실제 전송은 send로 주입). 계측이 화면을 느리게 하거나 끝없이 재시도하면 안 된다:
// 메모리는 maxBuffer까지만 담고(넘치면 오래된 것부터 버린다), 보내다 실패하면 그 묶음은 버리고, 연속 실패가 쌓이거나 서버가 "그만"이라고 하면 이 화면에서는 멈춘다.
import { MAX_EVENTS_PER_REQUEST, type PerfEvent } from './perf-payload.ts';

export type SendResult = 'ok' | 'disabled' | 'failed';

export interface CollectorOptions {
  maxBuffer?: number;
  batchSize?: number;
  maxFailures?: number;
}

export function createCollector(send: (events: PerfEvent[]) => Promise<SendResult>, options: CollectorOptions = {}) {
  const maxBuffer = options.maxBuffer ?? 200;
  const batchSize = Math.min(options.batchSize ?? MAX_EVENTS_PER_REQUEST, MAX_EVENTS_PER_REQUEST);
  const maxFailures = options.maxFailures ?? 3;
  let buffer: PerfEvent[] = [];
  let disabled = false;
  let failures = 0;
  let flushing = false;

  return {
    push(event: PerfEvent) {
      if (disabled) return;
      buffer.push(event);
      if (buffer.length > maxBuffer) buffer.splice(0, buffer.length - maxBuffer);
    },
    /** 쌓인 기록을 batchSize씩 보낸다. 이미 보내는 중이면 건너뛴다. 이 함수는 던지지 않는다. */
    async flush() {
      if (disabled || flushing || buffer.length === 0) return;
      flushing = true;
      try {
        while (buffer.length > 0 && !disabled) {
          const batch = buffer.splice(0, batchSize);
          let result: SendResult;
          try {
            result = await send(batch);
          } catch {
            result = 'failed';
          }
          if (result === 'disabled') {
            disabled = true;
            buffer = [];
          } else if (result === 'failed') {
            failures += 1;
            if (failures >= maxFailures) {
              disabled = true;
              buffer = [];
            }
            break; // 다음 주기에 다시 시도한다(이번 묶음은 버린다)
          } else {
            failures = 0;
          }
        }
      } finally {
        flushing = false;
      }
    },
    /** 창을 닫을 때처럼 기다릴 수 없을 때: 남은 기록을 한꺼번에 꺼내 batchSize씩 나눠 돌려주고 비운다. */
    drain(): PerfEvent[][] {
      if (disabled || buffer.length === 0) return [];
      const batches: PerfEvent[][] = [];
      for (let i = 0; i < buffer.length; i += batchSize) batches.push(buffer.slice(i, i + batchSize));
      buffer = [];
      return batches;
    },
    get size() {
      return buffer.length;
    },
    get isDisabled() {
      return disabled;
    },
  };
}

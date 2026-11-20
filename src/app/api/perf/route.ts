// 성능 계측 기록 저장(src/lib/perf-client.ts가 1분마다·창을 닫을 때 보낸다). 결정: docs/decisions/2026-11-20-perf-telemetry.md
// 로그인한 사용자만(src/proxy.ts가 로그인 확인을 하고, DB 정책도 authenticated만 저장하게 한다). 서비스 키는 쓰지 않는다.
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { MAX_BODY_BYTES, parsePerfPayload, toPerfRow } from '@/lib/perf-payload';

const SWITCH_CACHE_MS = 60_000;
const PURGE_EVERY_MS = 3_600_000;

// 서버 인스턴스마다 기억한다. 끄기 스위치(app_settings 'perfEnabled')는 최대 1분 늦게 반영된다.
let switchCache: { enabled: boolean; at: number } | null = null;
let lastPurgeAt = 0;

export async function POST(request: Request) {
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: 'too large' }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'bad json' }, { status: 400 });
  }
  const events = parsePerfPayload(body);
  if (!events) return NextResponse.json({ error: 'bad payload' }, { status: 400 });

  const supabase = await createClient();

  const now = Date.now();
  if (!switchCache || now - switchCache.at > SWITCH_CACHE_MS) {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'perfEnabled').maybeSingle();
    switchCache = { enabled: data?.value !== false, at: now }; // 행이 없거나 읽지 못하면 켜진 것으로 본다
  }
  if (!switchCache.enabled) return NextResponse.json({ enabled: false });
  if (events.length === 0) return NextResponse.json({ enabled: true });

  const { error } = await supabase.from('perf_events').insert(events.map(toPerfRow));
  if (error) {
    console.error('[perf] insert failed', error.code, error.message);
    return NextResponse.json({ error: 'insert failed' }, { status: 500 });
  }

  if (now - lastPurgeAt > PURGE_EVERY_MS) {
    lastPurgeAt = now;
    const { error: purgeError } = await supabase.rpc('purge_perf_events');
    if (purgeError) console.error('[perf] purge failed', purgeError.code, purgeError.message);
  }
  return NextResponse.json({ enabled: true });
}

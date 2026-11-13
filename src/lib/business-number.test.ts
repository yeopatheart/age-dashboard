import test from 'node:test';
import assert from 'node:assert/strict';
import type { SupabaseClient } from '@supabase/supabase-js';
import { assignBusinessNumber, separateTerminalIds } from './business-lookup.ts';

// 부른 RPC 이름과 터미널 조회를 기록하는 가짜 클라이언트. 필요한 만큼만 흉내 낸다.
function fakeSupabase(opts: { separateIds?: string[]; rpcResult?: { data: number | null; error: { message: string } | null } } = {}) {
  const calls: { rpc: string[]; terminalQueries: string[][] } = { rpc: [], terminalQueries: [] };
  const client = {
    rpc: async (name: string) => {
      calls.rpc.push(name);
      return opts.rpcResult ?? { data: name === 'assign_separate_business_number' ? 501 : 7, error: null };
    },
    from: (table: string) => {
      assert.equal(table, 'terminals');
      let queried: string[] = [];
      const chain = {
        select: () => chain,
        in: (_column: string, ids: string[]) => {
          queried = ids;
          calls.terminalQueries.push(ids);
          return chain;
        },
        eq: async () => ({ data: (opts.separateIds ?? []).filter((id) => queried.includes(id)).map((id) => ({ id })), error: null }),
      };
      return chain;
    },
  };
  return { supabase: client as unknown as SupabaseClient, calls };
}

test('a normal order takes its number from the main counter', async () => {
  const { supabase, calls } = fakeSupabase();
  assert.equal(await assignBusinessNumber(supabase, '2026-11-13', false), 7);
  assert.deepEqual(calls.rpc, ['assign_business_number']);
});

test('a separate order takes its number from the separate counter', async () => {
  const { supabase, calls } = fakeSupabase();
  assert.equal(await assignBusinessNumber(supabase, '2026-11-13', true), 501);
  assert.deepEqual(calls.rpc, ['assign_separate_business_number']);
});

test('a number that could not be issued is an error, never a fallback number', async () => {
  const failing = fakeSupabase({ rpcResult: { data: null, error: { message: '일반 주문 번호는 하루 500번까지입니다' } } });
  await assert.rejects(() => assignBusinessNumber(failing.supabase, '2026-11-13', false), /업체 번호 발급 실패: 일반 주문 번호는 하루 500번까지/);
  const empty = fakeSupabase({ rpcResult: { data: null, error: null } });
  await assert.rejects(() => assignBusinessNumber(empty.supabase, '2026-11-13', false), /응답 없음/);
});

test('only separate terminals are picked out, and cards without a terminal are never separate', async () => {
  const { supabase, calls } = fakeSupabase({ separateIds: ['t-parcel'] });
  const ids = await separateTerminalIds(supabase, ['t-parcel', 't-main', null, 't-parcel']);
  assert.deepEqual([...ids], ['t-parcel']);
  assert.deepEqual(calls.terminalQueries, [['t-parcel', 't-main']]); // 중복·null은 조회하지 않는다
});

test('no terminal query is made when no card has a terminal', async () => {
  const { supabase, calls } = fakeSupabase();
  assert.equal((await separateTerminalIds(supabase, [null, null])).size, 0);
  assert.deepEqual(calls.terminalQueries, []);
});

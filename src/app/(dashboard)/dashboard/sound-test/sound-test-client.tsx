'use client';
import { useEffect, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { describeEvent, EVENT_LABEL, EVENT_PRIORITY, planCues, type OrderEvent, type OrderEventKind } from '@/lib/sound/order-events';
import { playCues } from '@/lib/sound/player';
import { useSoundSettings } from '@/lib/sound/settings';
import { isAudioRunning, subscribeAudioState, unlockAudio } from '@/lib/sound/tones';
import { koreanVoices, primeVoice } from '@/lib/sound/voice';

// 현장에서 소리를 골라 보는 화면: 이벤트별 소리 듣기, 톤/음성 전환, 볼륨, 이벤트별 켜기·끄기, 묶음 알림 시연.
// 설정은 이 기기에만 저장된다(칠판마다 따로).
const sample = (kind: OrderEventKind): OrderEvent => ({ kind, business: '스시고유', product: '광어', round: kind === 'order-new' ? 2 : undefined });

const BURST: OrderEvent[] = [
  sample('order-new'),
  sample('order-new'),
  { kind: 'item-added', business: '스시고유', product: '광어' },
  { kind: 'item-added', business: '해성수산', product: '참돔' },
  { kind: 'item-added', business: '해성수산', product: '농어' },
  { kind: 'qty-changed', business: '바다횟집', product: '우럭' },
  { kind: 'item-cancelled', business: '바다횟집', product: '도다리' },
];

export function SoundTestClient() {
  const [settings, update] = useSoundSettings();
  const running = useSyncExternalStore(subscribeAudioState, isAudioRunning, () => false);
  const [voices, setVoices] = useState<string[] | null>(null);

  // 음성 목록은 브라우저가 늦게 채우므로(voiceschanged) 이벤트로도 다시 읽는다.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return;
    const read = () => setVoices(koreanVoices().map((v) => `${v.name} (${v.lang})`));
    read();
    window.speechSynthesis.addEventListener('voiceschanged', read);
    return () => window.speechSynthesis.removeEventListener('voiceschanged', read);
  }, []);

  const play = (events: OrderEvent[]) => void playCues(planCues(events, settings.mode, []), settings.mode, settings.volume);
  const toggleKind = (kind: OrderEventKind) =>
    update({ disabled: settings.disabled.includes(kind) ? settings.disabled.filter((k) => k !== kind) : [...settings.disabled, kind] });

  return (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-bold text-slate-800">칠판 소리 설정</h1>
        <Link href="/dashboard" className="text-sm font-bold text-sky-700 hover:underline">← 주문 목록</Link>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              await unlockAudio();
              primeVoice();
            }}
            className="h-10 px-4 rounded-lg bg-slate-800 text-white text-sm font-bold"
          >
            소리 켜기
          </button>
          <span className={`text-sm font-bold ${running ? 'text-emerald-600' : 'text-amber-600'}`}>{running ? '오디오 사용 가능' : '아직 꺼져 있음 — 위 버튼을 눌러야 소리가 납니다'}</span>
        </div>
        <p className="text-sm text-slate-600">
          한국어 음성:{' '}
          {voices === null ? '확인 중' : voices.length > 0 ? <b className="text-emerald-700">{voices.join(', ')}</b> : <b className="text-red-600">없음 — 이 기기에서는 음성 모드가 소리를 내지 못합니다(톤만 사용)</b>}
        </p>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-4">
        <div className="flex items-center gap-4 text-sm font-bold text-slate-700">
          <label className="flex items-center gap-1"><input type="radio" checked={settings.mode === 'voice'} onChange={() => update({ mode: 'voice' })} />톤 + 음성</label>
          <label className="flex items-center gap-1"><input type="radio" checked={settings.mode === 'tone'} onChange={() => update({ mode: 'tone' })} />톤만</label>
        </div>
        <label className="flex items-center gap-3 text-sm font-bold text-slate-700">
          볼륨
          <input type="range" min={0.1} max={1} step={0.1} value={settings.volume} onChange={(e) => update({ volume: Number(e.target.value) })} className="flex-1" />
          <span className="w-10 text-right">{Math.round(settings.volume * 100)}%</span>
        </label>
      </section>

      <section className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
        {EVENT_PRIORITY.map((kind) => (
          <div key={kind} className="flex items-center gap-3 p-3">
            <input type="checkbox" checked={!settings.disabled.includes(kind)} onChange={() => toggleKind(kind)} className="h-5 w-5" aria-label={`${EVENT_LABEL[kind]} 소리 켜기`} />
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold text-slate-800">{EVENT_LABEL[kind]}</div>
              <div className="text-xs text-slate-500 truncate">{describeEvent(sample(kind))}</div>
            </div>
            <button type="button" onClick={() => play([sample(kind)])} className="h-9 px-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">듣기</button>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-2">
        <div className="text-sm font-bold text-slate-800">한꺼번에 여러 건이 바뀔 때</div>
        <p className="text-xs text-slate-500">3초 안에 4건 이상이면 줄줄이 읽지 않고 요약합니다. 포장 끝난 품목 변경은 요약과 별도로 먼저 알립니다.</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => play(BURST)} className="h-9 px-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">7건 묶음 듣기</button>
          <button type="button" onClick={() => play([...BURST, sample('packed-item-changed')])} className="h-9 px-3 rounded-lg border border-slate-300 text-sm font-bold text-slate-700 hover:bg-slate-50">긴급 포함 묶음 듣기</button>
        </div>
      </section>
    </div>
  );
}

'use client';
import { useMemo, useSyncExternalStore } from 'react';
import { EVENT_PRIORITY, type OrderEventKind } from './order-events';

// 칠판 소리 설정. 이 브라우저(기기)마다 따로 localStorage에 저장하고 서버에는 보내지 않는다.
// 지금 읽는 방식(use-local-flag.ts)과 같은 useSyncExternalStore 방식이다.
export interface SoundSettings {
  mode: 'voice' | 'tone'; // voice = 톤 + 짧은 한국어 음성, tone = 톤만
  volume: number; // 0.1 ~ 1
  disabled: OrderEventKind[]; // 소리를 내지 않을 이벤트 종류
}

// 포장 체크는 칠판 두 대에서 하루 수십 번 울리면 소음이라 기본은 꺼 둔다.
export const DEFAULT_SOUND_SETTINGS: SoundSettings = { mode: 'voice', volume: 0.8, disabled: ['item-packed'] };

const KEY = 'board-sound-settings';
const listeners = new Set<() => void>();

function parse(raw: string): SoundSettings {
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return DEFAULT_SOUND_SETTINGS;
    const o = value as Record<string, unknown>;
    return {
      mode: o.mode === 'tone' ? 'tone' : 'voice',
      volume: typeof o.volume === 'number' ? Math.min(1, Math.max(0.1, o.volume)) : DEFAULT_SOUND_SETTINGS.volume,
      disabled: Array.isArray(o.disabled) ? EVENT_PRIORITY.filter((k) => (o.disabled as unknown[]).includes(k)) : DEFAULT_SOUND_SETTINGS.disabled,
    };
  } catch {
    return DEFAULT_SOUND_SETTINGS; // 저장된 값이 없거나 깨졌으면 기본값
  }
}

const subscribe = (cb: () => void) => {
  listeners.add(cb);
  window.addEventListener('storage', cb);
  return () => {
    listeners.delete(cb);
    window.removeEventListener('storage', cb);
  };
};

const readRaw = () => {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return ''; // localStorage가 막혀 있으면(시크릿 모드 등) 기본값
  }
};

export function useSoundSettings(): [SoundSettings, (patch: Partial<SoundSettings>) => void] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => '');
  const settings = useMemo(() => parse(raw), [raw]);
  const update = (patch: Partial<SoundSettings>) => {
    try {
      localStorage.setItem(KEY, JSON.stringify({ ...settings, ...patch }));
    } catch {
      // 저장이 막혀 있으면 저장 없이 끝난다(이번 화면에서도 바뀌지 않는다)
    }
    listeners.forEach((l) => l());
  };
  return [settings, update];
}

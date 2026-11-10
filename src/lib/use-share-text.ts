'use client';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { cleanShareText } from './share-text';

// 글을 카카오톡 등으로 보내는 공통 동작: 공유(휴대폰 공유 창) → 복사 → 직접 복사 안내(prompt) 순서로 물러난다.
// key는 어느 항목을 복사했는지 표시하려는 이름(터미널·업체 등)이다. copiedKey가 key와 같으면 "복사됨"을 2.5초 보여 준다.
export function useShareText() {
  const canShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === 'function',
    () => false,
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(cleanShareText(text));
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2500);
    } catch {
      window.prompt('아래 글을 복사해서 붙여넣으세요.', cleanShareText(text));
    }
  }, []);

  const share = useCallback(
    async (key: string, text: string) => {
      try {
        await navigator.share({ text: cleanShareText(text) });
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // 공유 창을 닫은 것이다
        await copy(key, text);
      }
    },
    [copy],
  );

  return { canShare, copiedKey, copy, share };
}

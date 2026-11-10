'use client';
import { useCallback, useState, useSyncExternalStore } from 'react';
import { cleanShareText } from './share-text';

// 글을 카카오톡 등으로 보내는 공통 동작: 공유(휴대폰 공유 창) → 복사 → 직접 복사 안내(prompt) 순서로 물러난다.
// key는 어느 항목을 복사했는지 표시하려는 이름(터미널·업체 등)이다. copiedKey가 key와 같으면 "복사됨"을 2.5초 보여 준다.
// copy는 클립보드에 넣었으면 true(직접 복사 안내로 물러났으면 false), share는 공유 창이 성공으로 끝났으면 'shared'·복사로 물러나 성공했으면 'copied'·
// 창을 닫았거나 복사까지 실패했으면 'none'을 돌려준다. 호출하는 쪽이 "보냈다"고 기록할지 가리는 데 쓴다.
export function useShareText() {
  const canShare = useSyncExternalStore(
    () => () => {},
    () => typeof navigator.share === 'function',
    () => false,
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const copy = useCallback(async (key: string, text: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(cleanShareText(text));
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((cur) => (cur === key ? null : cur)), 2500);
      return true;
    } catch {
      window.prompt('아래 글을 복사해서 붙여넣으세요.', cleanShareText(text));
      return false;
    }
  }, []);

  const share = useCallback(
    async (key: string, text: string): Promise<'shared' | 'copied' | 'none'> => {
      try {
        await navigator.share({ text: cleanShareText(text) });
        return 'shared';
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return 'none'; // 공유 창을 닫은 것이다
        return (await copy(key, text)) ? 'copied' : 'none';
      }
    },
    [copy],
  );

  return { canShare, copiedKey, copy, share };
}

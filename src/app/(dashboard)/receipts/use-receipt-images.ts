'use client';
// 영수증 이미지(PNG) 준비: 영수증 화면과 보내기 화면(고객사 탭)이 같이 쓴다.
//  - useReceiptSeals: 사업자 직인을 한 번씩 받아 온다(이력 목록에는 용량이 큰 직인을 싣지 않는다).
//  - useReceiptImages: 화면에 그려진 영수증 요소를 한 장씩 차례로 PNG로 만들어 둔다. 보내기를 누른 뒤에 만들면 모바일 공유 시트가 막혀서
//    (사용자 동작 직후에만 열린다) 미리 만들어 두고, 하루치를 한꺼번에 만들면 느려서 want로 요청한 카드만 동시에 하나씩 만든다.
import { useCallback, useEffect, useRef, useState } from 'react';
import { receiptToPng } from '@/components/receipt/receipt-image';
import { loadReceiptSeal } from '../settlement/receipt-actions';
import type { CardImage } from './receipt-card';

// 브라우저가 던지는 영문 오류 문구 대신 사용자가 할 수 있는 조치를 알려 준다.
export function friendlyError(e: unknown, fallback: string): string {
  if (e instanceof DOMException && e.name === 'NotAllowedError') return '브라우저가 이 동작을 허용하지 않았습니다. 주소창의 사이트 권한(클립보드·공유)을 확인해 주세요.';
  if (e instanceof Error && /[가-힣]/.test(e.message)) return e.message;
  return fallback;
}

// 사업자 id → 직인(없으면 null). 키가 없으면 아직 불러오는 중이다.
export function useReceiptSeals(sellerIds: string[]): Record<string, string | null> {
  const [seals, setSeals] = useState<Record<string, string | null>>({});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    for (const id of sellerIds) {
      if (id in seals) continue;
      void loadReceiptSeal(id)
        .then((res) => mounted.current && setSeals((prev) => ({ ...prev, [id]: res.seal })))
        .catch(() => mounted.current && setSeals((prev) => ({ ...prev, [id]: null })));
    }
  }, [sellerIds, seals]);
  return seals;
}

export function useReceiptImages(seals: Record<string, string | null>) {
  const [images, setImages] = useState<Record<string, CardImage>>({});
  const [wanted, setWanted] = useState<string[]>([]); // 이미지를 만들 순서
  const nodes = useRef(new Map<string, HTMLElement>());
  const generating = useRef(false);
  const [tick, setTick] = useState(0); // 이미지 하나를 만들고 나면 올려서 다음 카드로 이어 가게 한다
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const registerNode = useCallback((key: string, node: HTMLElement | null) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  // 이 카드들의 이미지를 만들 목록에 넣는다(이미 있으면 그대로).
  const want = useCallback((keys: string[]) => {
    setWanted((prev) => {
      const add = keys.filter((k) => !prev.includes(k));
      return add.length > 0 ? [...prev, ...add] : prev;
    });
  }, []);

  // 실패한 이미지를 지워서 만들 목록에서 다시 차례가 오게 한다.
  const retry = useCallback((key: string) => {
    setImages((prev) => {
      const { [key]: removed, ...rest } = prev;
      void removed;
      return rest;
    });
  }, []);

  // 만들 차례인 카드 하나씩 이미지를 만든다(동시에 하나만). 끝나면 상태가 바뀌어 이 효과가 다음 카드로 다시 돈다.
  useEffect(() => {
    if (generating.current) return;
    const key = wanted.find((k) => !images[k] && nodes.current.has(k));
    if (!key) return;
    const node = nodes.current.get(key) as HTMLElement;
    generating.current = true;
    receiptToPng(node)
      .then((blob) => mounted.current && setImages((prev) => ({ ...prev, [key]: { state: 'ready', blob } })))
      .catch((e) => mounted.current && setImages((prev) => ({ ...prev, [key]: { state: 'error', message: friendlyError(e, '이미지를 만들지 못했습니다. 다시 만들어 주세요.') } })))
      .finally(() => {
        generating.current = false;
        if (mounted.current) setTick((n) => n + 1);
      });
  }, [wanted, images, seals, tick]);

  return { images, registerNode, want, retry };
}

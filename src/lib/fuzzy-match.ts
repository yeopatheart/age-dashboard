// 카카오 메시지의 업체명 오타를 오늘 등록된 업체 목록과 대조하기 위한 편집 거리 기반 매칭.

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }

  return prev[b.length];
}

// 이름이 거의 같을 때만(짧은 오타 정도) 매칭으로 인정한다 — 길이에 비례한 허용치를 둔다.
export function findClosestMatch<T>(
  target: string,
  candidates: T[],
  getName: (item: T) => string,
  maxDistanceRatio = 0.2,
): T | null {
  let best: T | null = null;
  let bestDistance = Infinity;

  for (const candidate of candidates) {
    const name = getName(candidate);
    if (name === target) return candidate;
    const distance = levenshtein(target, name);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  if (!best) return null;
  const threshold = Math.max(1, Math.floor(target.length * maxDistanceRatio));
  return bestDistance <= threshold ? best : null;
}

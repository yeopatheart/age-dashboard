// 주문입력 확인 화면에서 "처음 보는 상품"을 사람이 한 번 더 보게 돕는 순수 함수.
// 상품은 확정하면 이름이 그대로 마스터에 자동 등록되므로, 오타 중복(참쥐지/참쥐치)이나 수량·메모가 섞인 이름(금태 1상자)이
// 조용히 쌓이지 않게 한다. 업체와 같은 원칙으로 비슷해도 자동으로 합치지 않는다 — 제안만 하고 고르는 것은 사람이다.

const compact = (s: string) => s.replace(/\s+/g, '');

// 두 글자열의 편집 거리(삽입·삭제·교체 각 1). 상품 이름은 짧아서 단순한 DP로 충분하다.
function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = up;
    }
  }
  return prev[b.length];
}

// 새 이름과 비슷한 기존 상품 이름. 띄어쓰기만 다른 이름을 먼저, 한 글자 차이(3글자 이상일 때만)를 그다음에 낸다.
// 짧은 이름은 한 글자만 달라도 다른 상품이라서(광어/전어, 백합/홍합) 한 글자 차이는 3글자 이상에만 적용한다.
export function similarProductNames(name: string, known: Iterable<string>, limit = 2): string[] {
  const target = compact(name);
  const sameIgnoringSpace: string[] = [];
  const oneAway: string[] = [];
  for (const other of known) {
    if (other === name) continue;
    const c = compact(other);
    if (c === target) sameIgnoringSpace.push(other);
    else if (target.length >= 3 && c.length >= 3 && Math.abs(c.length - target.length) <= 1 && editDistance(c, target) === 1) oneAway.push(other);
  }
  return [...sameIgnoringSpace.sort(), ...oneAway.sort()].slice(0, limit);
}

// 상품명에 수량·메모가 섞였거나 두 상품이 이어 붙은 것처럼 보이면 그 이유를 돌려준다(아니면 null). 확인을 요청할 뿐 막지 않는다.
export function suspiciousNameReason(name: string): string | null {
  if (/[.,，、]\s/.test(name)) return "상품명에 마침표나 쉼표가 있습니다 (두 상품이 이어 붙었을 수 있습니다)";
  if (/\s[-–~]\s|[(（]/.test(name)) return '상품명에 메모처럼 보이는 표기가 있습니다';
  if (/\d+(?:\.\d+)?\s*(?:상자|박스|키로|킬로|kg|g|미|마리|개|팩)/i.test(name) || /\s\d+$/.test(name)) return '상품명에 수량이나 무게가 섞여 있습니다';
  return null;
}

// 확인 화면에서 비슷한 이름을 눌렀을 때, 줄의 원문 상품 글자에서 이름 부분만 바꾼다. 원문에 그 이름이 없으면 null.
export function replaceProductName(raw: string, from: string, to: string): string | null {
  const at = raw.indexOf(from);
  return at === -1 ? null : raw.slice(0, at) + to + raw.slice(at + from.length);
}

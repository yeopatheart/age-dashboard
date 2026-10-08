// 터미널마다 다른 색을 일관되게 배정한다. 터미널 목록이 사용자가 직접 등록하는 동적 값이라
// 이름을 미리 알 수 없으므로, 이름을 해시해서 고정 팔레트 중 하나를 결정적으로 고른다 —
// 같은 이름은 항상 같은 색이 나오고(새로고침해도 안 바뀜), 대시보드와 고객사 관리 화면에서
// 동일한 함수를 재사용해 같은 터미널이 항상 같은 색으로 보이게 한다.
const TERMINAL_PALETTE = [
  { bg: 'bg-violet-50',  border: 'border-violet-300',  text: 'text-violet-700',  dot: 'bg-violet-400' },
  { bg: 'bg-sky-50',     border: 'border-sky-300',     text: 'text-sky-700',     dot: 'bg-sky-400' },
  { bg: 'bg-teal-50',    border: 'border-teal-300',    text: 'text-teal-700',    dot: 'bg-teal-400' },
  { bg: 'bg-orange-50',  border: 'border-orange-300',  text: 'text-orange-700',  dot: 'bg-orange-400' },
  { bg: 'bg-pink-50',    border: 'border-pink-300',    text: 'text-pink-700',    dot: 'bg-pink-400' },
  { bg: 'bg-lime-50',    border: 'border-lime-300',    text: 'text-lime-700',    dot: 'bg-lime-500' },
  { bg: 'bg-cyan-50',    border: 'border-cyan-300',    text: 'text-cyan-700',    dot: 'bg-cyan-400' },
  { bg: 'bg-fuchsia-50', border: 'border-fuchsia-300', text: 'text-fuchsia-700', dot: 'bg-fuchsia-400' },
  { bg: 'bg-amber-50',   border: 'border-amber-300',   text: 'text-amber-700',   dot: 'bg-amber-400' },
  { bg: 'bg-indigo-50',  border: 'border-indigo-300',  text: 'text-indigo-700',  dot: 'bg-indigo-400' },
];

function hashName(name: string): number {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return hash;
}

export function terminalColorSet(name: string) {
  if (!name) return { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-500', dot: 'bg-slate-300' };
  return TERMINAL_PALETTE[hashName(name) % TERMINAL_PALETTE.length];
}

// 기존 dashboard-client.tsx에서 쓰던 "클래스 문자열 하나" 형태 — 배지 className에 그대로 이어붙인다.
export function terminalColor(name: string): string {
  const c = terminalColorSet(name);
  return `${c.bg} ${c.border} ${c.text}`;
}

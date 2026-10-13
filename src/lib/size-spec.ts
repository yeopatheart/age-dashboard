// 주문의 사이즈/종류 요구사항 문자열(예: "4-600", "1kg대", "키로 3미", "큰거")을 배분 계산에 쓸 수 있는
// 구조화된 값으로 바꾼다. 원문(size_request)은 그대로 두고 이 값은 따로 저장한다.
// 허용 오차 같은 숫자는 설정(app_settings)에서 오므로 이 파일에는 하드코딩하지 않는다.
import type { AppSettings } from './app-settings';

export interface SizeSpec {
  minG: number | null; // 마리당 최소 중량(g)
  maxG: number | null; // 마리당 최대 중량(g)
  relative: 'large' | 'small' | null; // 큰거/작은거 — 그날 도착한 마리들 중 상대 순위로 배정
  grade: string | null; // 선별/일반/미달
  handling: string[]; // 피빼기, 드라이아이스 등 — 중량 배분과 무관한 작업 지시
  pending: boolean; // 고객 확인 전의 임시 주문(예: 확인중)
  optional: boolean; // 상품이 확보되면 준비(예: 가능하면)
  unparsed: string[]; // 해석하지 못한 조각
}

const GRADES = ['선별', '일반', '미달'];
const HANDLING = ['피빼기', '드라이아이스', '얼음', '그물망', '손질', '물봉', '기포기'];

export function parseSizeSpec(raw: string | null | undefined, cfg: AppSettings): SizeSpec {
  const spec: SizeSpec = { minG: null, maxG: null, relative: null, grade: null, handling: [], pending: false, optional: false, unparsed: [] };
  if (!raw) return spec;
  const widen = (min: number | null, max: number | null) => {
    if (min != null) spec.minG = spec.minG == null ? min : Math.max(spec.minG, min);
    if (max != null) spec.maxG = spec.maxG == null ? max : Math.min(spec.maxG, max);
  };

  for (const token of raw.split(',').map((t) => t.trim()).filter(Boolean)) {
    const t = token.replace(/\s+/g, '');
    let m: RegExpMatchArray | null;

    if (cfg.pendingKeywords.some((k) => k.replace(/\s+/g, '') === t)) spec.pending = true;
    else if (cfg.optionalKeywords.some((k) => k.replace(/\s+/g, '') === t)) spec.optional = true;
    else if (GRADES.includes(t)) spec.grade = t;
    else if (HANDLING.includes(t)) spec.handling.push(t);
    else if (/^(큰거|큰것)$/.test(t)) spec.relative = 'large';
    else if (/^(작은거|작은것)$/.test(t)) spec.relative = 'small';
    // 4-600 → 400~600g, 6-800 → 600~800g (앞 숫자는 백 단위)
    else if ((m = t.match(/^(\d{1,2})-(\d{3})$/))) widen(parseInt(m[1], 10) * 100, parseInt(m[2], 10));
    // 키로 3미 / 키로6-8미 / 키로 6미급 → 킬로당 N마리 = 마리당 1000/N g
    else if ((m = t.match(/^키로(\d+)(?:-(\d+))?미급?$/))) {
      const a = parseInt(m[1], 10);
      const b = m[2] ? parseInt(m[2], 10) : null;
      if (b != null) widen(Math.round(1000 / Math.max(a, b)), Math.round(1000 / Math.min(a, b)));
      else {
        const center = 1000 / a;
        widen(Math.round(center * (1 - cfg.perKgTolerancePct / 100)), Math.round(center * (1 + cfg.perKgTolerancePct / 100)));
      }
    }
    // 1kg대 / 1kg급 → 1.0 ~ 2.0kg (이상 이하가 아니라 해당 대역)
    else if ((m = t.match(/^(\d+(?:\.\d+)?)(?:kg|키로)(?:대|급)$/))) widen(Math.round(parseFloat(m[1]) * 1000), Math.round((parseFloat(m[1]) + 1) * 1000));
    // 2.5kg내외 → ±허용 오차%
    else if ((m = t.match(/^(\d+(?:\.\d+)?)(kg|키로)?내외$/))) {
      const center = m[2] ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
      widen(Math.round(center * (1 - cfg.sizeTolerancePct / 100)), Math.round(center * (1 + cfg.sizeTolerancePct / 100)));
    }
    // 3kg초반 → 3.0 ~ 3.0+설정 폭
    else if ((m = t.match(/^(\d+(?:\.\d+)?)(?:kg|키로)초반$/))) widen(Math.round(parseFloat(m[1]) * 1000), Math.round((parseFloat(m[1]) + cfg.earlyRangeKg) * 1000));
    // 2kg이상 / 300이상(단위 없으면 g)
    else if ((m = t.match(/^(\d+(?:\.\d+)?)(kg|키로)?이상$/))) widen(m[2] ? Math.round(parseFloat(m[1]) * 1000) : parseFloat(m[1]), null);
    else if ((m = t.match(/^(\d+(?:\.\d+)?)(kg|키로)?이하$/))) widen(null, m[2] ? Math.round(parseFloat(m[1]) * 1000) : parseFloat(m[1]));
    else spec.unparsed.push(token);
  }
  return spec;
}

const fmtG = (g: number) => (g >= 1000 ? `${Math.round(g) / 1000}kg` : `${Math.round(g)}g`);

// 확인 화면에 보여줄 해석 결과 문구. 해석한 게 없으면 빈 배열.
export function describeSizeSpec(spec: SizeSpec): string[] {
  const out: string[] = [];
  if (spec.minG != null && spec.maxG != null) out.push(`${fmtG(spec.minG)} ~ ${fmtG(spec.maxG)}`);
  else if (spec.minG != null) out.push(`${fmtG(spec.minG)} 이상`);
  else if (spec.maxG != null) out.push(`${fmtG(spec.maxG)} 이하`);
  if (spec.relative) out.push(spec.relative === 'large' ? '큰 쪽 우선' : '작은 쪽 우선');
  if (spec.optional) out.push('확보되면 준비');
  if (spec.pending) out.push('고객 확인 전');
  return out;
}

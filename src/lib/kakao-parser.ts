// 카카오톡 주문 메시지 파서. docs/kakao-message-format-guide.md의 확정 포맷(40개 실사례로 검증됨)을
// 그대로 구현한다: "[번호] [터미널]/ [업체명]/ [상품1], [상품2], ..." — 번호는 형이 직접 관리하지
// 않으므로 시스템이 신뢰하지 않고, 업체번호-상품순서는 별도로(assign_business_number 등) 발급한다.
// 형식과 안 맞는 부분은 버리지 않고 needsReview로 표시해 사람이 확인 화면에서 고치게 한다
// (docs/prd/order-dashboard.md 엣지케이스 "AI 제안 → 사람 확인" 패턴).

export interface ParsedProduct {
  raw: string;
  productName: string;
  quantity: number;
  unit: string;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  isMulbong: boolean;
  mulbongBoxCount: number | null;
  hasIcePack: boolean;
  fromStock: boolean;
  // 상품 뒤에 "취소"를 붙인 줄(예: "갯가재 취소") — 수량 없이 기존 상품을 취소한다.
  isCancel: boolean;
  // 괄호가 2개이거나 수량 앞에 있어서 표준 형식으로 자동 정리한 경우, 원문을 남겨 확인 화면에 보여준다.
  normalizedFrom?: string;
  needsReview: boolean;
  reviewReason?: string;
}

export interface ParsedBusinessLine {
  raw: string;
  orderNumberRaw: string | null;
  terminalName: string;
  businessName: string;
  products: ParsedProduct[];
  // 줄 끝 "#메모" — 포장 담당에게 전하는 자유 메모.
  memo?: string;
  // "터미널/ 업체명/ 취소" — 그 업체의 오늘 주문 전체를 취소한다.
  cancelAll?: boolean;
  needsReview: boolean;
  reviewReason?: string;
}

// "9/29(화)" 같은 날짜 머리글 줄은 주문이 아니므로 무시한다.
const DATE_HEADER_RE = /^\d{1,2}\s*\/\s*\d{1,2}\s*(\([월화수목금토일]\))?$/;
const MULBONG_BOX_RE = /^물봉\s*(\d+)\s*박스$/;
const GRAM_RE = /(\d+(?:\.\d+)?)\s*(?:g|그램)(?![a-zA-Z])/gi;
// 수량은 항상 "이름 뒤 숫자+단위", 콤보는 "+숫자+단위"로 한 번 더 붙는다(항상 개수 다음 중량 순서)
const QUANTITY_RE =
  /^(.+?)\s*(\d+(?:\.\d+)?)\s*(미|마리|키로|kg|팩|개)(?:\s*\+\s*(\d+(?:\.\d+)?)\s*(미|마리|키로|kg|팩|개))?$/i;

// 가이드: "미"와 "마리"는 동일하게 인식된다 — 화면 표시 단위는 "미"로 통일한다.
// 중량 단위는 "키로"로 써도 "kg"으로 쓰고 화면에도 "kg"으로 표시한다.
export function normalizeUnit(unit: string): string {
  if (unit === "마리") return "미";
  if (unit === "키로" || unit.toLowerCase() === "kg") return "kg";
  return unit;
}

// 괄호 안 내용을 전부 모아 상품 맨 끝의 괄호 하나로 정리한다.
// "전복(300이상) 2마리(물봉)" → "전복 2마리(300이상, 물봉)", "활장어(700이상) 2마리" → "활장어 2마리(700이상)".
// 괄호 짝이 맞지 않으면 손대지 않고 기존처럼 확인 필요로 넘긴다.
function normalizeParens(raw: string): { text: string; changed: boolean } {
  const groups: string[] = [];
  let depth = 0;
  let outside = "";
  let inside = "";
  for (const char of raw) {
    if (char === "(") {
      if (depth > 0) inside += char;
      depth++;
    } else if (char === ")") {
      if (depth === 0) return { text: raw, changed: false };
      depth--;
      if (depth === 0) {
        groups.push(inside.trim());
        inside = "";
      } else {
        inside += char;
      }
    } else if (depth > 0) {
      inside += char;
    } else {
      outside += char;
    }
  }
  if (depth !== 0 || groups.length === 0) return { text: raw, changed: false };
  const body = outside.replace(/\s+/g, " ").trim();
  const joined = groups.filter(Boolean).join(", ");
  const text = joined ? `${body}(${joined})` : body;
  return { text, changed: text.replace(/\s+/g, "") !== raw.replace(/\s+/g, "") };
}

function parseProduct(original: string): ParsedProduct {
  const normalized = normalizeParens(original);
  const raw = normalized.text;
  const cancelMatch = raw.match(/^(.+?)\s*취소$/);
  if (cancelMatch) {
    return {
      raw: original,
      productName: cancelMatch[1].trim(),
      quantity: 0,
      unit: "",
      secondaryWeightKg: null,
      sizeRequest: null,
      isMulbong: false,
      mulbongBoxCount: null,
      hasIcePack: false,
      fromStock: false,
      isCancel: true,
      needsReview: false,
    };
  }
  const openCount = (raw.match(/\(/g) ?? []).length;
  const closeCount = (raw.match(/\)/g) ?? []).length;

  let needsReview = false;
  let reviewReason: string | undefined;
  if (openCount > 1 || closeCount > 1) {
    needsReview = true;
    reviewReason = "괄호가 상품 하나에 2개 이상 사용됨";
  }

  let body = raw;
  let parenContent: string | null = null;
  const parenMatch = raw.match(/^(.*?)\(([^()]*)\)\s*$/);
  if (parenMatch) {
    body = parenMatch[1].trim();
    parenContent = parenMatch[2].trim();
  } else if (openCount > 0 || closeCount > 0) {
    needsReview = true;
    reviewReason = reviewReason ?? "괄호 위치가 상품명 맨 뒤 하나가 아님";
  }

  // 그램(g)은 수량 합산이 kg 단위와 섞이지 않도록 kg으로 환산해서 읽는다 ("500g" → "0.5kg").
  body = body.replace(GRAM_RE, (_, n: string) => `${parseFloat((parseFloat(n) / 1000).toFixed(3))}kg`);

  const qtyMatch = body.match(QUANTITY_RE);
  let productName = body;
  let quantity = 0;
  let unit = "";
  let secondaryWeightKg: number | null = null;

  if (qtyMatch) {
    productName = qtyMatch[1].trim();
    quantity = parseFloat(qtyMatch[2]);
    unit = normalizeUnit(qtyMatch[3]);
    if (qtyMatch[4]) {
      secondaryWeightKg = parseFloat(qtyMatch[4]);
    }
    // "감성돔 1미2.5키로"(+ 없이 개수+중량 병기)처럼 잘못 쓰면 앞의 수량이 "+"로 이어지지 않아
    // 정규식이 그걸 상품명의 일부로 삼켜버릴 수 있다 — 상품명이 수량 표기로 끝나면 의심 신호로 본다.
    if (/\d(미|마리|키로|kg|팩|개)\s*$/i.test(productName)) {
      needsReview = true;
      reviewReason = reviewReason ?? "상품명 끝에 수량으로 보이는 표기가 남음 ('+' 없이 개수+중량을 병기했을 가능성)";
    }
  } else {
    needsReview = true;
    reviewReason = reviewReason ?? "수량/단위를 찾지 못함";
  }

  let isMulbong = false;
  let mulbongBoxCount: number | null = null;
  let hasIcePack = false;
  let fromStock = false;
  const sizeParts: string[] = [];

  if (parenContent) {
    for (const token of parenContent.split(",").map((t) => t.trim()).filter(Boolean)) {
      const mulbongBoxMatch = token.match(MULBONG_BOX_RE);
      if (token === "물봉" || token === "기포기") {
        isMulbong = true;
      } else if (mulbongBoxMatch) {
        isMulbong = true;
        mulbongBoxCount = parseInt(mulbongBoxMatch[1], 10);
      } else if (token === "얼음포장") {
        hasIcePack = true;
      } else if (token === "재고") {
        fromStock = true;
      } else {
        sizeParts.push(token);
      }
    }
  }

  return {
    raw: original,
    productName,
    quantity,
    unit,
    secondaryWeightKg,
    sizeRequest: sizeParts.length > 0 ? sizeParts.join(", ") : null,
    isMulbong,
    mulbongBoxCount,
    hasIcePack,
    fromStock,
    isCancel: false,
    normalizedFrom: normalized.changed ? original : undefined,
    needsReview,
    reviewReason,
  };
}

// 괄호 안(물봉 2박스, 2kg이상 등)의 쉼표는 상품 구분자로 취급하면 안 되므로,
// 괄호 밖에 있는 구분자에서만 나눈다.
function splitTopLevel(text: string, delimiter: string): string[] {
  const result: string[] = [];
  let depth = 0;
  let current = "";
  for (const char of text) {
    if (char === "(") depth++;
    else if (char === ")") depth = Math.max(0, depth - 1);

    if (char === delimiter && depth === 0) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function parseLine(line: string): ParsedBusinessLine {
  const numberMatch = line.match(/^(\d+)\s+(.*)$/);
  const orderNumberRaw = numberMatch ? numberMatch[1] : null;
  let rest = numberMatch ? numberMatch[2] : line;

  // 줄 끝 "#메모"는 메모 안에 "/"가 있어도 구분자로 오인되지 않도록 먼저 떼어낸다.
  let memo: string | undefined;
  const hashIndex = rest.indexOf("#");
  if (hashIndex >= 0) {
    memo = rest.slice(hashIndex + 1).trim() || undefined;
    rest = rest.slice(0, hashIndex).trim();
  }

  const parts = rest.split("/").map((s) => s.trim());
  if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
    return {
      raw: line,
      orderNumberRaw,
      terminalName: parts[0] ?? "",
      businessName: parts[1] ?? "",
      products: [],
      memo,
      needsReview: true,
      reviewReason: "구분자 '/'가 정확히 2개가 아니거나 빈 항목이 있음 (터미널/업체명/상품 형식과 불일치)",
    };
  }

  const [terminalName, businessName, productsRaw] = parts;
  if (productsRaw === "취소") {
    return { raw: line, orderNumberRaw, terminalName, businessName, products: [], memo, cancelAll: true, needsReview: false };
  }
  const products = splitTopLevel(productsRaw, ",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseProduct);

  return {
    raw: line,
    orderNumberRaw,
    terminalName,
    businessName,
    products,
    memo,
    needsReview: products.some((p) => p.needsReview),
  };
}

export function parseKakaoMessage(rawText: string): ParsedBusinessLine[] {
  return rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !DATE_HEADER_RE.test(line))
    .map(parseLine);
}

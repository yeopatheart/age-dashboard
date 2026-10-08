import type Anthropic from '@anthropic-ai/sdk';
import { getAnthropicClient } from './anthropic-client';
import { normalizeUnit, type ParsedBusinessLine, type ParsedProduct } from './kakao-parser';

// 정규식 파서가 "터미널/업체명/상품" 3분할 자체에 실패한 줄만 여기로 온다(줄 단위 fallback,
// 상품 단위 사소한 오류는 기존처럼 needsReview로 사람이 고친다 — docs/decisions 참고).
// AI 결과는 아무리 그럴듯해도 항상 needsReview: true로 돌려보내 사람 확인을 거치게 한다.

const TOOL_NAME = 'extract_kakao_order_line';

const SYSTEM_PROMPT = `너는 통영 수산물 도매업체의 카카오톡 주문 메시지 한 줄을 구조화된 데이터로 변환하는 도우미다.
정상 형식은 "[번호] [터미널]/ [업체명]/ [상품1], [상품2], ..." 이지만, 지금 주어지는 줄은 이 형식에서
벗어나 자동 파서가 실패한 줄이다. 문맥으로 최대한 정확히 터미널명·업체명·상품 목록을 추출해라.

상품 표기 규칙:
- 수량+단위는 "미(마리와 동일)/kg(키로와 동일)/팩/개" 중 하나.
- 수량과 중량이 함께 쓰이면 "3미+2.5kg"처럼 개수 다음에 중량이 온다 — secondaryWeightKg로 분리.
- 괄호 안 텍스트는 사이즈 요청/메모(sizeRequest)일 수 있다.
- "물봉"이 포함되면 isMulbong: true, "물봉 N박스"면 mulbongBoxCount: N.
- "얼음"/"아이스팩"/"얼려서" 등이 포함되면 hasIcePack: true.
- "재고"/"있는거" 등 재고 사용을 뜻하면 fromStock: true.
확신이 서지 않는 값은 각 필드의 기본값(0이 아닌 경우 null 또는 false)을 사용해라. 절대 상품을 지어내지 마라 —
원문에 없는 상품을 추가하지 말고, 정말 아무것도 못 알아보겠으면 products를 빈 배열로 반환해라.`;

const PRODUCT_SCHEMA = {
  type: 'object',
  properties: {
    productName: { type: 'string' },
    quantity: { type: 'number' },
    unit: { type: 'string', description: '미, kg, 팩, 개 중 하나' },
    secondaryWeightKg: { type: ['number', 'null'] },
    sizeRequest: { type: ['string', 'null'] },
    isMulbong: { type: 'boolean' },
    mulbongBoxCount: { type: ['number', 'null'] },
    hasIcePack: { type: 'boolean' },
    fromStock: { type: 'boolean' },
  },
  required: [
    'productName', 'quantity', 'unit', 'secondaryWeightKg', 'sizeRequest',
    'isMulbong', 'mulbongBoxCount', 'hasIcePack', 'fromStock',
  ],
} as const;

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description: '카카오톡 주문 메시지 한 줄에서 터미널명·업체명·상품 목록을 추출한다.',
  input_schema: {
    type: 'object',
    properties: {
      terminalName: { type: 'string' },
      businessName: { type: 'string' },
      products: { type: 'array', items: PRODUCT_SCHEMA },
    },
    required: ['terminalName', 'businessName', 'products'],
  },
};

interface RepairedProduct {
  productName: string;
  quantity: number;
  unit: string;
  secondaryWeightKg: number | null;
  sizeRequest: string | null;
  isMulbong: boolean;
  mulbongBoxCount: number | null;
  hasIcePack: boolean;
  fromStock: boolean;
}

interface RepairedLine {
  terminalName: string;
  businessName: string;
  products: RepairedProduct[];
}

function isRepairedLine(value: unknown): value is RepairedLine {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.terminalName === 'string' && typeof v.businessName === 'string' && Array.isArray(v.products);
}

export async function repairFailedLine(
  rawLine: string,
  context: { terminalNames: string[]; businessNames: string[] },
): Promise<ParsedBusinessLine | null> {
  const client = getAnthropicClient();
  if (!client) return null;

  try {
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `등록된 터미널: ${context.terminalNames.join(', ') || '(없음)'}\n등록된 업체명: ${context.businessNames.join(', ') || '(없음)'}\n\n다음 한 줄을 분석해줘:\n${rawLine}`,
        },
      ],
      tools: [TOOL],
      tool_choice: { type: 'tool', name: TOOL_NAME },
    });

    const toolUse = response.content.find((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');
    if (!toolUse || !isRepairedLine(toolUse.input)) return null;

    const { terminalName, businessName, products: repairedProducts } = toolUse.input;
    if (!terminalName.trim() || !businessName.trim() || repairedProducts.length === 0) return null;

    const products: ParsedProduct[] = repairedProducts.map((p) => ({
      raw: rawLine,
      productName: p.productName,
      quantity: p.quantity,
      unit: normalizeUnit(p.unit),
      secondaryWeightKg: p.secondaryWeightKg,
      sizeRequest: p.sizeRequest,
      isMulbong: p.isMulbong,
      mulbongBoxCount: p.mulbongBoxCount,
      hasIcePack: p.hasIcePack,
      fromStock: p.fromStock,
      isCancel: false,
      needsReview: false,
    }));

    return {
      raw: rawLine,
      orderNumberRaw: null,
      terminalName,
      businessName,
      products,
      needsReview: true,
      reviewReason: 'AI가 형식을 벗어난 줄을 재구성했습니다 — 꼼꼼히 확인해주세요',
    };
  } catch {
    return null;
  }
}

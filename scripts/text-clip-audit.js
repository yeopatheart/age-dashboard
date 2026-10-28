// 글자 잘림 점검: 화면의 모든 글자가 그려지는 모양(ascender/descender 포함)이 overflow:hidden 상자 안에 들어오는지 잰다.
// 글자 크기·줄 높이·행 높이·칩 크기를 바꾼 뒤에는 반드시 돌려서 violations가 0인지 확인한다 — kg의 g처럼 기준선 아래로 내려오는 글자가
// 줄 높이 경계에서 잘리는 문제를 눈으로는 놓치기 쉽다(2026-10-28 두 번 재발).
//
// 사용: 브라우저에서 확인할 화면을 연 뒤 개발자 도구 콘솔에 이 파일 내용을 붙여넣고 `await textClipAudit('main')`을 실행한다.
//   대시보드: 모니터 1(?monitor=1), 모니터 2(?monitor=2), 전체보기를 각각, 그리고 별도 주문 팝업을 연 상태에서 `await textClipAudit('.fixed.inset-0')`.
//   창 높이를 바꿔 행 높이 단계(40/36/32/30px)별로도 확인한다.
// 해석: 스크롤 영역 가장자리에 반쯤 걸친 줄이나 의도적인 말줄임(line-clamp)은 위반으로 나올 수 있다. text와 clipper를 보고 판단한다.
async function textClipAudit(scopeSelector) {
  const ctx = document.createElement('canvas').getContext('2d');
  const root = (scopeSelector && document.querySelector(scopeSelector)) || document.querySelector('main') || document.body;
  const TOLERANCE_PX = 0.25;

  // 글자를 실제로 잘라내는 조상 상자(overflow hidden/clip)의 안쪽 범위. position:fixed 요소는 그 위쪽 조상에 잘리지 않는다.
  const clipOf = (el) => {
    let top = -Infinity, bottom = Infinity, left = -Infinity, right = Infinity;
    const clippers = [];
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const r = a.getBoundingClientRect();
      const bt = parseFloat(cs.borderTopWidth), bb = parseFloat(cs.borderBottomWidth), bl = parseFloat(cs.borderLeftWidth), br = parseFloat(cs.borderRightWidth);
      if (cs.overflowY === 'hidden' || cs.overflowY === 'clip') {
        top = Math.max(top, r.top + bt);
        if (r.bottom - bb < bottom) { bottom = r.bottom - bb; clippers.push(a); }
      }
      if (cs.overflowX === 'hidden' || cs.overflowX === 'clip') {
        left = Math.max(left, r.left + bl);
        right = Math.min(right, r.right - br);
      }
      if (cs.position === 'fixed') break;
    }
    return { top, bottom, left, right, clippers };
  };

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const violations = [];
  let checked = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.replace(/\s+/g, ' ').trim();
    const el = node.parentElement;
    if (!text || !el || ['SCRIPT', 'STYLE', 'OPTION', 'SELECT', 'TEXTAREA'].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
    if (!rects.length) continue;

    // 글자의 실제 모양 범위(canvas)와 기준선 위치(폭 0 상자를 기준선에 놓아 잰다)로 잘림을 판단한다.
    ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
    const metrics = ctx.measureText(text);
    const probe = document.createElement('span');
    probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
    el.insertBefore(probe, node);
    const baseline = probe.getBoundingClientRect().bottom;
    el.removeChild(probe);
    const ascentOffset = baseline - rects[0].top;
    const clip = clipOf(el);
    checked++;

    for (const r of rects) {
      // 스크롤해야 보이는 줄(잘림 상자와 전혀 겹치지 않음)은 건너뛴다.
      if (r.bottom < clip.top || r.top > clip.bottom || r.right < clip.left || r.left > clip.right) continue;
      const base = r.top + ascentOffset;
      const overshoot = Math.max(base + metrics.actualBoundingBoxDescent - clip.bottom, clip.top - (base - metrics.actualBoundingBoxAscent), r.right - clip.right, clip.left - r.left);
      if (overshoot > TOLERANCE_PX) {
        violations.push({ text: text.slice(0, 18), fontSize: cs.fontSize, lineHeight: cs.lineHeight, overshootPx: +overshoot.toFixed(1), clipper: String(clip.clippers[0]?.className || '').slice(0, 60) });
        break;
      }
    }
  }
  return { checked, violations: violations.length, sample: violations.slice(0, 10) };
}

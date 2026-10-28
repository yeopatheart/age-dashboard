// 글자 잘림 점검: 화면의 모든 글자가 그려지는 모양(ascender/descender 포함)이 overflow:hidden 상자 안에 들어오는지 잰다.
// 글자 크기·줄 높이·행 높이·칩 크기를 바꾼 뒤에는 반드시 돌려서 violations가 0인지 확인한다 — kg의 g처럼 기준선 아래로 내려오는 글자가
// 줄 높이 경계에서 잘리는 문제를 눈으로는 놓치기 쉽다(2026-10-28 두 번 재발).
//
// 사용: 브라우저에서 확인할 화면을 연 뒤 개발자 도구 콘솔에 이 파일 내용을 붙여넣고 `await textClipAudit('main')`을 실행한다.
//   대시보드: 모니터 1(?monitor=1), 모니터 2(?monitor=2), 전체보기를 각각, 그리고 별도 주문 팝업을 연 상태에서 `await textClipAudit('.fixed.inset-0')`.
//   창 높이를 바꿔 행 높이 단계(40/36/32/30px)별로도 확인한다.
// 정렬은 같은 파일의 textBaselineAudit(칩 선택자)로 확인한다(아래 설명 참고).
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

// 글자 정렬 점검: 한 칩 안에서 같은 줄에 놓인 글자 조각들(품목명·수량·단위·사이즈 표기)의 기준선이 같은지 잰다.
// 글자 크기가 다른 조각(예: 수량 숫자만 크게)을 가운데 정렬(items-center)하면 기준선이 어긋나 읽기 어렵다 — 줄 안의 조각은 기준선 정렬(items-baseline).
// 사용: `await textBaselineAudit('[data-pill], .group\\/pill')` 처럼 칩을 고르는 선택자를 준다. violations가 0이어야 한다.
async function textBaselineAudit(chipSelector) {
  const MAX_BASELINE_DIFF_PX = 0.6;
  const chips = [...document.querySelectorAll(chipSelector)];
  const violations = [];
  for (const chip of chips) {
    const segments = [];
    const walker = document.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent.replace(/\s+/g, ' ').trim();
      const el = node.parentElement;
      if (!text || !el) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
      if (!rects.length) continue;
      const probe = document.createElement('span');
      probe.style.cssText = 'display:inline-block;width:0;height:0;vertical-align:baseline';
      el.insertBefore(probe, node);
      const ascentOffset = probe.getBoundingClientRect().bottom - rects[0].top;
      el.removeChild(probe);
      for (const r of rects) segments.push({ text, baseline: r.top + ascentOffset, center: (r.top + r.bottom) / 2, height: r.height });
    }
    // 세로 중심이 가까운 조각끼리 같은 줄로 묶는다(다른 줄과는 줄 간격만큼 떨어져 있다).
    const lines = [];
    for (const seg of segments.sort((a, b) => a.center - b.center)) {
      const line = lines.find((l) => Math.abs(l.center - seg.center) < 0.5 * Math.min(l.height, seg.height));
      if (line) { line.items.push(seg); } else { lines.push({ center: seg.center, height: seg.height, items: [seg] }); }
    }
    for (const line of lines) {
      if (line.items.length < 2) continue;
      const baselines = line.items.map((s) => s.baseline);
      const spread = Math.max(...baselines) - Math.min(...baselines);
      if (spread > MAX_BASELINE_DIFF_PX) violations.push({ chip: line.items.map((s) => s.text).join(' | ').slice(0, 40), spreadPx: +spread.toFixed(1) });
    }
  }
  return { chips: chips.length, violations: violations.length, sample: violations.slice(0, 8) };
}

// 세로 중앙 점검: 칩 안의 글자 줄(글자가 차지하는 줄 상자)이 칩 안쪽 높이의 가운데에 오는지 잰다. 위·아래 여백 차이가 1px을 넘으면 위반.
// 글자 모양 끝(획)이 아니라 줄 상자를 기준으로 하는 이유: 같은 줄의 칩들이 `kg`의 g 같은 글자 유무와 상관없이 같은 높이에 글자가 놓여야 한다.
// 상자 안의 보이지 않는 줄 높이(부모의 글자 크기로 잡히는 strut)가 글자를 한쪽으로 밀어내는 문제를 잡는다.
// 사용: `await textVerticalCenterAudit('div:has(> [data-pill])')` (대시보드 칩), `await textVerticalCenterAudit('.fixed.inset-0 .group\\/pill')` (팝업 칩).
async function textVerticalCenterAudit(boxSelector) {
  const MAX_DIFF_PX = 1;
  const boxes = [...document.querySelectorAll(boxSelector)];
  const violations = [];
  for (const box of boxes) {
    const bs = getComputedStyle(box);
    const rect = box.getBoundingClientRect();
    const innerTop = rect.top + parseFloat(bs.borderTopWidth);
    const innerBottom = rect.bottom - parseFloat(bs.borderBottomWidth);
    let textTop = Infinity, textBottom = -Infinity;
    const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || !node.parentElement) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of range.getClientRects()) {
        if (r.width <= 0 || r.height <= 0) continue;
        textTop = Math.min(textTop, r.top);
        textBottom = Math.max(textBottom, r.bottom);
      }
    }
    if (!isFinite(textTop)) continue;
    const topGap = textTop - innerTop;
    const bottomGap = innerBottom - textBottom;
    if (Math.abs(topGap - bottomGap) > MAX_DIFF_PX) {
      violations.push({ chip: box.innerText.replace(/\s+/g, ' ').slice(0, 24), topGapPx: +topGap.toFixed(1), bottomGapPx: +bottomGap.toFixed(1) });
    }
  }
  return { chips: boxes.length, violations: violations.length, sample: violations.slice(0, 8) };
}

// 오늘 필요한 박스: 업체별 박스 구성을 박스 종류별 개수로 합친다. 포장 작업자가 박스를 미리 준비하는 데 쓴다.
// 제출한 업체는 제출한 박스(submitted), 아직 제출하지 않은 업체는 지금 화면의 구성(추천 또는 작성 중, planned)으로 센다.
// 둘을 나눠 보여 주는 이유: 제출한 것은 확정이고 미제출분은 바뀔 수 있는 예상이다.
export interface NeedRow {
  submittedNames: string[] | null; // 제출한 박스 이름들(없으면 null)
  plannedNames: string[]; // 미제출 업체의 현재 구성(제출했으면 쓰지 않는다)
}

export interface NeedLine {
  name: string;
  submitted: number;
  planned: number;
}

export interface BoxNeeds {
  lines: NeedLine[];
  submittedTotal: number;
  plannedTotal: number;
  submittedRows: number;
  rows: number;
}

// order: 박스 종류 이름의 표시 순서(박스 관리의 순서). 목록에 없는 이름은 뒤에 가나다순으로 붙는다.
export function summarizeBoxNeeds(rows: NeedRow[], order: string[]): BoxNeeds {
  const byName = new Map<string, NeedLine>();
  const line = (name: string) => {
    let l = byName.get(name);
    if (!l) {
      l = { name, submitted: 0, planned: 0 };
      byName.set(name, l);
    }
    return l;
  };
  let submittedRows = 0;
  for (const row of rows) {
    if (row.submittedNames) {
      submittedRows++;
      for (const name of row.submittedNames) line(name).submitted++;
    } else {
      for (const name of row.plannedNames) line(name).planned++;
    }
  }
  const rank = (name: string) => {
    const i = order.indexOf(name);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  const lines = [...byName.values()].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name, 'ko'));
  return {
    lines,
    submittedTotal: lines.reduce((s, l) => s + l.submitted, 0),
    plannedTotal: lines.reduce((s, l) => s + l.planned, 0),
    submittedRows,
    rows: rows.length,
  };
}

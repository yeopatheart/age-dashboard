// 박스 할당 화면의 합포장: 작성 중에는 박스 번호(순번)가 아니라 박스의 화면 식별자(uid) 묶음으로 들고 있다.
// 박스를 지우거나 순서가 바뀌어도 묶음이 엉뚱한 박스를 가리키지 않게 하려는 것이고, 제출할 때만 현재 박스 순서로 번호 묶음(box-merge)으로 바꾼다.
import { normalizeMergeGroups, type MergeGroups } from '../box-merge.ts'; // 상대 경로+.ts: 단위 테스트(node --test)가 @ 별칭을 못 푼다

export type UidGroups = string[][];

// 번호 묶음 → uid 묶음(boxUids[순번-1]). 박스 수를 넘는 번호는 뺀다.
export function uidGroupsFromSeq(boxUids: string[], groups: MergeGroups): UidGroups {
  return normalizeMergeGroups(groups, boxUids.length).map((g) => g.map((seq) => boxUids[seq - 1]));
}

// uid 묶음 → 번호 묶음(현재 박스 순서 기준). 없어진 박스는 빠지고 2개 미만이 된 묶음은 버려진다.
export function seqGroupsFromUid(boxUids: string[], groups: UidGroups): MergeGroups {
  return normalizeMergeGroups(
    groups.map((g) => g.flatMap((uid) => {
      const at = boxUids.indexOf(uid);
      return at < 0 ? [] : [at + 1];
    })),
    boxUids.length,
  );
}

// 박스를 지운 뒤 남은 박스(boxUids)만 가리키도록 묶음을 정리한다.
export function pruneUidGroups(groups: UidGroups, boxUids: string[]): UidGroups {
  return groups.map((g) => g.filter((uid) => boxUids.includes(uid))).filter((g) => g.length >= 2);
}

// 선택한 박스들을 하나의 묶음으로 만든다(이미 다른 묶음에 있던 박스는 그 묶음에서 빠진다). 선택이 2개 미만이면 그대로 둔다.
export function mergeUids(groups: UidGroups, selected: string[]): UidGroups {
  const picked = [...new Set(selected)];
  if (picked.length < 2) return groups;
  return [...groups.map((g) => g.filter((uid) => !picked.includes(uid))).filter((g) => g.length >= 2), picked];
}

export const unmergeUids = (groups: UidGroups, group: string[]): UidGroups => groups.filter((g) => g[0] !== group[0]);

// 비교용 문자열(묶음의 순서와 무관). 원래 묶음으로 되돌려 놓으면 "수정 안 함"으로 본다.
export const mergeKey = (boxUids: string[], groups: UidGroups): string => seqGroupsFromUid(boxUids, groups).map((g) => g.join('-')).join('|');

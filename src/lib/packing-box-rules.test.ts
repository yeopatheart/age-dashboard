import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyBoxMessage, firstEmptyBoxIndex, printableSeqError, removalShiftsPrintedLabels } from './packing/box-rules.ts';

test('빈 박스는 첫 번째 위치를 돌려주고 없으면 -1이다', () => {
  assert.equal(firstEmptyBoxIndex([]), -1);
  assert.equal(firstEmptyBoxIndex([{ items: [1] }, { items: [1, 2] }]), -1);
  assert.equal(firstEmptyBoxIndex([{ items: [1] }, { items: [] }, { items: [] }]), 1);
  assert.equal(emptyBoxMessage(1), '2번 박스가 비어 있습니다. 상품을 담거나 박스를 지워주세요.');
});

test('출력한 라벨이 있을 때 마지막이 아닌 제출 박스를 지우면 번호가 밀린다', () => {
  assert.equal(removalShiftsPrintedLabels(2, 0, 2), true); // 1번 삭제 → 2번이 1번이 된다
  assert.equal(removalShiftsPrintedLabels(2, 1, 2), false); // 마지막 박스는 뒤에 밀릴 번호가 없다
  assert.equal(removalShiftsPrintedLabels(3, 1, 1), true);
  assert.equal(removalShiftsPrintedLabels(2, 0, 0), false); // 아직 출력 전이면 괜찮다
  assert.equal(removalShiftsPrintedLabels(1, 2, 1), false); // 제출하지 않은 새 박스(제출 박스 수 밖)는 해당 없음
  assert.equal(removalShiftsPrintedLabels(2, -1, 2), false);
});

test('라벨은 제출한 박스 수 안의 번호만 출력할 수 있다', () => {
  assert.match(printableSeqError(0, [1]) ?? '', /제출한 뒤에/);
  assert.equal(printableSeqError(2, [1, 2]), null);
  assert.match(printableSeqError(2, [1, 3, 4]) ?? '', /제출한 박스는 2개입니다\. 3·4번/);
  assert.equal(printableSeqError(12, [12]), null);
});

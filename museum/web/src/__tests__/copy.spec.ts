// T035 시험: 문구 사전이 문서(docs/C/C_화면문구.md)의 사유 코드를 모두 덮고, 금지 표현이 없다.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ko, problemCopy, problemKeys } from '../copy/ko';
import { josa } from '../copy/josa';

const doc = readFileSync(resolve(process.cwd(), '../docs/C/C_화면문구.md'), 'utf8');

describe('화면 문구(T035)', () => {
  it('문서 §3의 reason 코드가 모두 사전에 있다(리다이렉트 전용 제외)', () => {
    const sec = doc.slice(doc.indexOf('## 3.'), doc.indexOf('## 4.'));
    const reasons = new Set([...sec.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => m[1]!));
    for (const skip of ['login_required', 'session_revoked', 'no_family', 'not_saved', 'reason', 'code', 'gate', 'waiting_stop']) reasons.delete(skip);
    const have = new Set(problemKeys.map((k) => k.split(':')[1]));
    expect([...reasons].filter((r) => !have.has(r))).toEqual([]);
  });
  it('SD_02 문구를 쓴다(스타일가이드 문구 아님)', () => {
    expect(ko.state.retrying).toBe('다시 시도 중');
    expect(ko.state.not_delivered).toBe('처리하지 못함');
  });
  it('점수·확률·실패 표현이 없다', () => {
    const all = JSON.stringify(ko) + JSON.stringify(problemKeys.map((k) => problemCopy({ gate: k.split(':')[0], reason: k.split(':')[1] })));
    for (const bad of ['점수', '확률', '%', '실패했', '!']) expect(all).not.toContain(bad);
  });
  it('모르는 사유는 기본 문구', () => {
    expect(problemCopy({ reason: 'zzz' }).reason).toContain('잠시 뒤');
  });
  it('바뀌는 값 뒤 조사는 받침에 맞춘다(문서 §0-7)', () => {
    expect(josa('움직임', '을/를')).toBe('움직임을');
    expect(josa('입체 부조', '을/를')).toBe('입체 부조를');
    expect(josa('별이', '과/와')).toBe('별이와');
    expect(josa('하늘', '과/와')).toBe('하늘과');
    expect(josa('별이', '이/가')).toBe('별이가');
    expect(josa('원본 액자', '으로/로')).toBe('원본 액자로');
    expect(josa('3D 조각', '으로/로')).toBe('3D 조각으로');
    expect(josa('하늘', '으로/로')).toBe('하늘로');
    expect(josa('Mia', '이/가')).toBe('Mia이(가)');
    expect(josa('7', '을/를')).toBe('7을');
    const [from, to] = ko.downgrade.animated_to_frame!;
    expect(ko.downgradeNote(from, to)).toBe('움직임을 만들지 못해 원본 액자로 바꿨어요. 원본 액자로 걸 수도 있어요');
    expect(ko.notDelivered.reason('그림 살펴보기')).toContain('그림 살펴보기를 만들지');
    expect(ko.child.dup('별이')).toContain('같은 별칭 별이가 이미');
    expect(ko.del.childItems('하늘', 2)).toBe('하늘과 작품 2개가 모두 지워져요');
  });
  it('해설은 보호자가 적은 것만 말한다(D46 ⑩)', () => {
    expect(ko.museum.intro('해바라기', '하늘', 6, '2026', 9)).toBe('「해바라기」는 하늘이 6살이던 2026년 9월에 그린 작품입니다.');
    expect(ko.museum.intro(null, '하늘', 6, '2026', 9)).toBe('하늘이 6살이던 2026년 9월에 그린 작품입니다.');
    expect(ko.museum.intro('해바라기', '하늘', null, '', 9)).toBe('「해바라기」는 하늘의 작품입니다.');
    expect(ko.museum.intro(null, '하늘', null, '', 9)).toBe('하늘의 작품입니다.');
    expect(ko.museum.intro(null, '별이', 5, '', 1, true)).toBe('별이가 5살 때 만든 작품입니다.');
    expect(ko.museum.artist('하늘', null, '')).toBe('하늘');
    expect(ko.museum.artist('하늘', 6, '2026')).toBe('하늘 (6세 작, 2026)');
  });
});

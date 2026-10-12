// 저장하기(D37, SD_02 §17-10) — 파일 이름 · 명패 문구 · 액자 배치(순수 함수)
import { describe, expect, it } from 'vitest';
import { fileName, frameLayout, plaqueLines, safeName } from '@/app/save';

describe('저장하기(D37)', () => {
  it('파일 이름: 별칭_제목_그린 날, 못 쓰는 글자·공백은 _', () => {
    expect(fileName({ alias: '하늘', title: '우리 집/엄마?', madeOn: '2026-09-30', ageAtMaking: 6 }, 'png')).toBe('하늘_우리_집_엄마_2026-09-30.png');
    expect(fileName({ alias: '하늘', title: '로켓', madeOn: null, ageAtMaking: null }, 'mp4')).toBe('하늘_로켓.mp4');
    expect(safeName('  ')).toBe('그림');
  });
  it('명패: 제목 / 그린 날 · 나이(나이 미정이면 날짜만)', () => {
    expect(plaqueLines({ alias: 'a', title: '무지개', madeOn: '2026-05-05', ageAtMaking: 6 })).toEqual(['무지개', '2026.05.05 · 6살']);
    expect(plaqueLines({ alias: 'a', title: '무지개', madeOn: '2026-05-05', ageAtMaking: null })).toEqual(['무지개', '2026.05.05']);
  });
  it('액자 배치: 긴 변 1800 이하로 줄이고, 매트·테·여백·명패 자리를 둔다', () => {
    const L = frameLayout(4032, 3024);
    expect(L.iw).toBe(1800); expect(L.ih).toBe(1350);
    expect(L.W).toBe(L.fw + 2 * L.margin); expect(L.H).toBe(L.fh + 2 * L.margin + L.plaqueH);
    expect(L.fw).toBe(L.iw + 2 * (L.mat + L.frame));
    const s = frameLayout(300, 400); expect(s.iw).toBe(300); // 작은 그림은 키우지 않는다
  });
});

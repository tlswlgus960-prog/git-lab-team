// T167 시험: S2 작품 영역 자르기(D32, C11) — 계산(사진 밖·최소 크기·키보드·축소·출력 형식)과 CropBox 키보드 조작.
import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { croppedName, drag, full, isFull, keyStep, MIN_SIDE, outputSize, outputType, snap } from '../app/crop';
import CropBox from '../components/CropBox.vue';
import { ko } from '../copy/ko';

const W = 4000, H = 3000;

describe('crop 계산', () => {
  it('처음엔 사진 전체 — 전체면 자르지 않는다', () => {
    expect(isFull(full(W, H), W, H)).toBe(true);
    expect(isFull({ x: 1, y: 0, w: W - 1, h: H }, W, H)).toBe(false);
  });
  it('모서리 끌기 — 반대쪽 모서리는 그대로', () => {
    expect(drag(full(W, H), 'nw', 500, 400, W, H)).toEqual({ x: 500, y: 400, w: 3500, h: 2600 });
    expect(drag(full(W, H), 'se', -1000, -500, W, H)).toEqual({ x: 0, y: 0, w: 3000, h: 2500 });
    expect(drag(full(W, H), 'e', -100, 999, W, H)).toEqual({ x: 0, y: 0, w: 3900, h: 3000 }); // 변 핸들은 한 축만
  });
  it('사진 밖으로 나가지 않는다', () => {
    expect(drag(full(W, H), 'nw', -50, -50, W, H)).toEqual(full(W, H));
    const r = { x: 100, y: 100, w: 1000, h: 800 };
    expect(drag(r, 'move', -500, 99999, W, H)).toEqual({ x: 0, y: 2200, w: 1000, h: 800 });
  });
  it('한 변이 48px보다 작아지지 않는다(사진이 더 작으면 사진 크기)', () => {
    const r = drag(full(W, H), 'se', -99999, -99999, W, H);
    expect([r.w, r.h]).toEqual([MIN_SIDE, MIN_SIDE]);
    expect(drag(full(30, 20), 'se', -99, -99, 30, 20)).toEqual(full(30, 20));
  });
  it('키보드 — 화살표 1%, Shift 10%(짧은 변 기준), 다른 키는 무시', () => {
    expect(keyStep('ArrowLeft', false, W, H)).toEqual([-30, 0]);
    expect(keyStep('ArrowDown', true, W, H)).toEqual([0, 300]);
    expect(keyStep('Enter', false, W, H)).toBeNull();
    expect(keyStep('ArrowUp', false, 40, 40)).toEqual([0, -1]); // 최소 1px
  });
  it('정수 픽셀로 맞춘다', () => {
    expect(snap({ x: 10.4, y: 10.6, w: 99.5, h: 50.2 }, W, H)).toEqual({ x: 10, y: 11, w: 100, h: 50 });
    expect(snap({ x: 3999.7, y: 0, w: 10, h: 10 }, W, H).w).toBe(1);
  });
  it('1,600만 화소를 넘으면 비율 유지로 줄인다', () => {
    expect(outputSize({ x: 0, y: 0, w: 4000, h: 3000 })).toEqual({ w: 4000, h: 3000, scale: 1 });
    const o = outputSize({ x: 0, y: 0, w: 8000, h: 6000 });
    expect(o.w * o.h).toBeLessThanOrEqual(16_000_000);
    expect(o.w / o.h).toBeCloseTo(8000 / 6000, 2);
  });
  it('PNG는 PNG로, 그 밖(JPEG·HEIC)은 JPEG로 — 파일 이름에 -crop', () => {
    expect(outputType('image/png')).toBe('image/png');
    expect(outputType('image/heic', 'IMG_1.HEIC')).toBe('image/jpeg');
    expect(outputType('', 'a.PNG')).toBe('image/png');
    expect(croppedName('IMG_0001.HEIC', 'image/jpeg')).toBe('IMG_0001-crop.jpg');
    expect(croppedName('그림.png', 'image/png')).toBe('그림-crop.png');
  });
});

describe('C11 CropBox', () => {
  const mk = () => mount(CropBox, { props: { src: 'blob:x', width: W, height: H, modelValue: full(W, H) } });
  it('핸들 8개 + 네모 옮기기, 모두 이름 있는 버튼', () => {
    const b = mk().findAll('button');
    expect(b).toHaveLength(9);
    expect(b.map((x) => x.attributes('aria-label'))).toEqual(expect.arrayContaining([ko.upload.crop.handle.move, ko.upload.crop.handle.nw, ko.upload.crop.handle.se]));
    expect(b.every((x) => x.attributes('type') === 'button')).toBe(true); // 폼 제출 안 함
  });
  it('키보드로 모서리를 줄이면 v-model이 바뀐다', async () => {
    const w = mk();
    await w.find(`[aria-label="${ko.upload.crop.handle.nw}"]`).trigger('keydown', { key: 'ArrowRight', shiftKey: true });
    const ev = w.emitted('update:modelValue')!;
    expect(ev.at(-1)![0]).toEqual({ x: 300, y: 0, w: 3700, h: 3000 });
  });
  it('사각형 위치는 사진 대비 %로 그린다', () => {
    const w = mount(CropBox, { props: { src: 'blob:x', width: W, height: H, modelValue: { x: 1000, y: 750, w: 2000, h: 1500 } } });
    const st = w.find('.crop-rect').attributes('style');
    expect(st).toContain('left: 25%'); expect(st).toContain('top: 25%'); expect(st).toContain('width: 50%');
  });
});

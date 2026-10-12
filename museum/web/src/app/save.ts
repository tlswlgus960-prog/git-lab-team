// 저장하기(D37, SD_02 §17-10): [액자 그림 저장] = 브라우저가 그림 + 금빛 액자 + 매트 + 명패를 PNG 한 장으로 그린다(서버 변경 없음, EXIF 없음).
// [움직이는 그림 저장] = 움직임 결과 MP4 그대로. 휴대폰은 공유 시트(사진에 저장)를 먼저, 안 되면 내려받기. 공개 링크는 만들지 않는다(BR-PRV).

export interface SaveMeta { title: string; madeOn: string | null; ageAtMaking: number | null; alias: string }

/** 파일 이름에 못 쓰는 글자와 공백은 `_` */
export function safeName(s: string): string {
  return s.replace(/[/\\:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '') || '그림';
}
export function fileName(m: SaveMeta, ext: 'png' | 'mp4'): string {
  return `${[m.alias, m.title, m.madeOn].filter(Boolean).map((x) => safeName(String(x))).join('_')}.${ext}`;
}
/** 명패 두 줄: 제목 / 그린 날 · 나이 */
export function plaqueLines(m: SaveMeta): [string, string] {
  const d = m.madeOn ? m.madeOn.replace(/-/g, '.') : '';
  return [m.title, [d, m.ageAtMaking == null ? '' : `${m.ageAtMaking}살`].filter(Boolean).join(' · ')];
}
/** 그림 크기 → 캔버스 배치(긴 변 최대 maxSide). 순수 함수 — 시험용 */
export function frameLayout(iw0: number, ih0: number, maxSide = 1800) {
  const k = Math.min(1, maxSide / Math.max(iw0, ih0));
  const iw = Math.round(iw0 * k), ih = Math.round(ih0 * k), big = Math.max(iw, ih);
  const mat = Math.round(big * 0.07), frame = Math.round(big * 0.045);
  const fw = iw + 2 * (mat + frame), fh = ih + 2 * (mat + frame);
  const margin = Math.round(Math.max(fw, fh) * 0.08), plaqueH = Math.round(Math.max(fw, fh) * 0.12);
  return { iw, ih, mat, frame, fw, fh, margin, plaqueH, W: fw + 2 * margin, H: fh + 2 * margin + plaqueH };
}

async function loadBitmap(url: string): Promise<ImageBitmap> {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`file ${r.status}`);
  return createImageBitmap(await r.blob());
}

/** 액자 그림 PNG */
export async function framedPng(stillUrl: string, m: SaveMeta): Promise<Blob> {
  const img = await loadBitmap(stillUrl);
  const L = frameLayout(img.width, img.height);
  const c = document.createElement('canvas'); c.width = L.W; c.height = L.H;
  const g = c.getContext('2d')!;
  // 벽 + 그림 위 조명
  g.fillStyle = '#FFF6EA'; g.fillRect(0, 0, L.W, L.H);
  const spot = g.createRadialGradient(L.W / 2, L.margin * 0.6, 0, L.W / 2, L.margin * 0.6, L.W * 0.75);
  spot.addColorStop(0, 'rgba(255,255,255,.85)'); spot.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = spot; g.fillRect(0, 0, L.W, L.H);
  const x0 = L.margin, y0 = L.margin;
  // 액자 그림자 · 금빛 테
  g.save(); g.shadowColor = 'rgba(40,24,8,.35)'; g.shadowBlur = L.frame * 1.6; g.shadowOffsetY = L.frame * 0.6;
  const gold = g.createLinearGradient(x0, y0, x0 + L.fw, y0 + L.fh);
  gold.addColorStop(0, '#f1d98b'); gold.addColorStop(0.38, '#c9a043'); gold.addColorStop(0.62, '#8e6b22'); gold.addColorStop(1, '#e2c170');
  g.fillStyle = gold; g.fillRect(x0, y0, L.fw, L.fh); g.restore();
  g.strokeStyle = 'rgba(255,236,170,.6)'; g.lineWidth = Math.max(1, L.frame * 0.12); g.strokeRect(x0 + g.lineWidth, y0 + g.lineWidth, L.fw - 2 * g.lineWidth, L.fh - 2 * g.lineWidth);
  // 매트 · 그림
  const mx = x0 + L.frame, my = y0 + L.frame;
  g.fillStyle = '#fffeef'; g.fillRect(mx, my, L.fw - 2 * L.frame, L.fh - 2 * L.frame);
  g.strokeStyle = 'rgba(142,107,34,.45)'; g.lineWidth = Math.max(1, L.frame * 0.06); g.strokeRect(mx, my, L.fw - 2 * L.frame, L.fh - 2 * L.frame);
  g.drawImage(img, mx + L.mat, my + L.mat, L.iw, L.ih);
  // 명패(황동)
  const [l1, l2] = plaqueLines(m);
  const ph = L.plaqueH * 0.62, pw = Math.min(L.fw * 0.7, Math.max(L.fw * 0.36, ph * 5.2)), px = (L.W - pw) / 2, py = y0 + L.fh + (L.margin + L.plaqueH - ph) / 2;
  const brass = g.createLinearGradient(px, py, px + pw, py + ph);
  brass.addColorStop(0, '#E9D39A'); brass.addColorStop(0.55, '#C9A552'); brass.addColorStop(1, '#A98435');
  g.fillStyle = brass; g.fillRect(px, py, pw, ph);
  g.fillStyle = '#2B2007'; g.textAlign = 'center'; g.textBaseline = 'middle';
  const f1 = Math.round(ph * 0.3), f2 = Math.round(ph * 0.2);
  g.font = `700 ${f1}px "Noto Serif KR", serif`; g.fillText(l1, L.W / 2, py + ph * (l2 ? 0.38 : 0.5), pw * 0.9);
  if (l2) { g.font = `500 ${f2}px "Noto Sans KR", sans-serif`; g.fillText(l2, L.W / 2, py + ph * 0.74, pw * 0.9); }
  // 서명
  g.textAlign = 'right'; g.fillStyle = 'rgba(110,53,80,.75)'; g.font = `600 ${Math.round(L.plaqueH * 0.14)}px "Noto Serif KR", serif`;
  g.fillText(`${m.alias}의 미술관`, L.W - L.margin * 0.5, L.H - L.margin * 0.35);
  img.close?.();
  return await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'));
}

/** 움직이는 그림 MP4 */
export async function animationMp4(videoUrl: string): Promise<Blob> {
  const r = await fetch(videoUrl, { credentials: 'include' });
  if (!r.ok) throw new Error(`file ${r.status}`);
  const b = await r.blob();
  return b.type ? b : new Blob([b], { type: 'video/mp4' });
}

/** 휴대폰(굵은 포인터)은 공유 시트 먼저, 그 밖은 내려받기. 'cancelled'면 보호자가 닫은 것 */
export async function deliver(blob: Blob, name: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], name, { type: blob.type });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (matchMedia('(pointer: coarse)').matches && nav.canShare?.({ files: [file] })) {
    try { await nav.share({ files: [file], title: name }); return 'shared'; } catch (e) {
      if ((e as DOMException).name === 'AbortError') return 'cancelled';
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return 'downloaded';
}

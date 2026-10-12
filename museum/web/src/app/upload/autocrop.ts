// @ts-nocheck — D35 자동 자르기 · 원근 펴기(A 방법 결정 docs/A/A_자동자르기_방법결정_2026-09-30.md). 원형 docs/A/autocrop/autocrop.js를 그대로 옮김(시험: 합성 10장 중 8장 자동, 모서리 오차 < 1%).
// D35 자동 자르기 · 원근 펴기 — 브라우저 전용, 의존성 없음(A 최호준 몫, 이제민 세션2 작성 · 2026-09-30).
// 사진을 서버로 보내기 전에 브라우저에서 종이 네 모서리를 찾고(detectPaper), 반듯하게 편다(warpQuad).
// 원칙: 확신이 없으면 null을 돌려준다 → 화면은 D32 사각형 자르기(사진 전체)로 돌아간다. 틀린 자르기보다 안 자르는 게 낫다.

const SMALL = 320; // 찾기용 축소 한 변

/** 캔버스 · 이미지에서 찾기 → { quad: [[x,y]×4](원본 좌표, 시계 방향 · 왼쪽 위부터), score, fill, reason } 또는 { quad: null, reason } */
export function detectPaper(source, srcW, srcH) {
  const k = SMALL / Math.max(srcW, srcH), w = Math.max(8, Math.round(srcW * k)), h = Math.max(8, Math.round(srcH * k));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(source, 0, 0, w, h);
  const r = detectOnPixels(g.getImageData(0, 0, w, h).data, w, h);
  const up = (q) => q && q.map(([x, y]) => [x / k, y / k]); // 축소 좌표 → 원본 좌표(확신 낮을 때의 추정값도)
  return { ...r, quad: up(r.quad), guess: up(r.guess) };
}

/** 핵심(순수 함수 — 시험용). rgba: Uint8ClampedArray(w*h*4) */
export function detectOnPixels(rgba, w, h) {
  const n = w * h, R = new Float32Array(n), G = new Float32Array(n), B = new Float32Array(n);
  for (let i = 0; i < n; i++) { R[i] = rgba[i * 4]; G[i] = rgba[i * 4 + 1]; B[i] = rgba[i * 4 + 2]; }
  for (const ch of [R, G, B]) { blur(ch, w, h); blur(ch, w, h); }
  // 1) 배경 = 테두리 띠(4%)의 가운데 색
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.04)), bi = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < band || y < band || x >= w - band || y >= h - band) bi.push(y * w + x);
  const bg = [median(bi.map((i) => R[i])), median(bi.map((i) => G[i])), median(bi.map((i) => B[i]))];
  // 2) 배경과 다른 곳(오츠 문턱) — 종이가 테두리를 덮은 사진이면 반대로도 해 보고 더 나은 쪽
  const dist = new Float32Array(n);
  for (let i = 0; i < n; i++) dist[i] = Math.hypot(R[i] - bg[0], G[i] - bg[1], B[i] - bg[2]);
  const t = otsu(dist);
  const L = new Float32Array(n); for (let i = 0; i < n; i++) L[i] = 0.299 * R[i] + 0.587 * G[i] + 0.114 * B[i];
  const tl = otsu(L);
  const seeds = [(i) => dist[i] > t, (i) => dist[i] <= t, (i) => L[i] > tl]; // 배경과 다름 · 그 반대(종이가 테두리를 덮음) · 밝은 곳(나뭇결처럼 배경 무늬가 셀 때)
  const tries = [];
  for (const seed of seeds) {
    let m = new Uint8Array(n); for (let i = 0; i < n; i++) m[i] = seed(i) ? 1 : 0;
    m = largest(fillHoles(close(m, w, h, 2), w, h), w, h);
    if (!m.area) continue;
    // 3) 종이 색으로 다시 거르기(손 · 옆 물건 빼기): 덩어리의 가운데 색에서 가까운 곳 + 구멍 메우기
    const idx = []; for (let i = 0; i < n; i++) if (m.mask[i]) idx.push(i);
    const pc = [median(idx.map((i) => R[i])), median(idx.map((i) => G[i])), median(idx.map((i) => B[i]))];
    const pd = idx.map((i) => Math.hypot(R[i] - pc[0], G[i] - pc[1], B[i] - pc[2]));
    const pt = Math.max(28, quantile(pd, 0.6) * 2.2);
    const m2 = new Uint8Array(n); for (let i = 0; i < n; i++) m2[i] = m.mask[i] && Math.hypot(R[i] - pc[0], G[i] - pc[1], B[i] - pc[2]) < pt ? 1 : 0;
    const p = largest(fillHoles(close(m2, w, h, 3), w, h), w, h);
    if (!p.area) continue;
    tries.push(fitQuad(p.mask, p.area, w, h));
  }
  const best = tries.filter((q) => q.quad).sort((a, b) => b.score - a.score)[0];
  if (!best) return { quad: null, reason: tries[0]?.reason ?? 'no_region' };
  const dbg = tries.map((q) => ({ score: +(q.score ?? 0).toFixed(3), fill: +(q.fill ?? 0).toFixed(3), onEdge: +(q.onEdge ?? 0).toFixed(3), frac: +(q.frac ?? 0).toFixed(3), reason: q.reason }));
  return best.score >= 0.9 ? { ...best, dbg } : { quad: null, reason: 'low_confidence', score: best.score, guess: best.quad, dbg };
}

/** 덩어리 → 네 모서리: 볼록 껍질 → 넓이 최대 사각형 → 네 변 직선 맞춤(가려진 모서리 되찾기) → 점수 */
function fitQuad(mask, area, w, h) {
  const pts = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1 || !mask[i - 1] || !mask[i + 1] || !mask[i - w] || !mask[i + w]) pts.push([x + 0.5, y + 0.5]);
  }
  const hull = convexHull(pts);
  if (hull.length < 4) return { quad: null, reason: 'degenerate' };
  let quad = maxAreaQuad(hull);
  quad = refineBySides(quad, pts, w, h) ?? quad;
  quad = order(quad);
  const qa = polyArea(quad), fill = area / qa, frac = qa / (w * h);
  const angles = quad.map((p, i) => angle(quad[(i + 3) % 4], p, quad[(i + 1) % 4]));
  const angOk = angles.every((a) => a > 45 && a < 135);
  const tol = Math.hypot(w, h) * 0.012;
  const onEdge = pts.filter((p) => { const x = p[0], y = p[1]; if (x < 1 || y < 1 || x > w - 1 || y > h - 1) return true; // 사진 가장자리에 잘린 변은 셈에서 뺀다
    return quad.some((a, i) => segDist(p, a, quad[(i + 1) % 4]) < tol); }).length / pts.length;
  let score = Math.min(1, fill, onEdge) * (angOk ? 1 : 0.5);
  let reason = 'ok';
  if (frac < 0.03) { score *= 0.5; reason = 'too_small'; }
  if (frac > 0.985) { score = 0; reason = 'whole_photo'; } // 사진 전체 = 자를 것 없음(자동으로 고르지 않음)
  return { quad, score, fill, onEdge, frac, reason };
}

/** 네 변마다 그 변 가까이 있는 테두리 점으로 직선을 다시 맞추고, 이웃 직선의 교점을 모서리로 */
function refineBySides(quad, pts, w, h) {
  const diag = Math.hypot(w, h), lines = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s], b = quad[(s + 1) % 4], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / L, ny = (b[0] - a[0]) / L, tol = diag * 0.02;
    const near = pts.filter(([x, y]) => {
      const t = ((x - a[0]) * (b[0] - a[0]) + (y - a[1]) * (b[1] - a[1])) / (L * L);
      return t > 0.12 && t < 0.88 && Math.abs((x - a[0]) * nx + (y - a[1]) * ny) < tol && x > 0.6 && y > 0.6 && x < w - 0.6 && y < h - 0.6;
    });
    if (near.length < 8) { lines.push(null); continue; }
    let ln = fitLine(near);
    for (let it = 0; it < 2; it++) { const res = near.map((q) => Math.abs((q[0] - ln.p[0]) * -ln.d[1] + (q[1] - ln.p[1]) * ln.d[0])); const cut = Math.max(0.8, quantile(res, 0.6) * 1.5); const keep = near.filter((_, i) => res[i] <= cut); if (keep.length >= 8) ln = fitLine(keep); }
    lines.push(ln);
  }
  const out = [];
  for (let s = 0; s < 4; s++) {
    const l1 = lines[(s + 3) % 4], l2 = lines[s];
    const p = l1 && l2 ? intersect(l1, l2) : null;
    // 교점이 원래 모서리에서 너무 멀면(평행에 가까움) 원래 모서리
    out.push(p && Math.hypot(p[0] - quad[s][0], p[1] - quad[s][1]) < diag * 0.12 ? p : quad[s]);
  }
  return out;
}

/** 원근 펴기: quad(원본 좌표) → 반듯한 캔버스. 한 변 최대 maxSide */
export function warpQuad(source, quad, maxSide = 2400) {
  const [tl, tr, br, bl] = quad, d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  let ow = Math.max(d(tl, tr), d(bl, br)), oh = Math.max(d(tl, bl), d(tr, br));
  const s = Math.min(1, maxSide / Math.max(ow, oh)); ow = Math.round(ow * s); oh = Math.round(oh * s);
  const sw = source.naturalWidth ?? source.width, sh = source.naturalHeight ?? source.height;
  const sc = document.createElement('canvas'); sc.width = sw; sc.height = sh;
  const sg = sc.getContext('2d', { willReadFrequently: true }); sg.drawImage(source, 0, 0);
  const src = sg.getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas'); out.width = ow; out.height = oh;
  const og = out.getContext('2d'), img = og.createImageData(ow, oh), dst = img.data;
  const Hm = homography([[0, 0], [ow, 0], [ow, oh], [0, oh]], quad); // 결과 → 원본
  for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
    const X = Hm[0] * (x + .5) + Hm[1] * (y + .5) + Hm[2], Y = Hm[3] * (x + .5) + Hm[4] * (y + .5) + Hm[5], Z = Hm[6] * (x + .5) + Hm[7] * (y + .5) + 1;
    let u = X / Z - .5, v = Y / Z - .5; u = Math.max(0, Math.min(sw - 1.001, u)); v = Math.max(0, Math.min(sh - 1.001, v));
    const x0 = u | 0, y0 = v | 0, fx = u - x0, fy = v - y0, o = (y * ow + x) * 4;
    const i00 = (y0 * sw + x0) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
    for (let c = 0; c < 3; c++) dst[o + c] = src[i00 + c] * (1 - fx) * (1 - fy) + src[i10 + c] * fx * (1 - fy) + src[i01 + c] * (1 - fx) * fy + src[i11 + c] * fx * fy;
    dst[o + 3] = 255;
  }
  og.putImageData(img, 0, 0); return out;
}

// ---- 도구 ----
function blur(a, w, h) { // 3×3 상자 흐림
  const t = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx >= 0 && xx < w) { s += a[y * w + xx]; c++; } } t[y * w + x] = s / c; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy >= 0 && yy < h) { s += t[yy * w + x]; c++; } } a[y * w + x] = s / c; }
}
function median(v) { const s = Float32Array.from(v).sort(); return s[s.length >> 1]; }
function quantile(v, q) { const s = Float32Array.from(v).sort(); return s[Math.min(s.length - 1, Math.floor(s.length * q))]; }
function otsu(v) {
  let mx = 0; for (const x of v) if (x > mx) mx = x; const bins = 128, hist = new Float64Array(bins);
  for (const x of v) hist[Math.min(bins - 1, (x / (mx || 1)) * bins | 0)]++;
  const tot = v.length; let sum = 0; for (let i = 0; i < bins; i++) sum += i * hist[i];
  let sB = 0, wB = 0, best = 0, th = 0;
  for (let i = 0; i < bins; i++) { wB += hist[i]; if (!wB) continue; const wF = tot - wB; if (!wF) break; sB += i * hist[i];
    const mB = sB / wB, mF = (sum - sB) / wF, b = wB * wF * (mB - mF) ** 2; if (b > best) { best = b; th = i; } }
  return ((th + 0.5) / bins) * mx;
}
function close(m, w, h, r) { return morph(morph(m, w, h, r, 1), w, h, r, 0); }
function morph(m, w, h, r, dil) { // 정사각 구조 요소, 가로 · 세로 분리
  const t = new Uint8Array(m.length), o = new Uint8Array(m.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = dil ? 0 : 1; for (let d = -r; d <= r; d++) { const xx = x + d; const b = xx < 0 || xx >= w ? (dil ? 0 : 1) : m[y * w + xx]; if (dil ? b : !b) { v = dil ? 1 : 0; break; } } t[y * w + x] = v; }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = dil ? 0 : 1; for (let d = -r; d <= r; d++) { const yy = y + d; const b = yy < 0 || yy >= h ? (dil ? 0 : 1) : t[yy * w + x]; if (dil ? b : !b) { v = dil ? 1 : 0; break; } } o[y * w + x] = v; }
  return o;
}
function fillHoles(m, w, h) { // 테두리에서 닿지 않는 빈 곳 = 구멍 → 채움
  const seen = new Uint8Array(m.length), q = [];
  for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (!m[i] && !seen[i]) { seen[i] = 1; q.push(i); } }
  for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (!m[i] && !seen[i]) { seen[i] = 1; q.push(i); } }
  while (q.length) { const i = q.pop(), x = i % w, y = (i / w) | 0;
    for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && !m[j] && !seen[j]) { seen[j] = 1; q.push(j); } }
  const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = m[i] || !seen[i] ? 1 : 0; return o;
}
function largest(m, w, h) {
  const lab = new Int32Array(m.length); let best = 0, bestA = 0, cur = 0;
  for (let s = 0; s < m.length; s++) { if (!m[s] || lab[s]) continue; cur++; let a = 0; const q = [s]; lab[s] = cur;
    while (q.length) { const i = q.pop(), x = i % w, y = (i / w) | 0; a++;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (j >= 0 && m[j] && !lab[j]) { lab[j] = cur; q.push(j); } }
    if (a > bestA) { bestA = a; best = cur; } }
  const o = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) o[i] = lab[i] === best ? 1 : 0;
  return { mask: o, area: bestA };
}
function convexHull(p) {
  const s = p.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]), cr = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of s) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = s.length - 1; i >= 0; i--) { const q = s[i]; while (up.length >= 2 && cr(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  return lo.slice(0, -1).concat(up.slice(0, -1));
}
function tri(a, b, c) { return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / 2; }
function maxAreaQuad(hp) { // 볼록 다각형 안 넓이 최대 사각형(대각선 i–k 고정, j · l은 두 포인터)
  let P = hp; if (P.length > 120) { const st = P.length / 120; P = Array.from({ length: 120 }, (_, i) => hp[Math.floor(i * st)]); }
  const n = P.length; let best = -1, bq = null;
  for (let i = 0; i < n; i++) { let j = i + 1, l = i + 3;
    for (let k = i + 2; k < n; k++) {
      if (j <= i || j >= k) j = i + 1; while (j + 1 < k && tri(P[i], P[j + 1], P[k]) >= tri(P[i], P[j], P[k])) j++;
      if (l <= k) l = k + 1; if (l >= n) { if (k + 1 >= n) break; l = k + 1; }
      while (l + 1 < n && tri(P[i], P[k], P[l + 1]) >= tri(P[i], P[k], P[l])) l++;
      if (l >= n || l <= k) continue;
      const a = tri(P[i], P[j], P[k]) + tri(P[i], P[k], P[l]); if (a > best) { best = a; bq = [P[i], P[j], P[k], P[l]]; } } }
  return bq;
}
function order(q) { // 왼쪽 위부터 시계 방향
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const s = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let k = 0, m = Infinity; s.forEach((p, i) => { if (p[0] + p[1] < m) { m = p[0] + p[1]; k = i; } });
  return [0, 1, 2, 3].map((i) => s[(k + i) % 4]);
}
function segDist(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function polyArea(q) { let a = 0; for (let i = 0; i < q.length; i++) { const p = q[i], r = q[(i + 1) % q.length]; a += p[0] * r[1] - r[0] * p[1]; } return Math.abs(a) / 2; }
function angle(a, b, c) { const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]]; return Math.acos(Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / (Math.hypot(...v1) * Math.hypot(...v2))))) * 180 / Math.PI; }
function fitLine(pts) { // 전체 최소제곱(주성분) → {p, d}
  const n = pts.length, mx = pts.reduce((s, p) => s + p[0], 0) / n, my = pts.reduce((s, p) => s + p[1], 0) / n;
  let sxx = 0, sxy = 0, syy = 0; for (const [x, y] of pts) { sxx += (x - mx) ** 2; sxy += (x - mx) * (y - my); syy += (y - my) ** 2; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy); return { p: [mx, my], d: [Math.cos(th), Math.sin(th)] };
}
function intersect(a, b) {
  const det = a.d[0] * b.d[1] - a.d[1] * b.d[0]; if (Math.abs(det) < 1e-6) return null;
  const t = ((b.p[0] - a.p[0]) * b.d[1] - (b.p[1] - a.p[1]) * b.d[0]) / det; return [a.p[0] + a.d[0] * t, a.p[1] + a.d[1] * t];
}
function homography(src, dst) { // src → dst 3×3(h33 = 1), 8×8 가우스 소거
  const A = [], b = [];
  for (let i = 0; i < 4; i++) { const [x, y] = src[i], [u, v] = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y]); b.push(u); A.push([0, 0, 0, x, y, 1, -v * x, -v * y]); b.push(v); }
  for (let c = 0; c < 8; c++) { let p = c; for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]]; [b[c], b[p]] = [b[p], b[c]];
    for (let r = 0; r < 8; r++) if (r !== c) { const f = A[r][c] / A[c][c]; for (let k = c; k < 8; k++) A[r][k] -= f * A[c][k]; b[r] -= f * b[c]; } }
  return b.map((v, i) => v / A[i][i]);
}

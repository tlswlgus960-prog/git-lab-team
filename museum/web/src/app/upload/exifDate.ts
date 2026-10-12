// 사진 촬영일(D34 ③ capturedOn): JPEG EXIF DateTimeOriginal(0x9003)에서 날짜만 읽는다. 위치 · 기기 정보는 읽지도 보내지도 않는다.
import { localToday } from '../localDate';
// JPEG가 아니거나 없으면 null — 서버가 올린 날로 채운다.
export async function exifDate(f: Blob): Promise<string | null> {
  try {
    const b = new DataView(await f.slice(0, 256 * 1024).arrayBuffer());
    if (b.getUint16(0) !== 0xffd8) return null;
    let o = 2;
    while (o + 4 < b.byteLength) {
      const m = b.getUint16(o), len = b.getUint16(o + 2);
      if (m === 0xffe1 && b.getUint32(o + 4) === 0x45786966) return readTiff(b, o + 10);
      if ((m & 0xff00) !== 0xff00) return null;
      o += 2 + len;
    }
  } catch { /* 못 읽으면 없음 */ }
  return null;
}
function readTiff(b: DataView, t: number): string | null {
  const le = b.getUint16(t) === 0x4949; const u16 = (p: number) => b.getUint16(p, le); const u32 = (p: number) => b.getUint32(p, le);
  const ifd = (start: number, tag: number) => { const n = u16(start); for (let i = 0; i < n; i++) { const e = start + 2 + i * 12; if (u16(e) === tag) return e; } return -1; };
  const e0 = ifd(t + u32(t + 4), 0x8769); if (e0 < 0) return null;
  const e1 = ifd(t + u32(e0 + 8), 0x9003); if (e1 < 0) return null;
  const at = t + u32(e1 + 8); let s = '';
  for (let i = 0; i < 10; i++) s += String.fromCharCode(b.getUint8(at + i));
  const m = /^(\d{4}):(\d{2}):(\d{2})$/.exec(s);
  if (!m || m[1] === '0000') return null;
  const d = `${m[1]}-${m[2]}-${m[3]}`;
  return d > localToday() ? null : d;
}

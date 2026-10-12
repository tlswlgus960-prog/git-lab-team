// 사진 검사(T060, G5, BR-INT-01, research R-13): 형식은 매직 바이트로(확장자·Content-Type 불신), 20MB, 판독 가능 여부.
// 원본은 변환하지 않는다(BR-INT-04).
import sharp from 'sharp';
import decodeHeic from 'heic-decode';
import { Problem } from '../../lib/problem.js';

export const MAX_BYTES = 20 * 1024 * 1024;
export type ImageType = { mime: 'image/jpeg' | 'image/png' | 'image/heic'; ext: 'jpg' | 'png' | 'heic' };

const HEIC_BRANDS = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1']);

export function sniff(buf: Buffer): ImageType | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: 'image/jpeg', ext: 'jpg' };
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: 'image/png', ext: 'png' };
  if (buf.length > 12 && buf.toString('latin1', 4, 8) === 'ftyp' && HEIC_BRANDS.has(buf.toString('latin1', 8, 12))) return { mime: 'image/heic', ext: 'heic' };
  return null;
}

export async function validateUpload(buf: Buffer | undefined): Promise<ImageType> {
  if (!buf || buf.length === 0) throw new Problem('invalid_input', 'missing_photo', 'G5');
  if (buf.length > MAX_BYTES) throw new Problem('payload_too_large', 'over_20mb', 'G5');
  const type = sniff(buf);
  if (!type) throw new Problem('invalid_input', 'format', 'G5');
  try {
    if (type.ext === 'heic') {
      const img = await decodeHeic({ buffer: buf });
      if (!img?.width || !img?.height) throw new Error('empty');
    } else {
      const meta = await sharp(buf, { failOn: 'error' }).stats();
      if (!meta) throw new Error('empty');
    }
  } catch {
    throw new Problem('invalid_input', 'unreadable', 'G5');
  }
  return type;
}

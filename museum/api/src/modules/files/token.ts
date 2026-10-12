// 파일 읽기 토큰(T026, SD_03 §17): 가족 확인 뒤에만 발급, 5분 유효 [추론], HMAC 서명. 객체 키는 토큰에 넣지 않는다.
import { createHmac, timingSafeEqual } from 'node:crypto';

const TTL_SECONDS = 300;

export function signFileToken(secret: string, objectId: number, familyId: number, now = Date.now()): string {
  const payload = `${objectId}.${familyId}.${Math.floor(now / 1000) + TTL_SECONDS}`;
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + mac;
}

export function verifyFileToken(secret: string, token: string, now = Date.now()): { objectId: number; familyId: number } | null {
  const [p64, mac] = token.split('.');
  if (!p64 || !mac) return null;
  const payload = Buffer.from(p64, 'base64url').toString();
  const expect = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [o, f, exp] = payload.split('.').map(Number);
  if (!o || !f || !exp || exp * 1000 < now) return null;
  return { objectId: o, familyId: f };
}

/** 방문 파일 토큰(D40, UC_16): 주인 가족 · 보는 가족을 함께 서명. 가족 토큰과 형식이 달라 서로 바꿔 쓸 수 없다. 받을 때마다 이웃 관계는 따로 확인 */
export function signVisitToken(secret: string, objectId: number, ownerFamilyId: number, viewerFamilyId: number, now = Date.now()): string {
  const payload = `v.${objectId}.${ownerFamilyId}.${viewerFamilyId}.${Math.floor(now / 1000) + TTL_SECONDS}`;
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return Buffer.from(payload).toString('base64url') + '.' + mac;
}

export function verifyVisitToken(secret: string, token: string, now = Date.now()): { objectId: number; ownerFamilyId: number; viewerFamilyId: number } | null {
  const [p64, mac] = token.split('.');
  if (!p64 || !mac) return null;
  const payload = Buffer.from(p64, 'base64url').toString();
  const expect = createHmac('sha256', secret).update(payload).digest('base64url');
  const a = Buffer.from(mac);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [tag, ...rest] = payload.split('.');
  const [o, owner, viewer, exp] = rest.map(Number);
  if (tag !== 'v' || !o || !owner || !viewer || !exp || exp * 1000 < now) return null;
  return { objectId: o, ownerFamilyId: owner, viewerFamilyId: viewer };
}

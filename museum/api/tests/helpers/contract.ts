// 시험 모드 응답 계약 검증(T024, R-19, BR-API-08) — 시험 파일마다 contracts/openapi.yaml과 어긋난 응답이 없어야 한다.
// 공통 오류(D21: 401·403·409 no_family)는 계약 머리말에만 적으므로 helpers/app.ts에서 넘긴다.
import { afterAll, expect } from 'vitest';
import { contractViolations } from './app.js';

afterAll(() => {
  const found = contractViolations.splice(0);
  expect(found, '계약과 어긋난 응답(contracts/openapi.yaml을 먼저 고치거나 구현을 계약에 맞춘다)').toEqual([]);
});

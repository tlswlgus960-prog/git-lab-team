// 모델 점검(D20, T157) — S11 "마지막 점검" 칸과 S10 준비 표가 같이 쓴다. 점수 없음: 통과/실패 사유·처리 시간·끝난 지 얼마만.
import { api } from '@/api/client';
import type { components } from '@/api/types.gen';
import { ko } from '@/copy/ko';

export type ModelCheck = components['schemas']['ModelCheck'];
/** 점검 버튼이 있는 모델(M4 규칙은 없음, M6은 P0.5부터 — SD_02 §14-3) */
export const CHECKABLE = ['M1', 'M2', 'M3', 'M5', 'M7'];

export const loadChecks = () => api.get<{ checks: ModelCheck[] }>('/v1/ops/model-checks').then((r) => r.checks);

export const checkBusy = (c?: ModelCheck | null) => c?.status === 'queued' || c?.status === 'running';

export function checkText(c: ModelCheck | null | undefined, now = Date.now()): string {
  if (!c) return ko.ops.checkNone;
  if (c.status === 'queued') return ko.ops.checkQueued;
  if (c.status === 'running') return ko.ops.checkRunning;
  if (c.status === 'failed') return ko.ops.checkFailed(ko.ops.failReason[c.failReason ?? ''] ?? ko.ops.failReason.model_not_ready!);
  const sec = c.processingMs == null ? '-' : (c.processingMs / 1000).toFixed(1);
  const min = c.finishedAt ? Math.floor((now - new Date(c.finishedAt).getTime()) / 60000) : 0;
  return ko.ops.checkPassed(sec, ko.ops.ago(min));
}

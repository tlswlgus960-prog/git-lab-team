// 작품 화면 공통(S3·S4·S5·S6, SD_02 §2-3·§7-3). 상태 → 갈 화면, 폴링할 상태, 레일 표시를 한 곳에서 정한다.
import { api, ApiError, toBlock, type BlockNotice } from '@/api/client';
import type { components } from '@/api/types.gen';
import { ko } from '@/copy/ko';

export type ArtworkDetail = components['schemas']['ArtworkDetail'];
export type ArtworkSummary = components['schemas']['ArtworkSummary'];
export type ArtworkState = components['schemas']['ArtworkState'];

/** 확정 전 상태(S3가 받는 상태, API CONFIRM_STATES와 같다) */
export const CONFIRM_STATES: readonly ArtworkState[] = ['received', 'judging', 'awaiting_confirm'];
/** 서버가 저절로 바꾸는 상태 — 이때만 폴링한다(R-12) */
export const MOVING_STATES: readonly ArtworkState[] = ['received', 'judging', 'processing'];
/** 확정 선택지 순서 — 같은 크기·같은 무게로 늘 이 순서(UX2) */
export const KIND_ORDER = ['animated', 'relief', 'frame', 'sculpture'] as const;
/** 결정 선택지 순서(SD_02 S5) */
export const DECISION_ORDER = ['like', 'use_lower', 'frame', 'retake'] as const;

/** 작품을 눌렀을 때 갈 화면(SD_02 §7-3 UC3 BF2·BF7·A9). */
export function routeFor(a: { id: string; state: ArtworkState; confirmedKind?: string | null }): string {
  const base = `/app/artworks/${a.id}`;
  if (CONFIRM_STATES.includes(a.state) && !a.confirmedKind) return `${base}/confirm`;
  if (a.state === 'awaiting_review' || a.state === 'failed') return `${base}/review`;
  if (a.state === 'approved') return `${base}/story`;
  return base;
}

/** 목록의 다음 행동 버튼 문구(없으면 빈 문자열 — 진행 상세로만 간다). */
export function nextActionLabel(state: ArtworkState): string {
  if (state === 'awaiting_confirm') return ko.list.toConfirm;
  if (state === 'awaiting_review' || state === 'failed') return ko.list.toReview;
  if (state === 'approved') return ko.list.toStory;
  if (state === 'exhibited') return ko.list.toGallery;
  return '';
}

/** C1 작품 레일 표시(SD_02 §3-2). failed는 처리 중 자리에서 막힘 G9. */
export function railOf(state: ArtworkState): { current: string; variant: 'default' | 'blocked' | 'waiting' | 'hold'; gate: string | null; blockedLabel?: string } {
  if (state === 'failed') return { current: 'processing', variant: 'blocked', gate: 'G9', blockedLabel: ko.state.not_delivered };
  if (state === 'approved') return { current: 'approved', variant: 'hold', gate: 'G12' };
  return { current: state, variant: 'default', gate: null };
}

/** 상세에서 "현재 단계"(처리 중이거나 막힌 단계). */
export function currentStage(a: ArtworkDetail): string | null {
  const s = a.stages.find((x) => x.status === 'running' || x.status === 'retrying' || x.status === 'waiting')
    ?? [...a.stages].reverse().find((x) => x.status === 'failed');
  return s?.stage ?? null;
}

/** G9 처리하지 못함 블록 — 낮춘 결과가 아님을 밝힌다(UX3, 원칙 3). */
export function notDeliveredBlock(a: ArtworkDetail): BlockNotice {
  const failed = [...a.stages].reverse().find((x) => x.status === 'failed');
  const what = failed ? ko.stageName[failed.stage] ?? ko.kind[a.confirmedKind ?? ''] ?? '' : ko.kind[a.confirmedKind ?? ''] ?? '';
  return {
    variant: 'block', gate: 'G9', summary: ko.notDelivered.summary, reason: ko.notDelivered.reason(what || (ko.kind.frame ?? '')),
    releaser: ko.notDelivered.releaser, self: true, actions: [ko.list.toReview], fields: [],
  };
}

/** 오류를 차단 블록 모델로(무응답도 전역 실패 문구로). */
export function blockOf(e: unknown): BlockNotice {
  return toBlock(e instanceof ApiError ? e : new ApiError(0, null));
}

export const loadArtwork = (id: string) => api.get<ArtworkDetail>(`/v1/artworks/${encodeURIComponent(id)}`);

/** 결과 종류 이름. frame 결과는 원본을 그대로 건다(primaryUrl 없음 — API view.ts). */
export function resultImage(a: Pick<ArtworkDetail, 'result' | 'originalUrl' | 'cutoutUrl'>): { still: string | null; video: string | null } {
  const r = a.result;
  if (!r) return { still: a.originalUrl ?? null, video: null };
  if (r.kind === 'animated') return { still: r.posterUrl ?? a.cutoutUrl ?? a.originalUrl ?? null, video: r.primaryUrl ?? null };
  if (r.kind === 'relief') return { still: r.auxUrl ?? a.cutoutUrl ?? a.originalUrl ?? null, video: null };
  return { still: r.primaryUrl ?? a.originalUrl ?? null, video: null };
}

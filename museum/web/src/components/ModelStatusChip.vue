<script setup lang="ts">
// C10 모델 상태 칩(T111, SD_02 §3-4·§3-5·§17). 문구 + 모양으로만 구분한다(색만으로 말하지 않음, 오류 색 없음).
// 준비됨(채움) · 미준비(빈 칸) · 불러오는 중(빈 칸+막대, 오류 아님) · 적재 실패(굵은 테두리) · 내려감 짐작(M6, 빈 칸)
// · 비활성 라이선스/P0.5(사선) · CPU 실행(연한 채움) · 비노출 P1(점선) · 확인 불가(회색 채움).
// 값은 GET /v1/ops/models(model-api ModelLoadStatus). 응답이 없으면 확인 불가(S10 E5).
import { computed } from 'vue';
import { ko } from '@/copy/ko';

export interface LoadStatus {
  modelId: string; activeVersion?: string | null; execDevice?: string | null; licenseConfirmed: boolean; hint?: string | null;
  load?: { state?: string; elapsedSeconds?: number | null; remainingSeconds?: number | null; expectedSeconds?: number | null; lastLoadSeconds?: number | null; overdue?: boolean; diagnostic?: string | null } | null;
}
const props = withDefaults(defineProps<{ modelId: string; status?: LoadStatus | null; exposed?: boolean }>(), { status: null, exposed: false });

const view = computed<{ cls: string; text: string; bar?: number }>(() => {
  const s = props.status;
  if (props.modelId === 'M7' && !props.exposed) return { cls: 'hidden', text: ko.model.hidden };
  if (!s) return { cls: 'unknown', text: ko.model.unknown };
  const st = s.load?.state;
  if (props.modelId === 'M6' && (!s.load || st === 'unavailable')) return { cls: 'inactive', text: ko.model.inactive_tier };
  // licenseConfirmed는 활성 버전 기준 — 활성 버전이 없으면(no_active_version) 라이선스 문제가 아니라 승격 전이다
  if (st === 'disabled' && s.load?.diagnostic === 'no_active_version') return { cls: 'inactive', text: ko.model.inactive_promote };
  if (st === 'disabled') return s.licenseConfirmed ? { cls: 'not-ready', text: ko.model.not_loaded } : { cls: 'inactive', text: ko.model.inactive_license };
  if (st === 'loading') {
    const l = s.load!;
    const bar = l.expectedSeconds && l.elapsedSeconds != null ? Math.min(1, l.elapsedSeconds / l.expectedSeconds) : undefined;
    const text = l.overdue ? `${ko.model.loading} · ${ko.model.loadingSlow}`
      : `${ko.model.loading} · ${ko.ops.loading(Math.round(l.elapsedSeconds ?? 0), l.remainingSeconds != null ? Math.round(l.remainingSeconds) : null)}`;
    return { cls: 'loading', text, bar };
  }
  if (st === 'failed') return { cls: 'failed', text: ko.model.failed };
  if (st === 'cold') return { cls: 'cold', text: ko.model.cold };
  if (st === 'not_loaded') return { cls: 'not-ready', text: ko.model.not_loaded };
  if (st === 'ready') {
    if (props.modelId === 'M5' && s.execDevice === 'cpu') return { cls: 'cpu', text: ko.model.cpu };
    return { cls: 'ready', text: s.load?.lastLoadSeconds != null ? `${ko.model.ready} · ${ko.ops.lastLoad(Math.round(s.load.lastLoadSeconds))}` : ko.model.ready };
  }
  return { cls: 'unknown', text: ko.model.unknown };
});
</script>

<template>
  <span class="mchip" :class="view.cls" :data-state="view.cls">
    {{ view.text }}<span v-if="view.bar != null" class="bar" :style="{ background: `linear-gradient(90deg,var(--color-block-mint) ${Math.round(view.bar * 100)}%,var(--color-hairline-soft) 0)` }" aria-hidden="true"></span>
  </span>
</template>

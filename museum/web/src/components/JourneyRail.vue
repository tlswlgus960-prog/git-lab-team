<script setup lang="ts">
// C1 진행 레일(T038, SD_02 §3-2). 기본 · 막힘(게이트 ID + 막힌 자리 보기) · 대기(닫아도 계속) · 전시 보류(C8 자리) · 종결(삭제 중).
// 레일 단계는 누를 수 없다. 작품 레일(상태 7단계)과 여정 레일(작품 없는 S1·S2)을 steps로 바꿔 쓴다.
import { computed, inject } from 'vue';
import { ko } from '@/copy/ko';

export type RailVariant = 'default' | 'blocked' | 'waiting' | 'hold' | 'final';
export interface RailStep { key: string; label: string }

// 보호자에게는 세 칸(D34 ④, SD_02 §17-8): 올리는 중 · 액자에 담는 중 · 걸었어요. 내부 상태는 그 칸으로 모은다.
const ARTWORK: RailStep[] = (['upload', 'frame', 'hung'] as const).map((k) => ({ key: k, label: ko.guardian.steps[k]! }));
const STEP_OF: Record<string, string> = { received: 'upload', judging: 'frame', awaiting_confirm: 'frame', processing: 'frame', awaiting_review: 'frame', approved: 'frame', exhibited: 'hung', failed: 'frame', not_delivered: 'frame' };

const props = withDefaults(defineProps<{ current: string; variant?: RailVariant; gate?: string | null; steps?: RailStep[]; blockedLabel?: string }>(), {
  variant: 'default', gate: null, steps: undefined, blockedLabel: undefined,
});
const inRoom = inject('inRoom', false); // D38: 방 안에서는 여정 탭을 보이지 않는다
const emit = defineEmits<{ showBlock: [] }>();
const list = computed(() => props.steps ?? ARTWORK);
/** 작품 레일이면 내부 상태를 세 칸 중 하나로 */
const cur = computed(() => (props.steps ? props.current : STEP_OF[props.current] ?? props.current));
const label = (s: RailStep) => {
  if (s.key !== cur.value) return s.label;
  if (props.variant === 'blocked' && props.blockedLabel) return props.blockedLabel;
  return s.label;
};
</script>

<template>
  <div v-if="!(inRoom && props.steps)" class="journey">
    <ol v-if="variant !== 'final'" class="rail" :aria-label="'진행'">
      <li
        v-for="s in list"
        :key="s.key"
        :class="{ 'is-now': s.key === cur && variant !== 'blocked', 'is-blocked': s.key === cur && variant === 'blocked' }"
        :aria-current="s.key === cur ? 'step' : undefined"
        :data-rail-gate="s.key === cur && gate ? gate : undefined"
      >
        {{ label(s) }}
      </li>
    </ol>
    <ol v-else class="rail" aria-label="진행">
      <li class="is-blocked" aria-current="step">{{ ko.guardian.chip.deleting }}</li>
    </ol>
    <p v-if="variant === 'blocked'" class="t-body-sm"><a href="#" @click.prevent="emit('showBlock')">{{ ko.rail.showBlock }}</a></p>
    <p v-else-if="variant === 'waiting'" class="t-body-sm">{{ ko.rail.leaveOk }}</p>
    <slot v-else-if="variant === 'hold'" name="hold" />
  </div>
</template>

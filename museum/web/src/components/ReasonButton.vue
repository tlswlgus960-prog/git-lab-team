<script setup lang="ts">
// C3 이유 달린 비활성 버튼(T038, SD_02 §3-3). disabled 대신 aria-disabled로 포커스를 받고,
// 라벨 뒤 "(비활성) - 사유"와 hover·포커스 말풍선(title)이 같은 문구다. 비활성일 때 누르면 blocked를 알린다.
// 이름은 한 줄(낱말 끊김 없음), 사유는 버튼 안 둘째 줄(SD_02 §3-3 C3 줄바꿈 — 좁은 폭에서 이름이 쪼개지지 않게).
import { computed, useId } from 'vue';
import { ko } from '@/copy/ko';

// type="submit"(SD_02 C3 폼 제출): 입력 칸 Enter가 이 버튼을 누른 것과 같다. 활성이면 폼 submit이 처리하고
// (부모는 @click 대신 form @submit을 쓴다), 비활성이면 preventDefault로 제출을 막고 blocked를 알린다.
const props = withDefaults(defineProps<{ label: string; disabled?: boolean; reason?: string; variant?: 'primary' | 'secondary'; type?: 'button' | 'submit' }>(), {
  disabled: false, reason: '', variant: 'primary', type: 'button',
});
const emit = defineEmits<{ click: [ev: MouseEvent]; blocked: [] }>();
const id = useId();
const why = computed(() => (props.disabled && props.reason ? `${ko.block.disabled} - ${props.reason}` : ''));
function onClick(ev: MouseEvent) {
  if (props.disabled) { ev.preventDefault(); emit('blocked'); return; }
  emit('click', ev);
}
</script>

<template>
  <button
    :type="type"
    class="btn"
    :class="[`btn-${variant}`, { 'has-why': !!why }]"
    :aria-disabled="disabled ? 'true' : undefined"
    :aria-describedby="why ? id : undefined"
    :title="why || undefined"
    @click="onClick"
  >
    <span class="lbl">{{ label }}</span><span v-if="why" :id="id" class="why">{{ why }}</span>
  </button>
</template>

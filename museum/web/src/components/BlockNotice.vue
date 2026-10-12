<script setup lang="ts">
// C2 차단 블록(T038, SD_02 §3-3·§16·§17). 사유·해제 주체·다음 행동 세 줄은 빠질 수 없다.
// 나타나면 제목으로 포커스를 옮기고 라이브 영역으로 알린다. 토스트·자동으로 사라지는 배너를 쓰지 않는다.
import { computed, getCurrentInstance, nextTick, onMounted, ref, watch } from 'vue';
import type { BlockNotice } from '@/api/client';
import { ko } from '@/copy/ko';

const props = defineProps<{ notice: BlockNotice }>();
const emit = defineEmits<{ action: [label: string] }>();
const head = ref<HTMLElement | null>(null);
/** G번호는 운영 화면에서만 글자로 보인다(D34 ④, SD_02 §17-8) — 보호자 화면은 data-gate에만 */
const inst = getCurrentInstance();
const staff = computed(() => { const r = inst?.proxy?.$route as { path?: string } | undefined; return !!r?.path?.startsWith('/ops'); });
const title = () => (props.notice.variant === 'hold' ? ko.block.holdTitle : props.notice.variant === 'final' ? ko.block.finalTitle : ko.block.blockTitle);
const focus = () => nextTick(() => head.value?.focus());
onMounted(focus);
watch(() => props.notice, focus);
</script>

<template>
  <section
    class="gblock"
    :class="`is-${notice.variant}`"
    :role="notice.variant === 'hold' ? 'status' : 'alert'"
    :data-gate="notice.gate ?? undefined"
  >
    <p ref="head" class="head" tabindex="-1">
      {{ title() }}<span v-if="notice.gate && staff" class="gate">{{ notice.gate }}</span>
      <template v-if="notice.variant !== 'final'"> - {{ notice.summary }}</template>
    </p>
    <dl>
      <dt>{{ ko.block.reasonLabel }}</dt><dd>{{ notice.reason }}</dd>
      <dt>{{ ko.block.releaserLabel }}</dt><dd>{{ notice.releaser }}</dd>
    </dl>
    <div v-if="notice.actions.length" class="acts" :aria-label="ko.block.actionsLabel">
      <button v-for="a in notice.actions" :key="a" class="btn btn-secondary" type="button" @click="emit('action', a)">{{ a }}</button>
    </div>
  </section>
</template>

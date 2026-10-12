<script setup lang="ts">
// 동물 친구 캐릭터(D40, SD_02 §17-13 A②) — 자체 제작 SVG 8종 × 색 6가지. 아이 얼굴·사진 아님.
// spinning이면 받침 위에서 천천히 좌우로 돌며 살짝 뛴다(움직임 줄이기면 멈춤). 마을 간판 · 미술관 동상에도 쓴다.
import { computed } from 'vue';
import { COLOR_NAME, KIND_NAME, type CharacterColor, type CharacterKind } from './names';
import { BEAK, INK, PALETTE, PINK } from './palette';
import { cc } from './copy';

const props = withDefaults(defineProps<{ kind: CharacterKind; color: CharacterColor; size?: number; spinning?: boolean }>(), {
  size: 120, spinning: false,
});
const t = computed(() => PALETTE[props.color]);
const label = computed(() => cc.avatarLabel(COLOR_NAME[props.color], KIND_NAME[props.kind]));
const k = computed(() => props.kind);
</script>

<template>
  <span class="av" :class="{ spin: spinning }" :style="{ width: `${size}px`, height: `${size}px` }" :data-kind="kind" :data-color="color">
    <svg role="img" :aria-label="label" viewBox="-4 -4 128 128" :width="size" :height="size" :style="{ '--ink': INK }">
      <title>{{ label }}</title>
      <ellipse cx="60" cy="118" rx="30" ry="3.5" fill="rgba(74,52,65,.14)" />
      <!-- 뒤에 오는 것: 꼬리 -->
      <g v-if="k === 'fox'">
        <ellipse class="o" cx="96" cy="92" rx="10" ry="22" transform="rotate(48 96 92)" :fill="t.body" />
        <ellipse cx="108" cy="80" rx="6" ry="8" transform="rotate(48 108 80)" :fill="t.belly" />
      </g>
      <path v-if="k === 'dino'" class="o" d="M80 104 Q108 110 118 88 Q104 96 82 92 Z" :fill="t.body" />

      <!-- 몸 -->
      <ellipse class="o" cx="60" cy="96" rx="28" ry="20" :fill="t.body" />
      <ellipse cx="60" cy="100" :rx="k === 'penguin' ? 20 : 17" :ry="k === 'penguin' ? 15 : 12" :fill="t.belly" />
      <template v-if="k === 'penguin'">
        <ellipse class="o" cx="31" cy="95" rx="6" ry="15" transform="rotate(22 31 95)" :fill="t.shade" />
        <ellipse class="o" cx="89" cy="95" rx="6" ry="15" transform="rotate(-22 89 95)" :fill="t.shade" />
        <ellipse class="o" cx="48" cy="115" rx="9" ry="4" :fill="BEAK" />
        <ellipse class="o" cx="72" cy="115" rx="9" ry="4" :fill="BEAK" />
      </template>
      <template v-else-if="k === 'owl'">
        <ellipse class="o" cx="33" cy="94" rx="8" ry="17" transform="rotate(14 33 94)" :fill="t.shade" />
        <ellipse class="o" cx="87" cy="94" rx="8" ry="17" transform="rotate(-14 87 94)" :fill="t.shade" />
        <path d="M54 96 l3 3 l3 -3 M60 96 l3 3 l3 -3 M57 102 l3 3 l3 -3" fill="none" :stroke="t.shade" stroke-width="1.8" stroke-linecap="round" />
        <ellipse class="o" cx="50" cy="115" rx="6" ry="3.5" :fill="BEAK" />
        <ellipse class="o" cx="70" cy="115" rx="6" ry="3.5" :fill="BEAK" />
      </template>
      <template v-else>
        <ellipse class="o" cx="46" cy="114" rx="8" ry="4" :fill="t.shade" />
        <ellipse class="o" cx="74" cy="114" rx="8" ry="4" :fill="t.shade" />
      </template>
      <template v-if="k === 'dino'">
        <circle cx="52" cy="98" r="2.5" :fill="t.shade" /><circle cx="66" cy="103" r="2" :fill="t.shade" />
      </template>

      <!-- 머리 뒤: 귀 · 뿔 · 깃 -->
      <template v-if="k === 'bear'">
        <circle class="o" cx="35" cy="32" r="12" :fill="t.body" /><circle cx="35" cy="32" r="6" :fill="t.belly" />
        <circle class="o" cx="85" cy="32" r="12" :fill="t.body" /><circle cx="85" cy="32" r="6" :fill="t.belly" />
      </template>
      <template v-else-if="k === 'rabbit'">
        <ellipse class="o" cx="47" cy="18" rx="8" ry="22" transform="rotate(-8 47 18)" :fill="t.body" />
        <ellipse cx="47" cy="20" rx="4" ry="15" transform="rotate(-8 47 20)" :fill="PINK" />
        <ellipse class="o" cx="73" cy="18" rx="8" ry="22" transform="rotate(8 73 18)" :fill="t.body" />
        <ellipse cx="73" cy="20" rx="4" ry="15" transform="rotate(8 73 20)" :fill="PINK" />
      </template>
      <template v-else-if="k === 'cat'">
        <polygon class="o" points="32,46 36,16 57,30" :fill="t.body" /><polygon points="37,39 39,23 50,31" :fill="PINK" />
        <polygon class="o" points="88,46 84,16 63,30" :fill="t.body" /><polygon points="83,39 81,23 70,31" :fill="PINK" />
      </template>
      <template v-else-if="k === 'fox'">
        <polygon class="o" points="30,48 32,10 56,30" :fill="t.body" /><polygon points="35,40 36,19 48,30" :fill="t.shade" />
        <polygon class="o" points="90,48 88,10 64,30" :fill="t.body" /><polygon points="85,40 84,19 72,30" :fill="t.shade" />
      </template>
      <template v-else-if="k === 'dino'">
        <polygon class="o" points="43,32 49,15 57,28" :fill="t.shade" />
        <polygon class="o" points="53,28 60,11 67,28" :fill="t.shade" />
        <polygon class="o" points="63,28 71,15 77,32" :fill="t.shade" />
      </template>
      <template v-else-if="k === 'owl'">
        <polygon class="o" points="34,38 28,12 52,28" :fill="t.body" />
        <polygon class="o" points="86,38 92,12 68,28" :fill="t.body" />
      </template>

      <!-- 머리 -->
      <circle class="o" cx="60" cy="56" r="30" :fill="t.body" />

      <!-- 얼굴 -->
      <template v-if="k === 'penguin'">
        <circle cx="50" cy="58" r="13" :fill="t.belly" /><circle cx="70" cy="58" r="13" :fill="t.belly" />
        <ellipse cx="60" cy="68" rx="16" ry="12" :fill="t.belly" />
      </template>
      <path v-if="k === 'fox'" d="M32 58 Q60 96 88 58 Q74 70 60 64 Q46 70 32 58 Z" :fill="t.belly" />
      <template v-if="k === 'owl'">
        <circle class="o" cx="47" cy="54" r="11" fill="#fff" /><circle class="o" cx="73" cy="54" r="11" fill="#fff" />
        <circle cx="47" cy="55" r="5.5" :fill="INK" /><circle cx="73" cy="55" r="5.5" :fill="INK" />
        <circle cx="49" cy="53" r="1.8" fill="#fff" /><circle cx="75" cy="53" r="1.8" fill="#fff" />
        <polygon class="o" points="55,64 65,64 60,72" :fill="BEAK" />
      </template>
      <template v-else>
        <circle cx="48" cy="54" r="4.3" :fill="INK" /><circle cx="72" cy="54" r="4.3" :fill="INK" />
        <circle cx="49.6" cy="52.4" r="1.5" fill="#fff" /><circle cx="73.6" cy="52.4" r="1.5" fill="#fff" />
        <ellipse cx="40" cy="64" rx="5" ry="3" fill="#FF8FA3" opacity=".55" />
        <ellipse cx="80" cy="64" rx="5" ry="3" fill="#FF8FA3" opacity=".55" />
      </template>

      <template v-if="k === 'bear'">
        <ellipse cx="60" cy="67" rx="11" ry="8" :fill="t.belly" />
        <ellipse cx="60" cy="63" rx="4" ry="3" :fill="INK" />
        <path d="M56 68 Q60 72 64 68" class="ln" />
      </template>
      <template v-else-if="k === 'rabbit'">
        <ellipse cx="60" cy="63" rx="3.2" ry="2.3" :fill="PINK" />
        <rect x="57" y="67" width="6" height="5" rx="1" fill="#fff" class="o thin" />
        <path d="M60 65 Q56 70 52 67 M60 65 Q64 70 68 67" class="ln" />
      </template>
      <template v-else-if="k === 'cat'">
        <polygon points="56.5,62 63.5,62 60,65.5" :fill="PINK" />
        <path d="M60 65 Q57 69 54 67 M60 65 Q63 69 66 67" class="ln" />
        <path d="M33 61 L47 63 M33 67 L47 66 M87 61 L73 63 M87 67 L73 66" class="ln thin" />
      </template>
      <template v-else-if="k === 'dog'">
        <ellipse cx="60" cy="67" rx="12" ry="9" :fill="t.belly" />
        <ellipse cx="60" cy="62.5" rx="5" ry="3.5" :fill="INK" />
        <path d="M57 71 Q60 79 63 71 Z" fill="#FF7C95" />
        <path d="M54 69 Q60 73 66 69" class="ln" />
        <ellipse class="o" cx="32" cy="52" rx="9" ry="19" transform="rotate(18 32 52)" :fill="t.shade" />
        <ellipse class="o" cx="88" cy="52" rx="9" ry="19" transform="rotate(-18 88 52)" :fill="t.shade" />
      </template>
      <template v-else-if="k === 'fox'">
        <circle cx="60" cy="68" r="3.5" :fill="INK" />
        <path d="M56 72 Q60 75 64 72" class="ln" />
      </template>
      <template v-else-if="k === 'penguin'">
        <polygon class="o" points="54,64 66,64 60,71" :fill="BEAK" />
      </template>
      <template v-else-if="k === 'dino'">
        <ellipse cx="60" cy="69" rx="14" ry="9" :fill="t.belly" />
        <circle cx="56" cy="66" r="1.6" :fill="INK" /><circle cx="64" cy="66" r="1.6" :fill="INK" />
        <path d="M52 72 Q60 77 68 72" class="ln" />
      </template>
    </svg>
  </span>
</template>

<style scoped>
.av{display:inline-block;line-height:0;flex:none;perspective:400px}
.av svg{display:block;overflow:visible}
.o{stroke:var(--ink);stroke-width:2;stroke-linejoin:round}
.o.thin,.ln.thin{stroke-width:1.2}
.ln{fill:none;stroke:var(--ink);stroke-width:1.8;stroke-linecap:round}
.spin svg{animation:av-turn 6s ease-in-out infinite;transform-origin:50% 90%}
@keyframes av-turn{
  0%{transform:rotateY(-28deg) translateY(0)}
  25%{transform:rotateY(0deg) translateY(-4%)}
  50%{transform:rotateY(28deg) translateY(0)}
  75%{transform:rotateY(0deg) translateY(-4%)}
  100%{transform:rotateY(-28deg) translateY(0)}
}
@media (prefers-reduced-motion:reduce){.spin svg{animation:none}}
</style>

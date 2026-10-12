<script setup lang="ts">
// 미술관 건물(D40, SD_02 §17-13 A③ · D) — 모양 8가지, 모양만 모티브(실제 이름·로고 없음, D33).
// 비스듬히 본 모양(아이소메트릭 느낌)이라 마을에도 그대로 놓인다. 문은 늘 보이고, 잠기면 문에 자물쇠.
// 속성 이름은 museumStyle(계약 필드와 같음) — 'style'은 Vue가 인라인 스타일로 바꿔 버려 쓰지 않는다.
// color = 문 색(그 가족 아이 캐릭터 색). open = 문이 열린 모양(개관식). decorative = 옆 글자가 이미 이름을 말할 때.
import { computed } from 'vue';
import { STYLE_NAME, type CharacterColor, type MuseumStyle } from './names';
import { INK, PALETTE } from './palette';
import { cc } from './copy';

const props = withDefaults(defineProps<{ museumStyle: MuseumStyle; color?: CharacterColor; size?: number; locked?: boolean; open?: boolean; decorative?: boolean }>(), {
  color: undefined, size: 160, locked: false, open: false, decorative: false,
});
const door = computed(() => (props.color ? PALETTE[props.color].body : '#B5835A'));
const label = computed(() => cc.buildingLabel(STYLE_NAME[props.museumStyle], props.locked));
const s = computed(() => props.museumStyle);
const bricks = [82, 90, 98, 106, 114, 122];
</script>

<template>
  <span class="mb" :style="{ width: `${size}px`, height: `${size * 150 / 160}px` }" :data-style="museumStyle" :data-locked="locked ? 'true' : undefined">
    <svg :role="decorative ? undefined : 'img'" :aria-label="decorative ? undefined : label" :aria-hidden="decorative ? 'true' : undefined"
      viewBox="0 0 160 150" :width="size" :height="size * 150 / 160" :style="{ '--ink': INK }">
      <title v-if="!decorative">{{ label }}</title>
      <!-- 땅(마름모 받침) -->
      <polygon points="80,148 158,122 80,96 2,122" fill="#CDEDC8" class="o thin" />
      <polygon points="80,148 158,122 158,126 80,152" fill="#A9D9A2" />

      <!-- 유리 피라미드 -->
      <g v-if="s === 'glass_pyramid'">
        <polygon class="o" points="118,128 140,117 70,48" fill="#8FCBE6" />
        <polygon class="o" points="22,128 118,128 70,48" fill="#C4E9F8" />
        <path d="M34 108 H106 M46 88 H94 M58 68 H82 M46 128 L70 48 L94 128 M34 128 L70 48 M106 128 L70 48" stroke="#fff" stroke-width="1.6" fill="none" />
        <path d="M118 128 L140 117 M129 122 L70 48" stroke="#E6F6FD" stroke-width="1.2" fill="none" />
      </g>

      <!-- 하얀 나선 탑(위로 갈수록 넓은 띠) -->
      <g v-else-if="s === 'white_spiral'">
        <polygon class="o" points="102,128 116,121 116,95 102,102" fill="#DDE3EC" />
        <rect class="o" x="38" y="102" width="64" height="26" rx="8" fill="#fff" />
        <polygon class="o" points="108,102 124,94 124,72 108,80" fill="#DDE3EC" />
        <rect class="o" x="32" y="80" width="76" height="22" rx="8" fill="#fff" />
        <rect x="38" y="94" width="64" height="3" rx="1.5" fill="#CFE3F2" />
        <polygon class="o" points="114,80 132,71 132,47 114,56" fill="#DDE3EC" />
        <rect class="o" x="26" y="56" width="88" height="24" rx="9" fill="#fff" />
        <rect x="32" y="71" width="76" height="3" rx="1.5" fill="#CFE3F2" />
        <ellipse class="o" cx="72" cy="55" rx="16" ry="6" fill="#CFE8F7" />
      </g>

      <!-- 기둥 신전 -->
      <g v-else-if="s === 'column_temple'">
        <polygon class="o" points="104,116 126,105 126,61 104,72" fill="#EAD9B5" />
        <rect class="o" x="36" y="72" width="68" height="44" fill="#FFF3DA" />
        <rect v-for="x in [32, 45, 88, 101]" :key="x" class="o" :x="x" y="76" width="7" height="40" fill="#FFFBF2" />
        <rect class="o" x="28" y="68" width="84" height="8" fill="#FFF3DA" />
        <polygon class="o" points="112,68 70,44 92,33 134,57" fill="#E6CFA0" />
        <polygon class="o" points="26,68 70,44 114,68" fill="#FFF3DA" />
        <circle cx="70" cy="59" r="4" :fill="door" class="o thin" />
        <polygon class="o" points="116,122 138,111 138,105 116,116" fill="#E6D6B4" />
        <rect class="o" x="24" y="116" width="92" height="6" fill="#F7EAD0" />
        <polygon class="o" points="120,128 142,117 142,111 120,122" fill="#E6D6B4" />
        <rect class="o" x="20" y="122" width="100" height="6" fill="#F7EAD0" />
      </g>

      <!-- 시계탑 기차역 -->
      <g v-else-if="s === 'clock_station'">
        <polygon class="o" points="122,128 140,119 140,75 122,84" fill="#E4BD86" />
        <rect class="o" x="18" y="84" width="104" height="44" fill="#F6D9A8" />
        <rect class="o" x="16" y="78" width="108" height="8" fill="#C98A5B" />
        <path class="o" d="M26 112 V98 a8 8 0 0 1 16 0 V112 Z" fill="#BFE3F5" />
        <path class="o" d="M98 112 V98 a8 8 0 0 1 16 0 V112 Z" fill="#BFE3F5" />
        <polygon class="o" points="48,84 56,80 56,34 48,38" fill="#E4BD86" />
        <rect class="o" x="24" y="38" width="24" height="46" fill="#F6D9A8" />
        <polygon class="o" points="22,38 36,22 50,38" fill="#C98A5B" />
        <circle class="o" cx="36" cy="54" r="8" fill="#fff" />
        <path d="M36 54 V49 M36 54 H40" stroke="var(--ink)" stroke-width="1.6" stroke-linecap="round" />
      </g>

      <!-- 붉은 벽돌 굴뚝 -->
      <g v-else-if="s === 'brick_chimney'">
        <polygon class="o" points="118,128 140,117 140,63 118,74" fill="#A1402D" />
        <rect class="o" x="22" y="74" width="96" height="54" fill="#C8553D" />
        <path v-for="y in bricks" :key="y" :d="`M22 ${y} H118`" stroke="#E07A5F" stroke-width="1" opacity=".7" />
        <rect v-for="x in [30, 42, 92, 104]" :key="x" class="o thin" :x="x" y="84" width="7" height="30" fill="#FFE8B0" />
        <polygon class="o" points="78,74 86,70 86,16 78,20" fill="#963A28" />
        <rect class="o" x="62" y="20" width="16" height="54" fill="#B84A33" />
        <rect class="o" x="60" y="15" width="20" height="6" fill="#8E3526" />
      </g>

      <!-- 황금 돔 궁전 -->
      <g v-else-if="s === 'golden_dome'">
        <polygon class="o" points="114,128 136,117 136,71 114,82" fill="#EBDDBD" />
        <rect class="o" x="26" y="82" width="88" height="46" fill="#FFF5E1" />
        <path v-for="x in [34, 48, 88, 102]" :key="x" class="o thin" :d="`M${x} 114 V100 a4 4 0 0 1 8 0 V114 Z`" fill="#BFE3F5" />
        <rect class="o" x="46" y="66" width="48" height="16" fill="#FFF5E1" />
        <path class="o" d="M42 66 A28 28 0 0 1 98 66 Z" fill="#F6C343" />
        <path d="M52 60 A18 18 0 0 1 66 44" stroke="#FFE9A6" stroke-width="3" fill="none" stroke-linecap="round" />
        <path d="M70 38 V28" stroke="var(--ink)" stroke-width="2" />
        <circle class="o" cx="70" cy="26" r="3.5" fill="#F6C343" />
      </g>

      <!-- 기와 한옥 -->
      <g v-else-if="s === 'hanok_roof'">
        <rect class="o" x="26" y="124" width="88" height="6" fill="#CFC6B8" />
        <polygon class="o" points="108,128 128,118 128,84 108,94" fill="#E9DCC5" />
        <rect class="o" x="32" y="94" width="76" height="34" fill="#FFF8EC" />
        <rect v-for="x in [32, 50, 86, 104]" :key="x" :x="x" y="94" width="4" height="34" fill="#8B5A3C" />
        <g v-for="x in [37, 90]" :key="`w${x}`">
          <rect class="o thin" :x="x" y="100" width="12" height="18" fill="#FFFDF6" />
          <path :d="`M${x + 6} 100 V118 M${x} 106 H${x + 12} M${x} 112 H${x + 12}`" stroke="#8B5A3C" stroke-width="1" />
        </g>
        <polygon class="o" points="96,64 112,57 132,80 116,88" fill="#4A5866" />
        <path class="o" d="M12 92 Q24 97 34 88 L50 68 H90 L106 88 Q116 97 128 92 Q121 86 113 84 L96 62 H44 L27 84 Q19 86 12 92 Z" fill="#5B6B7C" />
        <path d="M46 70 L38 86 M58 68 L54 88 M70 68 V88 M82 68 L86 88 M94 70 L102 86" stroke="#7D8C9B" stroke-width="1.4" />
        <rect class="o" x="42" y="59" width="56" height="5" rx="2" fill="#3E4A57" />
      </g>

      <!-- 은빛 물결 지붕 -->
      <g v-else-if="s === 'silver_wave'">
        <polygon class="o" points="116,128 136,118 136,88 116,98" fill="#B7C3D0" />
        <rect class="o" x="24" y="96" width="92" height="32" fill="#E3E9F0" />
        <rect class="o thin" x="28" y="104" width="26" height="12" fill="#BFE3F5" />
        <rect class="o thin" x="86" y="104" width="26" height="12" fill="#BFE3F5" />
        <path class="o" d="M20 98 C28 58 48 88 56 60 C64 36 84 68 92 48 C100 30 120 62 126 98 Z" fill="#C9D3DE" />
        <path class="o" d="M40 98 C48 74 62 86 70 70 C78 58 96 80 106 98 Z" fill="#EEF2F7" />
        <path d="M30 80 C36 68 44 80 50 66 M86 58 C92 46 102 52 108 62" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" />
      </g>

      <!-- 문(모든 모양 같은 자리) -->
      <g class="door" :class="{ open }">
        <path d="M61 128 V112 a9 9 0 0 1 18 0 V128 Z" fill="#4A3441" />
        <path class="leaf l o" d="M61 128 V112 a9 9 0 0 1 9 -9 V128 Z" :fill="door" />
        <path class="leaf r o" d="M79 128 V112 a9 9 0 0 0 -9 -9 V128 Z" :fill="door" />
        <circle v-if="!open" cx="67.5" cy="118" r="1.1" fill="var(--ink)" /><circle v-if="!open" cx="72.5" cy="118" r="1.1" fill="var(--ink)" />
      </g>
      <g v-if="locked" class="lock" data-lock="true">
        <path d="M66.5 116 V112.5 a3.5 3.5 0 0 1 7 0 V116" fill="none" stroke="#7A5A1A" stroke-width="2" />
        <rect class="o thin" x="64" y="115" width="12" height="9" rx="2" fill="#F2C94C" />
        <circle cx="70" cy="119" r="1.3" fill="var(--ink)" />
      </g>
    </svg>
  </span>
</template>

<style scoped>
.mb{display:inline-block;line-height:0;flex:none}
.mb svg{display:block;overflow:visible}
.o{stroke:var(--ink);stroke-width:1.6;stroke-linejoin:round}
.o.thin{stroke-width:1}
.leaf{transform-box:fill-box;transition:transform .9s cubic-bezier(.3,.7,.2,1)}
.leaf.l{transform-origin:left center}
.leaf.r{transform-origin:right center}
.door.open .leaf{transform:scaleX(.18)}
@media (prefers-reduced-motion:reduce){.leaf{transition:none}}
</style>

<script setup lang="ts">
// 미술관 셸(D34 ④ · 고객 요구 §7 C②, SD_02 §17-8): 미술관 화면에서는 메뉴 줄 · 계정 · 로그아웃을 [메뉴] 버튼 하나로 접고,
// 지름길 [올리기] · [목록]은 늘 보인다. 메뉴 판은 Esc · 바깥 누름 · [닫기]로 닫히고 초점은 [메뉴]로 돌아온다.
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { RouterLink, useRoute } from 'vue-router';
import { ko } from '@/copy/ko';
import type { MenuItem } from './RoleHeader.vue';
import MusicButton from '@/app/sound/MusicButton.vue';
import { track } from '@/app/sound/bgm';
import { sc } from '@/app/sound/copy';
// D42(SD_02 §17-15 B): 지름길 옆 [음악] — 누를 때만 재생. CC BY 곡이면 메뉴 판 아래에 출처 한 줄
// D47(§17-16): [메뉴]와 메뉴 판은 오른쪽 위에 고정(position: fixed) — 스크롤 · 화면 전환 · 지름길 개수와 무관하게 같은 자리

defineProps<{ account?: string; menu: MenuItem[] }>();
const emit = defineEmits<{ logout: [] }>();
const route = useRoute();
const open = ref(false);
const btn = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
async function show() { open.value = true; await nextTick(); panel.value?.querySelector<HTMLElement>('a, button')?.focus(); }
async function hide() { open.value = false; await nextTick(); btn.value?.focus(); }
function onKey(e: KeyboardEvent) { if (open.value && e.key === 'Escape') { e.preventDefault(); void hide(); } }
watch(() => route.fullPath, () => { open.value = false; });
onMounted(() => window.addEventListener('keydown', onKey));
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <header class="mbar" data-shell="app">
    <!-- D47: 홈 버튼 — 1명이면 그 미술관 로비, 여럿이면 고르기(?pick=1). 입장 화면은 거치지 않는다 -->
    <RouterLink class="mbar-mark" :to="{ path: '/app', query: { pick: '1' } }" :aria-label="`${ko.shell.appName} - 홈으로`">{{ ko.shell.appName }}</RouterLink>
    <nav class="mbar-quick" :aria-label="ko.shell.quick">
      <RouterLink class="mbar-pill" to="/app/upload" :aria-label="ko.shell.quickUpload"><span class="full">{{ ko.shell.quickUpload }}</span><span class="short" aria-hidden="true">{{ ko.shell.quickUploadShort }}</span></RouterLink>
      <RouterLink class="mbar-pill" :to="{ path: '/app/list', query: route.query.child ? { child: route.query.child } : {} }" :aria-label="ko.shell.quickList"><span class="full">{{ ko.shell.quickList }}</span><span class="short" aria-hidden="true">{{ ko.shell.quickListShort }}</span></RouterLink>
      <MusicButton />
      <button ref="btn" class="mbar-pill mbar-menu" type="button" :aria-expanded="open" aria-controls="mbar-panel" @click="open ? hide() : show()">
        <span aria-hidden="true">☰</span> {{ ko.shell.menuOpen }}
      </button>
    </nav>
    <div v-if="open" class="mbar-scrim" @click="hide"></div>
    <div v-if="open" id="mbar-panel" ref="panel" class="mbar-panel" role="dialog" :aria-label="ko.shell.menuOpen">
      <nav :aria-label="'보호자 메뉴'">
        <RouterLink v-for="m in menu" :key="m.to" :to="m.to" class="mbar-link">{{ m.label }}</RouterLink>
        <RouterLink v-if="account" to="/app/account" class="mbar-link">{{ ko.auth.myAccount }} - {{ account }}</RouterLink>
      </nav>
      <div class="mbar-foot">
        <button class="btn btn-secondary" type="button" @click="emit('logout')">{{ ko.auth.logout }}</button>
        <button class="btn btn-tertiary" type="button" @click="hide">{{ ko.walk.close }}</button>
      </div>
      <p v-if="track && /^CC BY/.test(track.license)" class="mbar-credit">
        <a :href="track.source" target="_blank" rel="noopener">{{ sc.credit(track.title, track.performer, track.license) }}</a>
      </p>
    </div>
  </header>
</template>

<style scoped>
.mbar{position:relative;z-index:40;display:flex;align-items:center;justify-content:space-between;gap:8px;padding:8px clamp(12px,2.5vw,32px);background:#fbf4e6;border-bottom:2px solid #c9a24a;box-shadow:0 1px 0 #fffaf0 inset,0 2px 8px rgba(74,52,65,.08)} /* D53 게임 틀 — 크림 양피지 + 금테 */
.mbar-mark{font:700 20px/1 var(--mc-serif,'Noto Serif KR',serif);color:var(--color-primary);text-decoration:none;white-space:nowrap;letter-spacing:-.01em}
.mbar-quick{display:flex;gap:6px;align-items:center}
.mbar-pill{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:8px 14px;border:1.5px solid #c9a24a;border-radius:var(--r-pill);background:#fffaf0;box-shadow:0 3px 0 #d9c28a;transition:transform .08s,box-shadow .08s;
  color:var(--color-ink);font:600 14px/1 var(--font-sans);text-decoration:none;cursor:pointer;white-space:nowrap}
.mbar-pill:hover{background:#fff4dc}
.mbar-pill:active{transform:translateY(3px);box-shadow:0 0 0 #d9c28a}
@media (prefers-reduced-motion:reduce){.mbar-pill{transition:none}.mbar-pill:active{transform:none}}
.mbar-menu{background:var(--color-primary);color:var(--color-on-primary);border-color:var(--color-primary);
  position:fixed;top:8px;right:clamp(12px,2.5vw,32px);z-index:44;box-shadow:0 2px 8px rgba(74,52,65,.18)}
.mbar-quick{padding-right:104px} /* 고정된 [메뉴] 자리 */
.mbar-scrim{position:fixed;inset:0;background:rgba(44,34,56,.28);z-index:41}
.mbar-panel{position:fixed;right:clamp(12px,2.5vw,32px);top:60px;max-height:calc(100dvh - 72px);overflow:auto;z-index:42;width:min(320px,calc(100vw - 24px));background:var(--color-canvas);
  border:1px solid var(--color-hairline);border-radius:var(--r-lg);box-shadow:var(--elev-3);padding:var(--s-sm);display:grid;gap:var(--s-sm)}
.mbar-panel nav{display:grid}
.mbar-link{display:block;padding:12px 12px;border-radius:var(--r-md);color:var(--color-ink);font:500 16px/1.3 var(--font-sans);text-decoration:none}
.mbar-link:hover,.mbar-link:focus-visible{background:var(--color-surface-soft)}
.mbar-foot{display:flex;gap:8px;justify-content:space-between;border-top:1px solid var(--color-hairline);padding-top:var(--s-sm)}
.mbar-pill .short{display:none}
.mbar-credit{margin:0;font:400 12px/1.4 var(--font-sans)}
.mbar-credit a{color:var(--color-ink)}
.mbar-mark:hover{text-decoration:underline;text-underline-offset:4px}
@media (max-width:420px){.mbar-quick{padding-right:86px}.mbar-mark{font-size:16px}.mbar-pill{padding:8px 10px;font-size:13px}.mbar-pill .full{display:none}.mbar-pill .short{display:inline}}
</style>

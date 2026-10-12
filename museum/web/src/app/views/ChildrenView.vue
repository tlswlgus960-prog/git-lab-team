<script setup lang="ts">
// S1 아이 관리(T054, SD_02 §4, UC1, G4·G3, D18·D22). 별칭 하나만 받는다(앞뒤 공백 뺀 1~20자, 남은 글자 수 표시).
// 같은 별칭은 막지 않고 저장 뒤 안내(A5)만 보인다. 실명·생년월일 칸은 두지 않는다(BR-CHD-01).
// 아이 삭제(S9 대화상자, UC7 A1)는 표의 조작 칸에서 연다(T101).
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import BlockNotice from '@/components/BlockNotice.vue';
import JourneyRail from '@/components/JourneyRail.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko, problemCopy } from '@/copy/ko';
import NoticeBlock from '../components/NoticeBlock.vue';
import { JOURNEY_FROM_CHILD } from '../authForm';
import DeleteDialog from '../components/DeleteDialog.vue';
import CharacterAvatar from '@/app/character/CharacterAvatar.vue';
import { DEFAULT_COLOR, DEFAULT_KIND, isColor, isKind } from '@/app/character/names';
import { home as hc } from '@/app/town/copy';

type Child = components['schemas']['Child'];
const MAX = 20;

const route = useRoute();
const verified = route.query.verified === '1';
const welcome = route.query.welcome === '1'; // 카카오 첫 로그인(D36, SD_02 §17-7)
const children = ref<Child[] | null>(null);
const loadBlock = ref<Notice | null>(null);
const alias = ref('');
const editing = ref<Child | null>(null);
const busy = ref(false);
const block = ref<Notice | null>(null);
const dup = ref<Child | null>(null);
const aliasEl = ref<HTMLInputElement | null>(null);
const removing = ref<Child | null>(null);

const trimmed = computed(() => alias.value.trim());
const left = computed(() => MAX - [...trimmed.value].length);
// 화면 검사 문구는 G4 사유 문구와 같다(C_화면문구 §3 G4)
const aliasErr = computed(() => (!trimmed.value ? problemCopy({ gate: 'G4', reason: 'alias_blank' }).reason
  : left.value < 0 ? problemCopy({ gate: 'G4', reason: 'alias_too_long' }).reason : ''));

async function load() {
  try { children.value = await api.get<Child[]>('/v1/children'); loadBlock.value = null; }
  catch (e) { loadBlock.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null)); }
}
onMounted(load);

function focusAlias() { void nextTick(() => { aliasEl.value?.focus(); aliasEl.value?.select(); }); }

function startEdit(c: Child) { editing.value = c; alias.value = c.alias; block.value = null; dup.value = null; focusAlias(); }
function cancelEdit() { editing.value = null; alias.value = ''; block.value = null; }

async function save() {
  if (aliasErr.value || busy.value) return;
  busy.value = true; block.value = null; dup.value = null;
  try {
    const body = { alias: trimmed.value };
    const saved = editing.value
      ? await api.patch<Child>(`/v1/children/${editing.value.id}`, { body })
      : await api.post<Child>('/v1/children', { body });
    editing.value = null; alias.value = '';
    await load();
    if (saved.aliasDuplicate) dup.value = saved;
  } catch (e) {
    block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null));
  } finally { busy.value = false; }
}

function onBlockAction(label: string) {
  if (label === ko.child.edit) focusAlias();
  else void save(); // "다시 저장"(G3)
}
function keepDup() { dup.value = null; }
function fixDup() { if (dup.value) startEdit(dup.value); }
</script>

<template>
  <main class="container page stack">
    <JourneyRail current="child" :steps="JOURNEY_FROM_CHILD" />
    <NoticeBlock v-if="verified" :title="ko.auth.verified" />
    <NoticeBlock v-if="welcome" :title="ko.kakao.welcome"><p>{{ ko.kakao.welcomeHint }}</p></NoticeBlock>
    <BlockNotice v-if="loadBlock" :notice="loadBlock" @action="load" />

    <section class="stack" aria-labelledby="ch-list">
      <h1 id="ch-list" class="t-headline">{{ children ? ko.child.count(children.length) : ko.child.title }}</h1>
      <p v-if="children && !children.length" class="t-body-sm">{{ ko.child.empty }}</p>
      <div v-else-if="children" class="table-wrap" tabindex="0" role="region" :aria-label="ko.child.title">
        <table class="plain">
          <thead><tr><th>{{ ko.child.colAlias }}</th><th>{{ ko.child.colArtworks }}</th><th>{{ ko.child.colActions }}</th></tr></thead>
          <tbody>
            <tr v-for="c in children" :key="c.id">
              <td class="alias"><CharacterAvatar class="ch-av" :kind="isKind(c.character) ? c.character : DEFAULT_KIND" :color="isColor(c.color) ? c.color : DEFAULT_COLOR" :size="36" />{{ c.alias }}</td>
              <td class="num">{{ c.artworkCount ?? 0 }}</td>
              <td class="row-acts">
                <button class="btn btn-secondary btn-sm" type="button" @click="startEdit(c)">{{ ko.child.edit }}</button>
                <RouterLink class="btn btn-secondary btn-sm" :to="`/app/children/new?edit=${c.id}`">{{ hc.changeLook }}</RouterLink>
                <button class="btn btn-secondary btn-sm" type="button" @click="removing = c">{{ ko.child.remove }}</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <DeleteDialog v-if="removing" kind="child" :id="removing.id" :alias="removing.alias" :count="removing.artworkCount ?? 0"
      @close="removing = null" @done="load" />

    <NoticeBlock v-if="dup" :title="`${ko.child.dupTitle} - ${ko.child.dupSaved}`">
      <p>{{ ko.child.dup(dup.alias) }}</p>
      <p>{{ ko.child.dupWhy }}</p>
      <template #actions>
        <button class="btn btn-secondary" type="button" @click="keepDup">{{ ko.child.keep }}</button>
        <button class="btn btn-secondary" type="button" @click="fixDup">{{ ko.child.edit }}</button>
      </template>
    </NoticeBlock>

    <section class="card stack-sm make" aria-labelledby="ch-make">
      <p id="ch-make" class="t-body-sm">{{ hc.makeCharacterHint }}</p>
      <div><RouterLink class="btn btn-primary" to="/app/children/new">{{ hc.makeCharacter }}</RouterLink></div>
    </section>

    <form class="card stack child-form" novalidate @submit.prevent="save">
      <h2 class="t-card-title">{{ editing ? ko.child.edit : ko.child.addTitle }}</h2>
      <div class="field">
        <label for="ch-alias">{{ ko.child.alias }}</label>
        <input id="ch-alias" ref="aliasEl" v-model="alias" class="input" :class="{ 'is-error': left < 0 }" autocomplete="off"
          :aria-invalid="left < 0 ? 'true' : undefined" aria-describedby="ch-alias-h ch-alias-n">
        <p id="ch-alias-h" class="hint">{{ ko.child.aliasHint }}</p>
        <p id="ch-alias-n" class="hint num" aria-live="polite">{{ ko.child.remaining(Math.max(left, 0)) }}<template v-if="left < 0"> - {{ aliasErr }}</template></p>
      </div>
      <p class="t-body-sm">{{ ko.child.notCollected }}</p>
      <BlockNotice v-if="block" :notice="block" @action="onBlockAction" />
      <div class="acts">
        <ReasonButton :label="ko.child.save" :disabled="!!aliasErr || busy" :reason="aliasErr" @click="save" @blocked="focusAlias" />
        <button v-if="editing" class="btn btn-secondary" type="button" @click="cancelEdit">{{ ko.child.cancel }}</button>
      </div>
    </form>

    <div>
      <RouterLink v-if="children?.length" class="btn btn-secondary" to="/app/upload">{{ ko.child.toUpload }}</RouterLink>
      <ReasonButton v-else :label="ko.child.toUpload" disabled :reason="ko.child.needChild" variant="secondary" @blocked="focusAlias" />
    </div>
  </main>
</template>

<style scoped>
.child-form{max-width:560px}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
.table-wrap{overflow-x:auto}
/* 스타일가이드 table.plain 규칙(견본 표) — 공용 CSS에 없어 이 화면에 둔다 */
table.plain{width:100%;border-collapse:collapse;font:330 16px/1.45 var(--font-sans)}
table.plain th,table.plain td{text-align:left;padding:var(--s-sm) var(--s-sm) var(--s-sm) 0;border-bottom:1px solid var(--color-hairline-soft);vertical-align:middle}
table.plain th{font:400 12px/1 var(--font-mono);letter-spacing:.6px;text-transform:uppercase}
.alias{font-weight:540}
.num{font-variant-numeric:tabular-nums}
.btn-sm{min-height:44px;font-size:16px;padding:6px 14px}
.row-acts{display:flex;flex-wrap:wrap;gap:var(--s-xs)}
.ch-av{vertical-align:middle;margin-right:6px}
.make{max-width:560px;display:grid;gap:var(--s-sm)}
</style>

<script setup lang="ts">
// S7 설명 초안 받기(T129, P0.5, SD_02 §10·§10-5, UC10, BR-CAP-01~07, G13~G16, D6). S6 이야기 화면 아래 확장 패널.
// - 패널 표시는 GET /v1/captions/model-status가 응답할 때만(P0 CAPTION_ENABLED=false면 404 → 패널 없음).
// - 보낼 입력 미리보기는 저장된 이야기 값(서버가 저장된 값으로 다시 조립한다). 사진·아이 이름은 보내지 않는다.
// - 한마디와 AI 문장은 다른 칸(UX5). AI 초안은 "AI 작성", 직접 쓴 설명은 표시 없음(D6).
// - 30초 호출자 상한은 화면 타이머 — 넘기면 G15 선택지를 먼저 보이고, 늦게 온 초안은 받아 둔다.
// - 세션 만료(D22): 입력을 이 기기 브라우저에만 임시 저장 → 다시 열면 "저장하지 못한 입력이 있어요"(T095와 같은 규칙).
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { api, ApiError, toBlock, type BlockNotice as Notice, type Problem } from '@/api/client';
import type { components } from '@/api/types.gen';
import BlockNotice from '@/components/BlockNotice.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import { ko } from '@/copy/ko';
import NoticeBlock from '../components/NoticeBlock.vue';
import type { ArtworkDetail } from '../artwork';

type Caption = components['schemas']['Caption'];
interface ModelStatus { warming: boolean; maxWaitSeconds: number | null; busy: boolean }
interface Draft { keywords: string; tags: string[]; direct: string | null; edit: string }

const props = defineProps<{ artwork: ArtworkDetail }>();
const LIMIT_MS = 30_000;
const id = String(props.artwork.id);
const base = `/v1/artworks/${encodeURIComponent(id)}/captions`;
const DRAFT = `uam.captionDraft.${id}`;

const enabled = ref(false);
const status = ref<ModelStatus | null>(null);
const caption = ref<Caption | null>(props.artwork.caption ?? null);
const tagCandidates = computed(() => props.artwork.tagCandidates ?? []);
const keywords = ref('');
const tags = ref<string[]>([]);
const direct = ref<string | null>(null); // null = 직접 쓰기 칸 닫힘
const edit = ref(caption.value?.body ?? '');
const writing = ref(false);
const elapsed = ref(0);
const overLimit = ref(false);
const asked = ref(false); // 초안 만들기로 요청했는가 — template으로 오면 G16
const g16 = ref(false);
const busy = ref(false);
const block = ref<Notice | null>(null);
const approvedNow = ref(false);
const draft = ref<Draft | null>(null);
let timer: ReturnType<typeof setInterval> | null = null;

const kwList = computed(() => [...new Set(keywords.value.split(/[,，]/).map((k) => k.trim()).filter(Boolean))]);
const kwBad = computed(() => kwList.value.length > 5 || kwList.value.some((k) => [...k].length > 20));
const locked = computed(() => caption.value?.state === 'approved');
const pending = computed(() => caption.value?.state === 'pending_approval' ? caption.value : null);
const story = computed(() => props.artwork.story ?? {});
const makeWhy = computed(() => (writing.value ? ko.caption.writingNow : kwBad.value ? ko.caption.keywordsHint
  : !kwList.value.length && !tags.value.length ? ko.caption.needKeywords : busy.value ? ko.upload.sending : ''));
const approveWhy = computed(() => (!pending.value?.body ? ko.caption.needDraft : writing.value ? ko.caption.writingNow : busy.value ? ko.upload.sending : ''));
const directWhy = computed(() => (!direct.value?.trim() ? ko.caption.needBody : busy.value ? ko.upload.sending : ''));
const edited = computed(() => !!pending.value && edit.value !== (pending.value.body ?? '') && !!edit.value.trim());

onMounted(async () => {
  try { status.value = await api.get<ModelStatus>('/v1/captions/model-status'); enabled.value = true; } catch { enabled.value = false; return; }
  try { const v = localStorage.getItem(DRAFT); draft.value = v ? JSON.parse(v) as Draft : null; } catch { draft.value = null; }
});
onBeforeUnmount(stopTimer);

function stopTimer() { if (timer) clearInterval(timer); timer = null; }
const clearDraft = () => { try { localStorage.removeItem(DRAFT); } catch { /* 저장소 없음 */ } };
function keep() { try { localStorage.setItem(DRAFT, JSON.stringify({ keywords: keywords.value, tags: tags.value, direct: direct.value, edit: edit.value })); } catch { /* 저장소 없음 */ } }
function useDraft() { const d = draft.value; if (d) { keywords.value = d.keywords; tags.value = d.tags; direct.value = d.direct; edit.value = d.edit; } draft.value = null; clearDraft(); }
function dropDraft() { draft.value = null; clearDraft(); }

function got(c: Caption) {
  caption.value = c; edit.value = c.body ?? ''; clearDraft();
  g16.value = asked.value && c.source === 'template';
  if (c.state === 'approved') approvedNow.value = true;
}
function fail(e: unknown) {
  const err = e instanceof ApiError ? e : new ApiError(0, null);
  if (err.status === 401) { keep(); return; }
  block.value = toBlock(err);
}

/** 초안 만들기·다시 만들기·기본 문장으로 받기·직접 쓴 설명 저장 */
async function post(fallback?: 'template' | 'direct') {
  block.value = null; overLimit.value = false; g16.value = false;
  const llm = !fallback;
  asked.value = llm;
  const body = { keywords: kwList.value, selectedTags: tags.value, ...(fallback ? { fallback } : {}), ...(fallback === 'direct' ? { body: direct.value } : {}) };
  if (llm) {
    writing.value = true; elapsed.value = 0;
    timer = setInterval(() => { elapsed.value += 1; if (elapsed.value * 1000 >= LIMIT_MS && !overLimit.value) { overLimit.value = true; block.value = toBlock(new ApiError(503, { type: 'about:blank', title: 'llm_unavailable', status: 503, code: 'llm_unavailable', gate: 'G15' } as Problem)); } }, 1000);
  } else busy.value = true;
  try {
    got(await api.post<Caption>(base, { body }));
    if (fallback === 'direct') direct.value = null;
    if (overLimit.value) block.value = null; // 늦게 온 초안은 받는다
  } catch (e) { fail(e); } finally { writing.value = false; busy.value = false; overLimit.value = false; stopTimer(); }
}

async function put(action: 'edit' | 'approve' | 'discard') {
  const c = pending.value;
  if (!c) return;
  block.value = null; busy.value = true;
  try {
    const r = await api.put<Caption>(`${base}/${encodeURIComponent(c.id)}`, { body: { action, ...(action === 'edit' ? { body: edit.value } : {}) } });
    if (action === 'discard') { caption.value = null; edit.value = ''; g16.value = false; } else got(r);
  } catch (e) { fail(e); } finally { busy.value = false; }
}

async function toDirect() {
  const prev = pending.value?.body ?? '';
  if (pending.value) await put('discard');
  if (!block.value) direct.value = prev; // 초안 문장을 고쳐 쓸 수 있게 옮겨 둔다(출처는 direct)
}

async function onBlock(label: string) {
  if (label === ko.caption.template) await post('template');
  else if (label === ko.caption.writeDirect) { block.value = null; direct.value = ''; }
  else if (label === ko.caption.later) block.value = null;
  else if (label === '새로 불러오기') { block.value = null; try { caption.value = (await api.get<ArtworkDetail>(`/v1/artworks/${encodeURIComponent(id)}`)).caption ?? null; edit.value = caption.value?.body ?? ''; } catch (e) { fail(e); } }
  else document.getElementById(direct.value !== null ? 'cp-direct' : 'cp-kw')?.focus();
}
function toggleTag(t: string) { tags.value = tags.value.includes(t) ? tags.value.filter((x) => x !== t) : [...tags.value, t].slice(0, 5); }
</script>

<template>
  <section v-if="enabled" class="card stack caption-panel" aria-labelledby="cp-title">
    <h2 id="cp-title" class="t-title">{{ ko.caption.title }}</h2>
    <p class="t-body-sm muted">{{ ko.caption.notGate }} · {{ ko.caption.withExhibit }}</p>
    <NoticeBlock v-if="draft" :title="ko.fail.draftRestored">
      <template #actions>
        <button class="btn btn-secondary" type="button" @click="useDraft">{{ ko.fail.draftFill }}</button>
        <button class="btn btn-secondary" type="button" @click="dropDraft">{{ ko.fail.draftDiscard }}</button>
      </template>
    </NoticeBlock>

    <!-- 고정: 승인한 설명(재생성 불가, E3) -->
    <template v-if="locked && caption">
      <p v-if="approvedNow" class="downgrade t-body" role="status">{{ artwork.state === 'exhibited' ? ko.caption.approvedExhibited : ko.caption.withExhibit }}</p>
      <div class="tile stack-sm">
        <p class="t-eyebrow">{{ ko.caption.locked }} <span v-if="caption.aiAuthored" class="badge">{{ ko.caption.ai }}</span></p>
        <p class="t-body body">{{ caption.body }}</p>
      </div>
    </template>

    <template v-else>
      <div class="field">
        <label for="cp-kw">{{ ko.caption.keywords }}</label>
        <input id="cp-kw" v-model="keywords" class="input" :class="{ 'is-error': kwBad }" autocomplete="off" aria-describedby="cp-kw-h"
          :aria-invalid="kwBad ? 'true' : undefined">
        <p id="cp-kw-h" class="hint">{{ ko.caption.keywordsHint }}</p>
      </div>
      <fieldset v-if="tagCandidates.length" class="tags">
        <legend class="t-eyebrow">{{ ko.caption.tags }}</legend>
        <label v-for="t in tagCandidates" :key="t" class="chip"><input type="checkbox" :checked="tags.includes(t)" @change="toggleTag(t)"> {{ t }}</label>
      </fieldset>

      <div class="tile t-body-sm" aria-live="polite">
        <p><b>{{ ko.caption.input }}</b></p>
        <dl class="preview">
          <dt>{{ ko.caption.inKeywords }}</dt><dd>{{ kwList.join(' ') || ko.caption.none }}</dd>
          <dt>{{ ko.caption.inTags }}</dt><dd>{{ tags.join(' ') || ko.caption.none }}</dd>
          <dt>{{ ko.caption.inWords }}</dt><dd>{{ story.childWords || ko.caption.none }}</dd>
          <dt>{{ ko.caption.inAge }}</dt><dd>{{ story.ageAtMaking ?? ko.caption.none }}</dd>
          <dt>{{ ko.caption.inDate }}</dt><dd>{{ story.madeOn || ko.caption.none }}</dd>
        </dl>
      </div>

      <div class="acts">
        <ReasonButton :label="pending ? ko.caption.remake : ko.caption.make" :disabled="!!makeWhy" :reason="makeWhy" @click="post()" @blocked="onBlock('')" />
      </div>
      <p v-if="writing" class="t-body-sm" role="status">{{ ko.caption.writing(elapsed) }}</p>
      <p v-if="status?.warming" class="t-body-sm muted">{{ ko.caption.warming(status.maxWaitSeconds) }}</p>
      <p v-if="status?.busy" class="t-body-sm muted">{{ ko.caption.busy }}</p>

      <BlockNotice v-if="block" :notice="block" @action="onBlock" />

      <!-- 직접 쓰기(D6: 출처 direct, AI 작성 표시 없음) -->
      <div v-if="direct !== null" class="field">
        <label for="cp-direct">{{ ko.caption.directLabel }}</label>
        <textarea id="cp-direct" v-model="direct" class="input" rows="3" maxlength="1000"></textarea>
        <div class="acts">
          <ReasonButton :label="ko.caption.save" :disabled="!!directWhy" :reason="directWhy" @click="post('direct')" @blocked="onBlock('')" />
          <button class="btn btn-secondary" type="button" @click="direct = null">{{ ko.caption.cancel }}</button>
        </div>
      </div>

      <!-- 초안 칸 — 한마디와 다른 칸(UX5) -->
      <div v-else class="tile stack-sm">
        <p id="cp-draft" class="t-eyebrow">{{ ko.caption.draft }}</p>
        <p v-if="g16" class="downgrade t-body" role="note">{{ ko.caption.g16 }}</p>
        <template v-if="pending">
          <p class="t-body-sm">
            <span v-if="pending.aiAuthored" class="badge">{{ ko.caption.ai }}</span>
            <span v-else class="badge">{{ ko.caption.direct }}</span>
            <span v-if="pending.edited" class="badge">{{ ko.caption.edited }}</span>
          </p>
          <textarea id="cp-edit" v-model="edit" aria-labelledby="cp-draft" class="input" rows="3" maxlength="1000"></textarea>
        </template>
        <p v-else class="t-body-sm muted">{{ ko.caption.noDraft }}</p>
        <div class="acts">
          <button v-if="edited" class="btn btn-secondary" type="button" :disabled="busy" @click="put('edit')">{{ ko.caption.saveEdit }}</button>
          <ReasonButton :label="ko.caption.approve" :disabled="!!approveWhy || edited" :reason="approveWhy" @click="put('approve')" />
          <button class="btn btn-secondary" type="button" :disabled="busy || writing" @click="toDirect">{{ ko.caption.toDirect }}</button>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
.caption-panel{max-width:640px}
.tags{border:0;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:var(--s-sm)}
.tags legend{margin-bottom:var(--s-xs)}
.chip{display:inline-flex;align-items:center;gap:6px;min-height:44px;padding:0 var(--s-md);border:1px solid var(--color-hairline);border-radius:999px;cursor:pointer}
.preview{display:grid;grid-template-columns:max-content 1fr;gap:4px var(--s-md);margin:var(--s-xs) 0 0}
.preview dd{margin:0}
.body{white-space:pre-wrap}
.badge{display:inline-block;margin-right:6px;padding:0 8px;border:1px solid currentColor;border-radius:999px;font-size:.85em}
textarea.input{min-height:96px;resize:vertical}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
.stack-sm>*+*{margin-top:var(--s-sm)}
</style>

<script setup lang="ts">
// S2 작품 올리기(T066, SD_02 §5, UC2 BF2·BF3·BF4, G5·G6, BR-INT-01·03).
// 화면이 먼저 형식(JPEG·PNG·HEIC)·용량(20MB)을 검사하고, 서버도 같은 검사를 한다(매직 바이트).
// 같은 사진을 다시 보내면 같은 Idempotency-Key — 두 번 눌러도 작품은 하나(BR-INT-03). 접수(202)되면 S3로 간다.
// 다시 찍기(S5 → S2)는 ?child=&retakeOf= 로 아이를 미리 고른다(UC2 A7, H7).
// 작품 영역 자르기(D32, C11, UC2 A10): 사각형이 사진 전체가 아니면 브라우저에서 그 영역만 새 이미지로 만들어 올린다 —
// 잘린 부분과 위치 정보(EXIF)는 서버로 가지 않는다. 사각형을 바꾸지 않았거나 브라우저가 못 여는 사진은 고른 파일 그대로.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import type { components } from '@/api/types.gen';
import BlockNotice from '@/components/BlockNotice.vue';
import CropBox from '@/components/CropBox.vue';
import { croppedName, full, isFull, JPEG_QUALITY, outputSize, outputType, snap, type Rect } from '@/app/crop';
import JourneyRail from '@/components/JourneyRail.vue';
import ReasonButton from '@/components/ReasonButton.vue';
import CharacterAvatar from '@/app/character/CharacterAvatar.vue';
import PhotoFixer from '@/app/upload/PhotoFixer.vue';
import { detectPaper, warpQuad } from '@/app/upload/autocrop';
import { exifDate } from '@/app/upload/exifDate';
import { localToday } from '@/app/localDate';
import { DEFAULT_COLOR, DEFAULT_KIND, type CharacterColor, type CharacterKind } from '@/app/character/names';
import { ko, problemCopy } from '@/copy/ko';
import { JOURNEY_FROM_CHILD } from '../authForm';
import type { ArtworkDetail } from '../artwork';

type Child = components['schemas']['Child'];
const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif'];
const EXT = /\.(jpe?g|png|hei[cf])$/i;

const route = useRoute();
const router = useRouter();
const children = ref<Child[] | null>(null);
const childId = ref(typeof route.query.child === 'string' ? route.query.child : '');
/** 아틀리에의 아이 캐릭터(D40 캐릭터 · D38 움직임): 사진을 고르면 그림을 들고 이젤로, 올리면 벽에 걸러 걸어 나간다 */
const buddy = computed(() => {
  const c = children.value?.find((x) => x.id === childId.value) as (Child & { character?: CharacterKind | null; color?: CharacterColor | null }) | undefined;
  return { kind: c?.character ?? DEFAULT_KIND, color: c?.color ?? DEFAULT_COLOR };
});
const retakeOf = typeof route.query.retakeOf === 'string' ? route.query.retakeOf : undefined;
const file = ref<File | null>(null);
const preview = ref<string | null>(null);
const key = ref<string>('');
const busy = ref(false);
const block = ref<Notice | null>(null);
const cameraEl = ref<HTMLInputElement | null>(null);
const albumEl = ref<HTMLInputElement | null>(null);
// 자르기 상태 — ready: 사각형을 보인다 · unreadable: 브라우저가 못 연 사진(자르기 없이 그대로) · none: 사진 없음
const crop = ref<'none' | 'ready' | 'unreadable'>('none');
const size = ref({ w: 0, h: 0 });
const rect = ref<Rect>(full(1, 1));
const cutting = ref(false);
let bitmap: ImageBitmap | null = null;
let generatedPreview = false;
const cropped = computed(() => crop.value === 'ready' && !isFull(rect.value, size.value.w, size.value.h));
// 올리기 전 자동 펴기(D35 ①②): 종이를 찾으면 그림 부분만 반듯하게 편 판을 쓴다. 틀리면 [모서리 고치기 · 돌리기](PhotoFixer)
const flat = ref<Blob | null>(null);
const flatUrl = ref<string | null>(null);
const quadInit = ref<[number, number][] | null>(null);
const fixing = ref(false);
function setFlat(b: Blob | null) { if (flatUrl.value) URL.revokeObjectURL(flatUrl.value); flat.value = b; flatUrl.value = b ? URL.createObjectURL(b) : null; if (file.value) key.value = crypto.randomUUID(); }
function onFixed(b: Blob, q: [number, number][]) { quadInit.value = q; setFlat(b); fixing.value = false; }
// 누운 사진(외부 피드백 4차): 편 판을 한 번 눌러 90° 돌린다 — 위아래는 모델 없이 알 수 없어 저절로 돌리지 않는다
const turning = ref(false);
async function turnFlat(deg: 90 | -90) {
  if (!flat.value || turning.value) return;
  turning.value = true;
  try {
    const bm = await createImageBitmap(flat.value);
    const c = document.createElement('canvas'); c.width = bm.height; c.height = bm.width;
    const g = c.getContext('2d')!; g.translate(c.width / 2, c.height / 2); g.rotate((deg * Math.PI) / 180); g.drawImage(bm, -bm.width / 2, -bm.height / 2);
    const b = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/jpeg', 0.92));
    if (b) setFlat(b);
  } catch { /* 돌리지 못하면 편집판에서 돌린다 */ } finally { turning.value = false; }
}
// 작품 이야기(D46): 올린 뒤에는 고칠 수 없으니 여기서 함께 — 모두 선택
const making = ref(false);
const story = ref({ title: '', madeOn: '', ageAtMaking: '', childWords: '', guardianNote: '' });
const capturedOn = ref<string | null>(null);
const today = localToday();
const outSize = computed(() => outputSize(snap(rect.value, size.value.w, size.value.h)));
watch(rect, () => { if (file.value) key.value = crypto.randomUUID(); }, { deep: true }); // 다른 영역 = 다른 사진(BR-INT-03)
// 나이 미리 채움(D46 · SD_02 §17-14): 그 아이의 가장 최근 기록(전시의 가장 많은 나이). 보호자가 적었으면 건드리지 않는다
const lastAge = ref<number | null>(null);
watch(childId, async (id) => {
  if (!id) return;
  try {
    const g = await api.get<{ groups: { ageAtMaking?: number | null }[] }>('/v1/gallery', { query: { child: id } });
    const ages = g.groups.map((x) => x.ageAtMaking).filter((a): a is number => typeof a === 'number');
    const prev = lastAge.value; lastAge.value = ages.length ? Math.max(...ages) : null;
    if (story.value.ageAtMaking === '' || story.value.ageAtMaking === String(prev ?? '')) story.value.ageAtMaking = lastAge.value == null ? '' : String(lastAge.value);
  } catch { /* 미리 채우지 못해도 비워 두면 서버가 채운다 */ }
}, { immediate: true });

const tooBig = computed(() => !!file.value && file.value.size > MAX_BYTES);
const reason = computed(() => (!childId.value ? ko.upload.needChild : !file.value ? ko.upload.needPhoto
  : tooBig.value ? ko.upload.tooBig : cutting.value ? ko.upload.crop.cutting : busy.value ? ko.upload.sending : ''));

onMounted(async () => {
  try {
    children.value = await api.get<Child[]>('/v1/children');
    if (!childId.value && children.value.length === 1) childId.value = children.value[0]!.id;
    if (childId.value && !children.value.some((c) => c.id === childId.value)) childId.value = '';
  } catch (e) { block.value = toBlock(e instanceof ApiError ? e : new ApiError(0, null)); }
});
onBeforeUnmount(() => { clearPhoto(); });

function clearPhoto() {
  if (preview.value) URL.revokeObjectURL(preview.value);
  preview.value = null; bitmap?.close?.(); bitmap = null; generatedPreview = false; crop.value = 'none';
  setFlat(null); quadInit.value = null; capturedOn.value = null;
}

/** 사진을 연다(EXIF 방향 보정). 못 열면 자르기 없이 그대로 올린다(D32 ⑥). HEIC처럼 <img>가 못 그리는 형식은 캔버스로 미리보기를 만든다. */
async function openPhoto(f: File, isHeic: boolean) {
  if (typeof createImageBitmap !== 'function') { crop.value = 'unreadable'; return; }
  try {
    const bm = await createImageBitmap(f, { imageOrientation: 'from-image' });
    if (file.value !== f) { bm.close?.(); return; } // 그 사이 다른 사진을 골랐다
    bitmap = bm; size.value = { w: bm.width, h: bm.height }; rect.value = full(bm.width, bm.height);
    if (isHeic) {
      const s = Math.min(1, 1600 / Math.max(bm.width, bm.height));
      const c = document.createElement('canvas'); c.width = Math.round(bm.width * s); c.height = Math.round(bm.height * s);
      c.getContext('2d')!.drawImage(bm, 0, 0, c.width, c.height);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.85));
      if (!blob) throw new Error('preview');
      preview.value = URL.createObjectURL(blob); generatedPreview = true;
    }
    crop.value = 'ready';
    // 촬영일(EXIF 날짜만) → 그린 날 미리 채움(D34 ③ · D46)
    void exifDate(f).then((d) => { if (file.value === f && d) { capturedOn.value = d; if (!story.value.madeOn) story.value.madeOn = d; } });
    // 종이 자동 찾기 → 찾으면 그림 부분만 편 판(아이 얼굴 · 배경은 서버로 가지 않는다)
    const found = detectPaper(bm, bm.width, bm.height) as { quad: [number, number][] | null };
    if (found.quad && file.value === f) {
      const c = warpQuad(bm, found.quad, 2400) as HTMLCanvasElement;
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
      if (blob && file.value === f) { quadInit.value = found.quad; setFlat(blob); }
    }
  } catch { crop.value = 'unreadable'; }
}

/** 올릴 파일 — 사각형이 사진 전체가 아니면 그 영역만 새 이미지로 만든다. 실패하면 null. */
async function fileToSend(): Promise<File | null> {
  const f = file.value!;
  if (flat.value) return new File([flat.value], croppedName(f.name, 'image/jpeg'), { type: 'image/jpeg' }); // 편 판 우선
  if (!cropped.value || !bitmap) return f;
  const r = snap(rect.value, size.value.w, size.value.h); const o = outputSize(r); const type = outputType(f.type, f.name);
  const c = document.createElement('canvas'); c.width = o.w; c.height = o.h;
  const ctx = c.getContext('2d'); if (!ctx) return null;
  ctx.drawImage(bitmap, r.x, r.y, r.w, r.h, 0, 0, o.w, o.h);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, type, type === 'image/jpeg' ? JPEG_QUALITY : undefined));
  return blob ? new File([blob], croppedName(f.name, type), { type }) : null;
}
function cropFailed(): Notice {
  const g = problemCopy({ gate: 'G5', reason: 'format' });
  return { variant: 'block', gate: null, summary: ko.upload.crop.failed, reason: ko.upload.crop.failed, releaser: g.releaser, self: true,
    actions: [ko.upload.crop.reset, g.actions[0]!], fields: [] };
}

function gate5(reasonCode: 'format' | 'over_20mb' | 'missing_photo'): Notice {
  return { ...problemCopy({ gate: 'G5', reason: reasonCode }), actions: [...problemCopy({ gate: 'G5', reason: reasonCode }).actions], gate: 'G5', fields: [] };
}

function pick(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0] ?? null;
  (ev.target as HTMLInputElement).value = '';
  if (!f) return;
  block.value = null;
  clearPhoto();
  file.value = f;
  key.value = crypto.randomUUID(); // 새 사진이면 새 요청 번호, 같은 사진 재전송은 같은 번호
  if (!(TYPES.includes(f.type) || EXT.test(f.name))) { block.value = gate5('format'); file.value = null; return; }
  if (f.size > MAX_BYTES) { block.value = gate5('over_20mb'); return; }
  const heic = f.type === 'image/heic' || f.type === 'image/heif' || /\.hei[cf]$/i.test(f.name);
  if (!heic) preview.value = URL.createObjectURL(f); // HEIC는 <img>가 못 그리는 브라우저가 많다 — 열리면 openPhoto가 캔버스 미리보기를 만든다
  void openPhoto(f, heic);
}

async function submit() {
  if (reason.value || !file.value) return;
  busy.value = true; block.value = null;
  try {
    cutting.value = cropped.value;
    const photo = await fileToSend();
    cutting.value = false;
    if (!photo) { block.value = cropFailed(); return; }
    if (photo.size > MAX_BYTES) { block.value = gate5('over_20mb'); return; }
    const form = new FormData();
    form.append('childId', childId.value);
    form.append('photo', photo, photo.name);
    if (retakeOf) form.append('retakeOf', retakeOf);
    // D46: 만들기 · 작품 이야기(모두 선택) — 올린 뒤에는 고칠 수 없다
    form.append('making', making.value ? 'true' : 'false');
    for (const [k, v] of Object.entries(story.value)) if (String(v).trim() !== '') form.append(k, k === 'title' ? String(v).trim() : String(v));
    if (capturedOn.value) form.append('capturedOn', capturedOn.value);
    const a = await api.post<ArtworkDetail>('/v1/artworks', { form, headers: { 'Idempotency-Key': key.value } });
    // D34: 올리면 바로 걸린다 → 전시로 가서 걸리는 장면(?hung)을 본다(옛 확정 화면으로 가지 않는다)
    await router.push({ path: '/app', query: { child: childId.value, hung: a.id } });
  } catch (e) {
    const err = e instanceof ApiError ? e : new ApiError(0, null);
    block.value = err.status === 413 ? gate5('over_20mb') : toBlock(err);
  } finally { busy.value = false; cutting.value = false; }
}

function onBlock(label: string) {
  if (label === '다시 올리기') void submit();
  else if (label === ko.upload.crop.reset) { rect.value = full(size.value.w, size.value.h); block.value = null; }
  else albumEl.value?.click();
}
</script>

<template>
  <main class="container page stack">
    <JourneyRail current="upload" :steps="JOURNEY_FROM_CHILD" />
    <h1 class="t-headline">{{ ko.shell.appMenu.upload }}</h1>

    <form class="card stack up-form" novalidate @submit.prevent="submit">
      <fieldset class="field">
        <legend class="t-card-title">{{ ko.upload.whose }}</legend>
        <label for="up-child">{{ ko.upload.child }}</label>
        <select id="up-child" v-model="childId" class="input">
          <option value="" disabled>{{ ko.upload.needChild }}</option>
          <option v-for="c in children ?? []" :key="c.id" :value="c.id">{{ c.alias }}</option>
        </select>
        <RouterLink v-if="children && !children.length" class="btn btn-secondary" to="/app/children">{{ ko.shell.appMenu.children }}</RouterLink>
      </fieldset>

      <fieldset class="field">
        <legend class="t-card-title">{{ ko.upload.photo }}</legend>
        <div class="acts">
          <button class="btn btn-secondary" type="button" @click="cameraEl?.click()">{{ ko.upload.camera }}</button>
          <button class="btn btn-secondary" type="button" @click="albumEl?.click()">{{ ko.upload.album }}</button>
        </div>
        <input ref="cameraEl" class="hidden-input" type="file" accept="image/*" capture="environment" tabindex="-1" aria-hidden="true" @change="pick">
        <input ref="albumEl" class="hidden-input" type="file" accept="image/jpeg,image/png,image/heic,image/heif,.heic,.heif" tabindex="-1" aria-hidden="true" @change="pick">
        <!-- 형식 목록 · 파일 이름 · 크기는 보호자에게 보이지 않는다(D34 ④, SD_02 §17-8) — 검사는 그대로 -->
        <img v-if="preview && !tooBig && crop !== 'ready'" :src="preview" alt="" class="preview">
        <p v-if="file && !tooBig && crop === 'unreadable'" class="hint">{{ ko.upload.crop.unreadable }}</p>
      </fieldset>

      <fieldset v-if="file && !tooBig && flatUrl" class="field up-flat">
        <legend class="t-card-title">{{ ko.up2.flatTitle }}</legend>
        <img :src="flatUrl" alt="" class="preview flat">
        <div class="acts">
          <button class="btn btn-secondary turn" type="button" :disabled="turning" :aria-label="ko.fix.left" @click="turnFlat(-90)">↺</button>
          <button class="btn btn-secondary turn" type="button" :disabled="turning" :aria-label="ko.fix.right" @click="turnFlat(90)">↻</button>
          <button class="btn btn-secondary" type="button" @click="fixing = true">✎ {{ ko.up2.fix }}</button>
          <button class="btn btn-tertiary" type="button" @click="setFlat(null)">{{ ko.up2.useWhole }}</button>
        </div>
      </fieldset>
      <fieldset v-else-if="file && !tooBig && crop === 'ready' && preview" class="field">
        <legend class="t-card-title">{{ ko.upload.crop.title }}</legend>
        <p class="hint" id="up-crop-hint">{{ ko.upload.crop.hint }}</p>
        <CropBox v-model="rect" :src="preview" :width="size.w" :height="size.h" aria-describedby="up-crop-hint up-crop-keys" />
        <p class="hint" id="up-crop-keys">{{ ko.upload.crop.keys }}</p>
        <div class="acts crop-row">
          <p class="t-body-sm num" aria-live="polite">{{ cropped ? ko.upload.crop.cropped(outSize.w, outSize.h) : ko.upload.crop.whole }}</p>
          <button v-if="cropped" class="btn btn-secondary" type="button" @click="rect = full(size.w, size.h)">{{ ko.upload.crop.reset }}</button>
          <button class="btn btn-secondary" type="button" @click="fixing = true">✎ {{ ko.up2.fix }}</button>
        </div>
      </fieldset>

      <!-- 작품 이야기(D46) — 올린 뒤에는 고칠 수 없다 -->
      <fieldset v-if="file && !tooBig" class="field up-story">
        <legend class="t-card-title">{{ ko.up2.storyTitle }}</legend>
        <div class="kind" role="radiogroup" :aria-label="ko.up2.kindLegend"><!-- 네이티브 radio: 화살표로 옮기고 Tab은 한 번만 멈춘다 -->
          <label class="pill" :class="{ on: !making }"><input v-model="making" class="sr-only" type="radio" name="up-kind" :value="false"> 🖍 {{ ko.up2.drawing }}</label>
          <label class="pill" :class="{ on: making }"><input v-model="making" class="sr-only" type="radio" name="up-kind" :value="true"> 🧸 {{ ko.up2.making }}</label>
        </div>
        <label for="up-title">{{ ko.up2.title }}</label>
        <input id="up-title" v-model="story.title" class="input" maxlength="100" :placeholder="ko.up2.titlePh">
        <div class="two">
          <div><label for="up-made">{{ ko.up2.madeOn }}</label><input id="up-made" v-model="story.madeOn" class="input" type="date" :max="today"></div>
          <div><label for="up-age">{{ ko.up2.age }}</label><input id="up-age" v-model="story.ageAtMaking" class="input" type="number" min="0" max="18" inputmode="numeric" :placeholder="ko.up2.agePh"></div>
        </div>
        <details class="more" :open="!!(story.childWords || story.guardianNote)">
          <summary>✎ {{ ko.up2.more }}</summary>
          <label for="up-words">{{ ko.up2.words }}</label>
          <textarea id="up-words" v-model="story.childWords" class="input" rows="2" maxlength="2000"></textarea>
          <label for="up-note">{{ ko.up2.note }}</label>
          <textarea id="up-note" v-model="story.guardianNote" class="input" rows="2" maxlength="1000"></textarea>
        </details>
        <p class="lock" role="note">🔒 {{ ko.up2.lockNote }}</p>
      </fieldset>

      <BlockNotice v-if="block" :notice="block" @action="onBlock" />
      <div class="acts">
        <ReasonButton :label="ko.upload.submit" :disabled="!!reason" :reason="reason" @click="submit" @blocked="!file ? albumEl?.click() : undefined" />
      </div>

      <section class="downgrade" aria-labelledby="up-after">
        <p id="up-after" class="t-body"><b>{{ ko.upload.afterTitle }}</b></p>
        <p class="t-body-sm">{{ ko.upload.after1 }}</p>
        <p class="t-body-sm">{{ ko.upload.after2 }}</p>
      </section>
    </form>
    <PhotoFixer v-if="fixing && preview" :src="preview" :initial="quadInit" @close="fixing = false" @done="onFixed" />
    <div class="up-buddy" :class="{ carry: !!file, go: busy }" aria-hidden="true"><CharacterAvatar :kind="buddy.kind" :color="buddy.color" :size="104" /><span v-if="file" class="up-sheet"></span></div>
  </main>
</template>

<style scoped>
.up-form{max-width:640px}
.preview.flat{max-height:48vh;width:auto;max-width:100%;background:#fffeef;padding:10px;box-shadow:0 0 0 6px #e9d39a,0 18px 26px -18px rgba(0,0,0,.45)}
.up-story{display:grid;gap:8px}
.up-story .kind{display:flex;gap:8px;flex-wrap:wrap}
.up-story .pill{min-height:44px;padding:10px 16px;border-radius:999px;border:2px solid #d9b566;background:#fffdf8;font:700 15px/1 var(--font-sans);cursor:pointer;color:var(--color-ink)}
.up-story .pill{display:inline-flex;align-items:center;gap:6px}
.up-story .pill:has(input:focus-visible){outline:3px solid var(--color-primary);outline-offset:2px}
.up-flat .turn{min-width:52px;font-size:20px}
.up-story .more{display:grid;gap:6px}
.up-story .more summary{cursor:pointer;min-height:44px;display:flex;align-items:center;font:700 15px/1.2 var(--font-sans);color:#7a5a2e}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.up-story .pill.on{background:#fbecc4;border-color:#b08a3e;box-shadow:inset 0 0 0 2px #fff}
.up-story .two{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.up-story .lock{margin:4px 0 0;font:600 14px/1.45 var(--font-sans);color:#7a4a1f;background:#fff4df;border-radius:10px;padding:8px 12px}
/* 아틀리에의 아이 캐릭터 — 사진을 고르면 종이를 들고 이젤 옆으로 통통 걸어 오고, 올리면 벽에 걸러 나간다(D38 · 로블록스 느낌 살짝) */
.up-buddy{position:fixed;left:4vw;bottom:5vh;z-index:2;pointer-events:none;transition:transform var(--dur-3,800ms) var(--ease-spring,ease)}
.up-buddy :deep(svg){animation:buddy-bob 1.6s ease-in-out infinite}
.up-buddy.carry{transform:translateX(min(22vw,180px))}
.up-buddy.carry :deep(svg){animation:buddy-hop .5s ease-in-out 3,buddy-bob 1.6s ease-in-out 1.5s infinite}
.up-buddy.go{transform:translateX(110vw);transition-duration:1.4s}
.up-sheet{position:absolute;left:62%;top:38%;width:34px;height:26px;background:#fff;border-radius:2px;box-shadow:0 0 0 2px #e4572e,0 4px 8px -4px rgba(0,0,0,.4);transform:rotate(-8deg)}
@keyframes buddy-bob{50%{transform:translateY(-4px)}}
@keyframes buddy-hop{40%{transform:translateY(-18px) rotate(-4deg)}80%{transform:translateY(0) rotate(3deg)}}
@media (max-width:560px){.up-buddy{left:2vw;bottom:2vh;transform:scale(.8)}.up-buddy.carry{transform:translateX(24vw) scale(.8)}}
@media (prefers-reduced-motion:reduce){.up-buddy,.up-buddy :deep(svg){animation:none;transition:none}}
fieldset{border:0;margin:0;padding:0}
legend{margin-bottom:var(--s-xs)}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
.hidden-input{position:absolute;width:1px;height:1px;opacity:0;pointer-events:none}
.preview{max-width:100%;max-height:320px;border-radius:var(--r-md);background:var(--color-surface-soft);object-fit:contain}
.num{font-variant-numeric:tabular-nums}
.crop-row{align-items:center;justify-content:space-between}
</style>

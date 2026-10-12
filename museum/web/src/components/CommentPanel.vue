<script setup lang="ts">
// 가족 코멘트(D46 ④ · ⑨, SD_02 §17-14 — 화면 말은 "코멘트", 데이터 이름 comments): 가족 보호자만 읽고 쓴다(가족 밖 방문 화면에는 붙이지 않는다). 내 코멘트만 [지우기].
import { onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import { ko } from '@/copy/ko';

interface Comment { id: string; body: string; createdAt: string; mine: boolean; author: 'me' | 'owner' | 'co' | 'gone' }
const props = defineProps<{ artworkId: string }>();
const list = ref<Comment[]>([]);
const open = ref(false);
const failed = ref(false); // 불러오기 실패 — "기간이 끝났어요"와 다르다
const text = ref('');
const busy = ref(false);
const msg = ref('');
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
// 7일 기한(D46 ⑧ · ⑨)은 내부 규칙: 화면에 기한 · 남은 날을 보이지 않고, 지나면(open=false · 서버 409) 입력 줄 · [지우기]만 조용히 사라진다
async function load() {
  try { const r = await api.get<{ items: Comment[]; open: boolean; openUntil: string }>(`/v1/artworks/${props.artworkId}/comments`); list.value = r.items; open.value = r.open; failed.value = false; }
  catch { list.value = []; open.value = false; failed.value = true; }
}
async function send() {
  if (!text.value.trim() || busy.value) return;
  busy.value = true; msg.value = '';
  try { const c = await api.post<Comment>(`/v1/artworks/${props.artworkId}/comments`, { body: { body: text.value } }); list.value.push(c); text.value = ''; }
  catch (e) { if (e instanceof ApiError && e.reason === 'comments_closed') { open.value = false; msg.value = ''; } else msg.value = ko.comment.fail; } // 기한 지남은 조용히 보기만(D46 ⑨)
  busy.value = false;
}
async function del(c: Comment) {
  msg.value = '';
  try { await api.del(`/v1/artworks/${props.artworkId}/comments/${c.id}`); list.value = list.value.filter((x) => x.id !== c.id); }
  catch (e) { if (e instanceof ApiError && e.reason === 'comments_closed') open.value = false; else msg.value = ko.comment.delFail; }
}
onMounted(load);
</script>

<template>
  <section class="cm" :aria-label="ko.comment.title">
    <h3 class="cm-h">💬 {{ ko.comment.title }}</h3>
    <ul v-if="list.length" class="cm-list">
      <li v-for="c in list" :key="c.id" class="cm-item" :class="{ mine: c.mine }">
        <p class="cm-body">{{ c.body }}</p>
        <p class="cm-meta">{{ ko.comment[c.author] }} · {{ when(c.createdAt) }}
          <button v-if="c.mine && open" class="cm-del" type="button" @click="del(c)">{{ ko.comment.del }}</button></p>
      </li>
    </ul>
    <p v-else-if="!failed" class="cm-empty">{{ ko.comment.empty }}</p>
    <p v-if="failed" class="cm-when">{{ ko.comment.loadFail }} <button class="cm-del" type="button" @click="load">{{ ko.comment.retry }}</button></p>
    <form v-if="open" class="cm-form" @submit.prevent="send">
      <label class="sr-only" for="cm-in">{{ ko.comment.ph }}</label>
      <textarea id="cm-in" v-model="text" class="input" rows="2" maxlength="500" :placeholder="ko.comment.ph"></textarea>
      <button class="btn btn-primary" type="submit" :disabled="busy || !text.trim()">{{ ko.comment.send }}</button>
    </form>
    <p class="cm-msg" role="status" aria-live="polite">{{ msg }}</p>
  </section>
</template>

<style scoped>
.cm{display:grid;gap:10px}
.cm-h{margin:0;font:700 17px/1.3 var(--mc-serif,serif);color:#4a3526}
.cm-list{list-style:none;margin:0;padding:0;display:grid;gap:8px;max-height:260px;overflow:auto}
.cm-item{background:#fffdf8;border-radius:14px;padding:10px 12px;box-shadow:0 0 0 1px rgba(201,165,82,.35)}
.cm-item.mine{background:#fff6e4}
.cm-body{margin:0;white-space:pre-wrap;font:500 15px/1.5 var(--font-sans);color:var(--color-ink)}
.cm-meta{margin:4px 0 0;font:500 12px/1.3 var(--font-sans);color:#7a6555;display:flex;gap:8px;align-items:center}
.cm-del{border:0;background:none;color:var(--color-primary);font:700 13px/1 var(--font-sans);cursor:pointer;padding:6px 10px;min-height:44px;min-width:44px}
.cm-when{margin:0;font:500 12px/1.3 var(--font-sans);color:#7a6555}
.cm-empty{margin:0;font:500 14px/1.4 var(--font-sans);color:#7a6555}
.cm-form{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:end}
.cm-form .btn{min-height:44px}
.cm-msg{margin:0;min-height:1.2em;font:500 13px/1.3 var(--font-sans);color:#8a2b2b}
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
</style>

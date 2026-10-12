<script setup lang="ts">
// 가족 보호자 화면(S1b)의 이웃 칸(D40, SD_02 §17-13 E, UC_16 BF1·A2·A3): 이웃 초대 링크 복사 · 대기 링크 취소 · 이웃 목록 · 끊기.
// 만든 보호자 · 공동 보호자 모두 쓴다 [추론]. 링크 원문은 만든 응답에서만 받는다.
import { onMounted, ref } from 'vue';
import { api, ApiError } from '@/api/client';
import CharacterAvatar from '@/app/character/CharacterAvatar.vue';
import { DEFAULT_COLOR, DEFAULT_KIND } from '@/app/character/names';
import { neighbor as nc, town as tc } from './copy';
import { layoutTown, type PlacedBuilding, type TownBuildingDto } from './layout';

interface Invite { id: string; expiresAt: string }
const list = ref<PlacedBuilding[]>([]);
const invites = ref<Invite[]>([]);
const link = ref('');
const copied = ref<boolean | null>(null);
const busy = ref(false);
const err = ref('');
const asking = ref<PlacedBuilding | null>(null);
const when = (iso: string) => iso.slice(0, 16).replace('T', ' ');

async function load() {
  try {
    list.value = layoutTown(await api.get<TownBuildingDto[]>('/v1/neighbors')).buildings;
    invites.value = await api.get<Invite[]>('/v1/neighbors/invites');
    err.value = '';
  } catch { err.value = tc.unavailable; }
}
onMounted(load);

async function run(fn: () => Promise<void>) {
  if (busy.value) return;
  busy.value = true; err.value = '';
  try { await fn(); } catch (e) {
    err.value = e instanceof ApiError && e.reason === 'neighbor_full' ? nc.full : tc.unavailable;
  } finally { busy.value = false; }
}
const invite = () => run(async () => {
  const r = await api.post<{ link: string }>('/v1/neighbors/invites', { body: {} });
  link.value = r.link;
  try { await navigator.clipboard.writeText(r.link); copied.value = true; } catch { copied.value = false; }
  await load();
});
const cancel = (i: Invite) => run(async () => { await api.del(`/v1/neighbors/invites/${i.id}`); await load(); });
const unlink = () => run(async () => {
  const b = asking.value; asking.value = null;
  if (b) { await api.del(`/v1/neighbors/${b.id}`); await load(); }
});
</script>

<template>
  <section id="neighbors" class="card stack-sm nbp" aria-labelledby="nbp-h">
    <h2 id="nbp-h" class="t-card-title">{{ nc.sectionTitle }}</h2>
    <p class="t-body-sm">{{ nc.intro }}</p>
    <div><button class="btn btn-primary" type="button" :disabled="busy" @click="invite">{{ nc.copy }}</button></div>
    <p class="t-body-sm">{{ nc.hint }}</p>
    <div v-if="copied !== null" class="stack-sm" role="status">
      <p class="t-body-sm">{{ copied ? nc.copied : nc.copyManual }}</p>
      <input v-if="!copied && link" class="input" type="text" readonly :value="link" :aria-label="nc.linkLabel" @focus="($event.target as HTMLInputElement).select()">
    </div>
    <p v-if="err" class="t-body-sm" role="alert">{{ err }}</p>

    <template v-if="invites.length">
      <h3 class="t-body">{{ nc.pending }}</h3>
      <ul class="rows">
        <li v-for="i in invites" :key="i.id">
          <span class="num">{{ nc.expires(when(i.expiresAt)) }}</span>
          <button class="btn btn-secondary btn-sm" type="button" :disabled="busy" @click="cancel(i)">{{ nc.cancelInvite }}</button>
        </li>
      </ul>
    </template>

    <h3 class="t-body">{{ list.length ? nc.list(list.length) : nc.none }}</h3>
    <ul v-if="list.length" class="rows">
      <li v-for="b in list" :key="b.id">
        <span class="who">
          <CharacterAvatar v-for="c in b.children.slice(0, 3)" :key="c.id" :kind="c.kind ?? DEFAULT_KIND" :color="c.color ?? DEFAULT_COLOR" :size="32" />
          <span>{{ nc.childrenOf(b.children.map((c) => c.alias)) }}</span>
        </span>
        <button class="btn btn-secondary btn-sm" type="button" :disabled="busy" @click="asking = b">{{ nc.unlink }}</button>
      </li>
    </ul>

    <div v-if="asking" class="gblock is-final" role="alertdialog" aria-labelledby="nbp-ask">
      <p id="nbp-ask" class="head">{{ nc.unlinkConfirm }}</p>
      <div class="acts">
        <button class="btn btn-primary" type="button" @click="unlink">{{ nc.unlinkGo }}</button>
        <button class="btn btn-secondary" type="button" @click="asking = null">{{ nc.cancel }}</button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.nbp{max-width:560px}
.stack-sm{display:grid;gap:var(--s-sm)}
.acts{display:flex;flex-wrap:wrap;gap:var(--s-sm)}
.rows{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.rows li{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;padding:6px 0;border-bottom:1px solid var(--color-hairline-soft)}
.who{display:flex;align-items:center;gap:6px;flex-wrap:wrap;min-width:0}
.btn-sm{min-height:44px;font-size:16px;padding:6px 14px}
.num{font-variant-numeric:tabular-nums}
</style>

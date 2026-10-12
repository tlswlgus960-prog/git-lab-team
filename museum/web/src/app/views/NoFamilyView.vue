<script setup lang="ts">
// S1d 가족 없음(T107, SD_02 §4-5, UC15 A6, U20 P0 기본값). 나가거나 해제된 계정이 로그인하면 S4 대신 여기로 온다.
// 새 가족 공간을 자동으로 만들지 않고 보호자가 고른다: 초대 기다리기(안내만) · 새 가족 공간 만들기(POST /v1/family).
// 만들면 S1로 가서 "이제 아이를 등록해 주세요". 다른 탭에서 이미 합류했으면 409 already_in_family → S4.
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, ApiError, toBlock, type BlockNotice as Notice } from '@/api/client';
import BlockNotice from '@/components/BlockNotice.vue';
import { ko } from '@/copy/ko';
import { useSession } from '@/stores/session';
import AccountHeader from '../components/AccountHeader.vue';

const router = useRouter();
const s = useSession();
const busy = ref(false);
const err = ref<Notice | null>(null);
const g0: Notice = { variant: 'block', gate: 'G0', summary: ko.family.noFamilySummary, reason: ko.family.noFamilyReason,
  releaser: ko.family.noFamilyReleaser, self: true, actions: [], fields: [] };

async function create() {
  if (busy.value) return;
  busy.value = true; err.value = null;
  try {
    await api.post('/v1/family');
    await s.loadGuardian(true);
    await router.replace({ path: '/app/children', query: { verified: '1' } });
  } catch (e) {
    const x = e instanceof ApiError ? e : new ApiError(0, null);
    if (x.reason === 'already_in_family') { await s.loadGuardian(true).catch(() => undefined); await router.replace('/app'); return; }
    err.value = toBlock(x);
  } finally { busy.value = false; }
}
</script>

<template>
  <AccountHeader />
  <main class="container page stack">
    <BlockNotice :notice="g0" />
    <p class="t-body-sm">{{ ko.family.oldWorks }}</p>
    <section class="tile stack-sm">
      <h2 class="t-card-title">{{ ko.family.waitTitle }}</h2>
      <p class="t-body-sm">{{ ko.family.wait1 }}</p>
      <p class="t-body-sm">{{ ko.family.wait2 }}</p>
    </section>
    <section class="card stack-sm">
      <h2 class="t-card-title">{{ ko.family.create }}</h2>
      <BlockNotice v-if="err" :notice="err" @action="create" />
      <div><button class="btn btn-primary" type="button" :aria-disabled="busy ? 'true' : undefined" @click="create">{{ ko.family.create }}</button></div>
      <p class="t-body-sm">{{ ko.family.create1 }}</p>
      <p class="t-body-sm">{{ ko.family.create2 }}</p>
    </section>
  </main>
</template>

<style scoped>
.stack-sm{display:grid;gap:var(--s-sm)}
</style>

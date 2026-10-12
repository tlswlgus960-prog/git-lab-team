// model-api 내부 경로 클라이언트(127.0.0.1, T109·T143). 응답이 없으면 null — 준비 판정은 DB·큐·저장소로만 한다(FR-12).
export interface ModelLoadStatus {
  modelId: string; activeVersion: string | null; execDevice: string | null; runtime: string | null; licenseConfirmed: boolean;
  workers?: number; load: { state: string; elapsedSeconds?: number | null; remainingSeconds?: number | null; expectedSeconds?: number | null } | null;
  hint: string | null; queue?: { inFlight: number; waiting: number } | null;
}

export class ModelApi {
  private cache: { at: number; models: ModelLoadStatus[] | null } = { at: 0, models: null };
  constructor(private base: string, private timeoutMs = 1500) {}

  private async call(path: string, method = 'GET'): Promise<{ status: number; body: unknown } | null> {
    try {
      const r = await fetch(this.base.replace(/\/$/, '') + path, { method, signal: AbortSignal.timeout(this.timeoutMs) });
      return { status: r.status, body: await r.json().catch(() => null) };
    } catch { return null; }
  }

  /** /internal/models — 2초 캐시(A console과 같은 주기) */
  async models(): Promise<ModelLoadStatus[] | null> {
    if (Date.now() - this.cache.at < 2000) return this.cache.models;
    const r = await this.call('/internal/models');
    const models = r && r.status === 200 ? ((r.body as { models?: ModelLoadStatus[] })?.models ?? null) : null;
    this.cache = { at: Date.now(), models };
    return models;
  }

  async warmup(modelId: string) { return this.call(`/internal/models/${encodeURIComponent(modelId)}/warmup`, 'POST'); }
}

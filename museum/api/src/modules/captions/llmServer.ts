// llm-server 클라이언트(127.0.0.1:8200, llm-contract §1). 동기 호출 30초 상한(보호자 화면 대기, [추론 U6]).
// llm-server는 DB에 쓰지 않는다 — 기록은 app-api가 한다(stage-job §11).
export type InfraClass = 'engine_down' | 'timeout' | 'model_not_ready';
export interface CaptionInput { requestId: string; keywords: string[]; tags: string[]; words?: string; ageAtMaking?: number; madeOn?: string }
export interface CaptionOk {
  outcome: 'ok'; source: 'llm' | 'template'; body: string; generationCount: number;
  ruleFailCount?: number; lastFailClass?: string | null; failClasses?: string[];
}
export type CaptionReply = CaptionOk | { outcome: InfraClass | 'cancelled' };
export interface LlmReady { model?: { state?: string; maxObservedLoadSeconds?: number | null } | null; queue?: { waiting?: number } | null }

export interface LlmPort {
  caption(input: CaptionInput): Promise<CaptionReply>;
  ready(): Promise<LlmReady | null>;
}

export class LlmServer implements LlmPort {
  constructor(private base: string, private timeoutMs = 30_000) {}
  private url(p: string) { return this.base.replace(/\/$/, '') + p; }

  async caption(input: CaptionInput): Promise<CaptionReply> {
    try {
      const r = await fetch(this.url('/v1/caption'), {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input), signal: AbortSignal.timeout(this.timeoutMs),
      });
      const body = (await r.json().catch(() => null)) as CaptionReply | null;
      if (!body || !('outcome' in body)) return { outcome: 'engine_down' };
      if (body.outcome === 'ok' || ['engine_down', 'timeout', 'model_not_ready', 'cancelled'].includes(body.outcome)) return body;
      return { outcome: 'engine_down' }; // invalid_input 등 — 앱이 G14를 먼저 막으므로 여기 오면 서버 이상으로 본다
    } catch (e) {
      return { outcome: (e as Error).name === 'TimeoutError' ? 'timeout' : 'engine_down' };
    }
  }

  async ready(): Promise<LlmReady | null> {
    try {
      const r = await fetch(this.url('/v1/ready'), { signal: AbortSignal.timeout(1500) });
      return r.ok ? ((await r.json()) as LlmReady) : null;
    } catch { return null; }
  }
}

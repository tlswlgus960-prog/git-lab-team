"""평가 실행기 CLI(T117, stage-job §12, SD_01 8.4·8.5, UC9 BF4·BF5).

    python eval/runner.py run --group cpu_vision        # pm2 없이 평가 작업만 처리하는 일회성 워커(남은 작업이 없으면 끝남)
    python eval/runner.py report <evaluation_id> [--json]

serving/.venv의 파이썬으로 실행한다(serving 패키지를 쓴다). DB·저장소·매니페스트 환경 변수는 serving과 같다.
보고서는 기대 경로 일치율, 불일치·오인 후보, 처리 시간 p50·p95·최대, 메모리 최대, 미완료·시간 초과 수를
후보 버전과 활성 버전(같은 모델의 가장 최근 평가)을 나란히 보인다. 점수는 싣지 않는다(BR-PRC-04).
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

SERVING = Path(__file__).resolve().parents[1] / "serving"
sys.path.insert(0, str(SERVING))

from common.config import load_settings  # noqa: E402
from common.db import connect  # noqa: E402

# 오인 후보: 기대가 움직임이 아닌데 움직임으로 간 경우(집 그림 0.946 유형, BR-SUG-04)가 가장 중요하다
MISCLASS_FIRST = ("animated",)


def _pct(values: list[int], q: float) -> int | None:
    if not values:
        return None
    v = sorted(values)
    return v[min(len(v) - 1, max(0, int(round(q * (len(v) - 1)))))]


def model_expected(model_id: str | None, expected: str | None) -> str | None:
    """채점(D57): 기대 경로를 그 모델이 낼 수 있는 답으로 — M1·M5는 animated를 relief로 본다."""
    return "relief" if model_id in ("M1", "M5") and expected == "animated" else expected


def summarize(rows: list[dict], item_total: int, model_id: str | None = None) -> dict:
    done = [r for r in rows if r["status"] == "done"]
    ms = [r["processing_ms"] for r in done if r["processing_ms"] is not None]
    mb = [r["memory_mb"] for r in rows if r["memory_mb"] is not None]
    mism = [r for r in done if r["result_path"] != model_expected(model_id, r["expected_path"])]
    return {
        "item_total": item_total,
        "done": len(done),
        "incomplete": sum(r["status"] == "incomplete" for r in rows) + (item_total - len(rows)),
        "timeout": sum(r["status"] == "timeout" for r in rows),
        "match_rate": round((len(done) - len(mism)) / len(done), 4) if done else None,
        "mismatches": [{"item_id": r["item_id"], "category": r["category"], "expected": r["expected_path"],
                        "got": r["result_path"], "misclass_label": r["misclass_label"]}
                       for r in sorted(mism, key=lambda r: (r["result_path"] not in MISCLASS_FIRST, r["item_id"]))],
        "ms_p50": _pct(ms, 0.5), "ms_p95": _pct(ms, 0.95), "ms_max": max(ms) if ms else None,
        "memory_mb_max": max(mb) if mb else None,
    }


def _rows(cur, evaluation_id: int) -> list[dict]:
    cur.execute("""SELECT r.item_id, r.status, r.result_path, r.processing_ms, r.memory_mb, r.misclass_label,
                          i.category, i.expected_path
                     FROM eval_item_result r JOIN eval_item i ON i.item_id = r.item_id
                    WHERE r.evaluation_id = %s ORDER BY r.item_id""", (evaluation_id,))
    return list(cur.fetchall())


def report(evaluation_id: int) -> dict:
    conn = connect(load_settings())
    try:
        with conn.cursor() as cur:
            cur.execute("""SELECT e.evaluation_id, e.item_total, e.verdict, mv.model_id, mv.version_label, mv.version_id,
                                  p.eligible
                             FROM evaluation e JOIN model_version mv ON mv.version_id = e.version_id
                             JOIN v_promotion_eligibility p ON p.evaluation_id = e.evaluation_id
                            WHERE e.evaluation_id = %s""", (evaluation_id,))
            e = cur.fetchone()
            if not e:
                raise SystemExit(f"평가 {evaluation_id} 없음")
            out = {"evaluation_id": e["evaluation_id"], "model_id": e["model_id"], "candidate": e["version_label"],
                   "verdict": e["verdict"], "eligible": bool(e["eligible"]),
                   "candidate_summary": summarize(_rows(cur, evaluation_id), e["item_total"], e["model_id"])}
            cur.execute("""SELECT e.evaluation_id, e.item_total, mv.version_label FROM evaluation e
                             JOIN model_version mv ON mv.version_id = e.version_id
                            WHERE mv.model_id = %s AND mv.release_state = 'active'
                            ORDER BY e.evaluation_id DESC LIMIT 1""", (e["model_id"],))
            a = cur.fetchone()
            out["active"] = a["version_label"] if a else None
            out["active_summary"] = summarize(_rows(cur, a["evaluation_id"]), a["item_total"], e["model_id"]) if a else None
        return out
    finally:
        conn.close()


def _print(r: dict) -> None:
    print(f"평가 {r['evaluation_id']} · {r['model_id']} 후보 {r['candidate']} · 판단 {r['verdict'] or '미기록'} · "
          f"승격 가능 {'예' if r['eligible'] else '아니요'}")
    cols = [("항목", "item_total"), ("완료", "done"), ("미완료", "incomplete"), ("시간 초과", "timeout"),
            ("기대 경로 일치율", "match_rate"), ("처리 p50 ms", "ms_p50"), ("처리 p95 ms", "ms_p95"),
            ("처리 최대 ms", "ms_max"), ("메모리 최대 MB", "memory_mb_max")]
    c, a = r["candidate_summary"], r["active_summary"]
    print(f"\n| 항목 | 후보 {r['candidate']} | 활성 {r['active'] or '-'} |\n|---|---|---|")
    for name, k in cols:
        print(f"| {name} | {c[k]} | {a[k] if a else '-'} |")
    if c["mismatches"]:
        print("\n불일치(움직임으로 잘못 간 항목이 먼저):")
        for m in c["mismatches"]:
            print(f"- 항목 {m['item_id']} ({m['category']}): 기대 {m['expected']} → 결과 {m['got']}"
                  + (f" · 오인 분류 {m['misclass_label']}" if m["misclass_label"] else ""))


def run(group: str) -> int:
    from workers.runner import Worker
    from workers.stages.eval import EvalRunner

    w = Worker(group)
    w.preload_all()
    er = EvalRunner(w)
    n = 0
    try:
        while True:
            got = er.run_once()
            if got is None:
                break
            n += 1
    finally:
        w.stop()
    print(f"평가 작업 {n}건 처리")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="eval/runner.py")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run"); r.add_argument("--group", default="cpu_vision", choices=["cpu_vision", "gpu"])
    p = sub.add_parser("report"); p.add_argument("evaluation_id", type=int); p.add_argument("--json", action="store_true")
    a = ap.parse_args(argv)
    if a.cmd == "run":
        return run(a.group)
    rep = report(a.evaluation_id)
    print(json.dumps(rep, ensure_ascii=False, indent=2, default=str)) if a.json else _print(rep)
    return 0


if __name__ == "__main__":
    sys.exit(main())

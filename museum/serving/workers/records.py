"""결과 기록 공통 — 저장소 확정 + stored_object INSERT."""
from __future__ import annotations

from pathlib import Path

from common.storage import LocalStorage

EXT = {"mask": "png", "cutout": "png", "joints": "json", "depth": "png",
       "result_animated": "mp4", "result_relief": "png", "result_glb": "glb"}


def store_output(cur, storage: LocalStorage, ctx, kind: str, tmp_path: str) -> int:
    """tmp 파일을 가족 영역으로 옮기고 stored_object 행을 만든다."""
    prefix = LocalStorage.artwork_prefix(ctx.original_key)
    key = LocalStorage.new_key(prefix, kind, EXT.get(kind, Path(tmp_path).suffix.lstrip(".") or "bin"))
    storage.promote(Path(tmp_path), key)
    cur.execute("""INSERT INTO stored_object (owner_kind, family_id, artwork_id, object_kind, object_key)
                   VALUES ('family', %s, %s, %s, %s)""", (ctx.family_id, ctx.artwork_id, kind, key))
    return cur.lastrowid


def open_judge(cur, artwork_id: int) -> None:
    """split이 끝나면(성공·낮춤·소진 모두) judge를 연다(stage-job §2)."""
    cur.execute("""UPDATE stage_job SET available_at = UTC_TIMESTAMP()
                    WHERE artwork_id = %s AND stage_kind = 'judge' AND status IN ('queued','retry_wait')
                      AND available_at > UTC_TIMESTAMP()""", (artwork_id,))


def open_confirmed(cur, artwork_id: int) -> None:
    """judge가 끝나면(성공·품질 미달·소진 모두) 잠긴 확정 결과 작업을 연다(stage-job §2 "판정 전 확정의 순서", T144).

    relief 확정인데 split_ok가 TRUE가 아니면 depth_relief를 done_downgraded·split_fail로 닫고 frame_compose를 등록한다
    (§6 넷째 줄과 같은 결과). sweeper `openConfirmJobs`와 같은 규칙.
    """
    cur.execute("SELECT split_ok FROM judgment WHERE artwork_id = %s", (artwork_id,))
    j = cur.fetchone()
    split_ok = bool(j and j["split_ok"] == 1)
    cur.execute("""SELECT job_id, stage_kind FROM stage_job
                    WHERE artwork_id = %s AND origin = 'confirm' AND status = 'queued'
                      AND available_at > UTC_TIMESTAMP() FOR UPDATE""", (artwork_id,))
    for r in cur.fetchall():
        if r["stage_kind"] == "depth_relief" and not split_ok:
            cur.execute("""UPDATE stage_job SET status = 'done_downgraded', downgrade_cause = 'split_fail', attempt_count = 1,
                                  started_at = UTC_TIMESTAMP(), finished_at = UTC_TIMESTAMP() WHERE job_id = %s""", (r["job_id"],))
            cur.execute("""INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group)
                           VALUES (%s, 'frame_compose', 'downgrade', 'cpu_vision')""", (artwork_id,))
        else:
            cur.execute("UPDATE stage_job SET available_at = UTC_TIMESTAMP() WHERE job_id = %s", (r["job_id"],))


def upsert_outcome(cur, artwork_id: int, **cols) -> None:
    names = ", ".join(cols)
    ph = ", ".join(["%s"] * len(cols))
    upd = ", ".join(f"{k} = VALUES({k})" for k in cols)
    cur.execute(f"INSERT INTO artwork_outcome (artwork_id, {names}) VALUES (%s, {ph}) "
                f"ON DUPLICATE KEY UPDATE {upd}", (artwork_id, *cols.values()))


def active_version(cur, model_id: str) -> dict | None:
    cur.execute("""SELECT version_id, version_label, license_confirmed, exec_device, runtime
                     FROM model_version WHERE model_id = %s AND release_state = 'active'""", (model_id,))
    return cur.fetchone()

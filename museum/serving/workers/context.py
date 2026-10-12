"""작업 실행 문맥 — 점유한 stage_job 행과 작품·원본·판정 객체 참조."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class JobContext:
    job: dict                                  # stage_job 행
    artwork_id: int | None
    family_id: int | None
    artwork_status: str | None
    original_key: str | None
    object_keys: dict[str, str] = field(default_factory=dict)   # mask·cutout·joints → key
    object_ids: dict[str, int] = field(default_factory=dict)
    split_ok: bool | None = None
    confirmed_path: str | None = None
    worker: str = ""

    @property
    def job_id(self) -> int:
        return self.job["job_id"]

    @property
    def stage(self) -> str:
        return self.job["stage_kind"]

    @property
    def origin(self) -> str:
        return self.job["origin"]


def load_context(cur, job: dict, worker: str) -> JobContext:
    aid = job.get("artwork_id")
    ctx = JobContext(job=job, artwork_id=aid, family_id=None, artwork_status=None, original_key=None, worker=worker)
    if aid is None:
        return ctx
    cur.execute("""SELECT a.family_id, a.status, so.object_key
                     FROM artwork a
                     LEFT JOIN artwork_original ao ON ao.artwork_id = a.artwork_id
                     LEFT JOIN stored_object so ON so.object_id = ao.object_id
                    WHERE a.artwork_id = %s""", (aid,))
    r = cur.fetchone()
    if r:
        ctx.family_id, ctx.artwork_status, ctx.original_key = r["family_id"], r["status"], r["object_key"]
    cur.execute("""SELECT j.split_ok, j.mask_object_id, j.cutout_object_id, j.joints_object_id,
                          m.object_key AS mask_key, c.object_key AS cutout_key, jt.object_key AS joints_key
                     FROM judgment j
                     LEFT JOIN stored_object m ON m.object_id = j.mask_object_id
                     LEFT JOIN stored_object c ON c.object_id = j.cutout_object_id
                     LEFT JOIN stored_object jt ON jt.object_id = j.joints_object_id
                    WHERE j.artwork_id = %s""", (aid,))
    j = cur.fetchone()
    if j:
        ctx.split_ok = None if j["split_ok"] is None else bool(j["split_ok"])
        for k in ("mask", "cutout", "joints"):
            if j[f"{k}_key"]:
                ctx.object_keys[k] = j[f"{k}_key"]
                ctx.object_ids[k] = j[f"{k}_object_id"]
    cur.execute("SELECT confirmed_path FROM artwork_outcome WHERE artwork_id = %s", (aid,))
    o = cur.fetchone()
    ctx.confirmed_path = o["confirmed_path"] if o else None
    return ctx

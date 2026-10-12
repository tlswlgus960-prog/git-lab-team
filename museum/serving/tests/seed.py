"""시험 데이터 — 가족·아이·작품·원본·활성 모델 버전·단계 작업."""
from __future__ import annotations

import uuid
from pathlib import Path

H = "0" * 64


class Seed:
    def __init__(self, conn, store: Path):
        self.conn = conn
        self.cur = conn.cursor()
        self.store = store
        self.versions: dict[str, int] = {}
        for m in ("M1", "M2", "M3", "M5"):
            self.version(m)

    def q(self, sql, *args):
        self.cur.execute(sql, args)
        return self.cur.fetchall()

    def one(self, sql, *args):
        self.cur.execute(sql, args)
        return self.cur.fetchone()

    def version(self, model_id, state="active", license=True, label=None) -> int:
        self.cur.execute("""INSERT INTO model_version (model_id, version_label, weights_sha256, config_hash, runtime,
                              license_confirmed, release_state, exec_device)
                            VALUES (%s, %s, %s, %s, 'fake', %s, %s, 'cpu')""",
                         (model_id, label or f"{model_id}-v{uuid.uuid4().hex[:6]}", H, H, license, state))
        vid = self.cur.lastrowid
        if state == "active":
            self.versions[model_id] = vid
        return vid

    def artwork(self, status="judging") -> int:
        self.cur.execute("INSERT INTO family () VALUES ()")
        fid = self.cur.lastrowid
        self.cur.execute("INSERT INTO child (family_id, alias) VALUES (%s, '하늘')", (fid,))
        cid = self.cur.lastrowid
        self.cur.execute("INSERT INTO artwork (family_id, child_id, request_no, status) VALUES (%s, %s, %s, %s)",
                         (fid, cid, uuid.uuid4().hex, status))
        aid = self.cur.lastrowid
        key = f"family/{uuid.uuid4().hex}/original/{uuid.uuid4().hex}.png"
        p = self.store / key
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_bytes(b"\x89PNG fake original")
        self.cur.execute("""INSERT INTO stored_object (owner_kind, family_id, artwork_id, object_kind, object_key)
                            VALUES ('family', %s, %s, 'original', %s)""", (fid, aid, key))
        self.cur.execute("INSERT INTO artwork_original (artwork_id, object_id) VALUES (%s, %s)", (aid, self.cur.lastrowid))
        return aid

    def job(self, artwork_id, stage, origin="intake", group="cpu_vision", future=False, **kw) -> int:
        model = {"split": "M1", "judge": "M2", "animate_render": "M3", "depth_relief": "M5"}.get(stage)
        vid = kw.pop("version_id", self.versions.get(model) if model else None)
        self.cur.execute(f"""INSERT INTO stage_job (artwork_id, stage_kind, origin, serving_group, model_version_id, available_at)
                             VALUES (%s, %s, %s, %s, %s, {"UTC_TIMESTAMP() + INTERVAL 1 DAY" if future else "UTC_TIMESTAMP()"})""",
                         (artwork_id, stage, origin, group, vid))
        return self.cur.lastrowid

    def make_ready(self, job_id):
        """재시도 대기를 건너뛰고 바로 점유할 수 있게."""
        self.cur.execute("UPDATE stage_job SET available_at = UTC_TIMESTAMP() WHERE job_id = %s", (job_id,))

    def confirmed(self, artwork_id, path, suggestion="animated"):
        self.cur.execute("UPDATE artwork SET status = 'processing', confirmed_at = UTC_TIMESTAMP() WHERE artwork_id = %s",
                         (artwork_id,))
        self.cur.execute("INSERT INTO artwork_outcome (artwork_id, suggestion_at_confirm, confirmed_path, in_approval_base) "
                         "VALUES (%s, %s, %s, TRUE)", (artwork_id, suggestion, path))

    def job_row(self, job_id):
        return self.one("SELECT * FROM stage_job WHERE job_id = %s", job_id)

"""외부 키 인증·한도·호출 기록(T121, BR-API-03·04, D17, research R-09, G2·G24·G25).

- `X-API-Key` 원문은 저장·로그하지 않는다. SHA-256으로 `api_key.key_hash`와 대조한다.
- 한도는 별도 카운터 없이 `external_call_log`(ix_ecl_key_time) 창 집계와 진행 중 `external_job` 수로 판정한다.
- 모든 호출(거절 포함)을 `external_call_log`에 남긴다 — 입력·키 원문 없음. 막힌 게이트는 `gate_event`(분류 코드만).
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

from common.config import load_yaml

STATUS_OK = {200, 202, 401, 403, 404, 413, 422, 429, 503, 504}   # SD_03 chk_ecl_status
FUNCS = ("segment", "classify", "pose", "relief", "caption")


@dataclass
class Key:
    key_id: int
    kind: str


@dataclass
class ApiError(Exception):
    status: int
    code: str
    reason: str | None = None
    gate: str | None = None
    headers: dict = field(default_factory=dict)
    fields: list | None = None

    def body(self) -> dict:
        b = {"type": f"about:blank#{self.code}", "title": self.code, "status": self.status, "code": self.code}
        if self.reason:
            b["reason"] = self.reason
        if self.gate:
            b["gate"] = self.gate
        fs = [{**f, "message": f.get("message") or FIELD_MESSAGE.get(f["reason"], "올바른 값을 넣어 주세요.")} for f in (self.fields or [])]
        if self.status == 422 and fs:
            listed = " / ".join(f"{f['name']}: {f['message']}" for f in fs)
            b["detail"] = f"입력 값이 올바르지 않습니다 — {listed} 고쳐서 다시 보내 주세요."
        else:
            b["detail"] = REASON_DETAIL.get(self.reason or "", DETAIL.get(self.code, "요청을 처리하지 못했습니다."))
        if fs:
            b["fields"] = fs
        return b


# 오류 안내(계약 머리말 "오류 안내·요청 번호", 2026-09-30 점검표 W5·E4·E7) — API를 부르는 사람을 위한 문장
DETAIL = {
    "unauthorized": "API 키가 없거나 올바르지 않습니다. 발급받은 키를 X-API-Key 헤더에 넣어 다시 요청해 주세요.",
    "forbidden_scope": "이 키로는 이 기능을 쓸 수 없습니다. 허용된 키 종류를 확인해 주세요.",
    "not_found": "요청한 대상을 찾을 수 없습니다. 경로·작업 번호를 확인해 주세요(다른 키의 작업도 찾을 수 없음으로 답합니다).",
    "payload_too_large": "이미지가 너무 큽니다. 20MB 이하로 줄여 다시 보내 주세요.",
    "invalid_input": "입력 값이 올바르지 않습니다. 계약 문서(/v1/models/openapi.json)의 규칙에 맞게 고쳐 다시 보내 주세요.",
    "rate_limited": "요청 한도를 넘었습니다. Retry-After 뒤에 다시 요청해 주세요.",
    "model_not_ready": "모델이 지금 준비되지 않았습니다. 요청을 고칠 필요는 없고, 잠시 뒤 다시 시도해 주세요.",
    "timeout": "처리 시간이 상한을 넘었습니다. 요청을 고칠 필요는 없고, 잠시 뒤 다시 시도해 주세요.",
    "conflict": "지금 상태에서는 처리할 수 없습니다. reason을 확인해 주세요.",
}
REASON_DETAIL = {
    "multipart_required": "요청은 multipart/form-data여야 합니다. 이미지 한 장을 image 칸에 담아 보내 주세요.",
    "caption_fields": "설명 입력이 올바르지 않습니다. keywords(1~5개, 각 20자 이하)·tags(5개 이하)·words(500자 이하)·ageAtMaking(0~18)만 보내 주세요(이미지·이름 칸은 받지 않습니다).",
    "key_missing": "API 키가 없습니다. 발급받은 키를 X-API-Key 헤더에 넣어 다시 요청해 주세요.",
}
FIELD_MESSAGE = {
    "required": "필수 칸입니다. 이미지 파일 한 장을 image 칸에 넣어 주세요.",
    "unrecognized": "계약에 없는 칸입니다. 이 칸을 빼고 보내 주세요(이미지는 image 칸 하나만).",
    "format": "JPEG·PNG·HEIC 이미지여야 합니다.",
    "too_large": "20MB 이하여야 합니다.",
}


def limits() -> dict:
    return load_yaml("ext-limits")


def authenticate(cur, raw: str | None) -> Key:
    if not raw:
        raise ApiError(401, "unauthorized", "key_missing", "G2")
    cur.execute("SELECT key_id, key_kind, status FROM api_key WHERE key_hash = %s",
                (hashlib.sha256(raw.encode()).hexdigest(),))
    row = cur.fetchone()
    if not row or row["status"] != "active":
        raise ApiError(401, "unauthorized", "key_invalid" if not row else "key_revoked", "G2")
    return Key(row["key_id"], row["key_kind"])


def check_rate(cur, key: Key, creates_job: bool) -> None:
    lim = limits()
    cur.execute("""SELECT SUM(called_at >= UTC_TIMESTAMP() - INTERVAL 1 MINUTE) m, COUNT(*) d FROM external_call_log
                    WHERE key_id = %s AND called_at >= UTC_TIMESTAMP() - INTERVAL 1 DAY
                      AND endpoint IN ('segment','classify','pose','relief','caption')""", (key.key_id,))
    r = cur.fetchone()
    if int(r["m"] or 0) >= lim["per_minute"]:
        raise ApiError(429, "rate_limited", "per_minute", "G2", {"Retry-After": "60"})
    if int(r["d"] or 0) >= lim["per_day"]:
        raise ApiError(429, "rate_limited", "per_day", "G2", {"Retry-After": "3600"})
    if creates_job:
        cur.execute("SELECT COUNT(*) n FROM external_job WHERE key_id = %s AND status IN ('queued','running')", (key.key_id,))
        if int(cur.fetchone()["n"]) >= lim["concurrent"]:
            raise ApiError(429, "rate_limited", "concurrent", "G2", {"Retry-After": "10"})


def record(cur, key_id: int | None, endpoint: str, status: int, gate: str | None = None, reason: str | None = None) -> None:
    """호출 기록 + 막힌 게이트. 자체 실패는 응답을 바꾸지 않는다(호출자가 삼킨다)."""
    cur.execute("INSERT INTO external_call_log (key_id, endpoint, http_status) VALUES (%s, %s, %s)",
                (key_id, endpoint if endpoint in FUNCS + ("jobs", "result") else "other", status if status in STATUS_OK else 503))
    if gate:
        role = "operator" if gate == "G25" else "external_client"
        cur.execute("""INSERT INTO gate_event (gate_id, subject_kind, subject_id, actor_role, reason_code)
                       VALUES (%s, 'external_call', NULL, %s, %s)""", (gate, role, (reason or "blocked")[:40]))

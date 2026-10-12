"""model-api(:9541) — 내부 경로(/internal, T109)와 외부 모델 기능 경로(/v1/models/*, UC12, T121·T122·T130)를 조립한다."""
import re
import uuid

from fastapi import FastAPI, Request

from .external import router as external_router
from .internal import router as internal_router

app = FastAPI(title="uam model-api", docs_url=None, redoc_url=None)
_RID = re.compile(r"^[A-Za-z0-9._-]{1,128}$")


@app.middleware("http")
async def request_id(request: Request, call_next):
    """요청 번호(계약 머리말, 점검표 L1): 형식이 맞는 X-Request-ID는 그대로, 아니면 UUID — 응답 헤더·오류 본문 requestId가 같은 값."""
    given = request.headers.get("x-request-id")
    request.state.request_id = given if given and _RID.match(given) else str(uuid.uuid4())
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


app.include_router(internal_router)
app.include_router(external_router)

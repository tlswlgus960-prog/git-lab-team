"""M2 OpenCLIP ViT-B-32 / laion2b_s34b_b79k — 제로샷 종류 1개 + 태그 후보(점수는 기록만, BR-PRC-04).

프롬프트·어휘는 config/m2_prompts.yaml(config_hash에 들어감). 가중치 라이선스 확인(A2) 전에는 활성 버전이 없어
워커가 부르지 않는다(model_not_ready → judge 소진 → 보호자 직접 확정).
"""
from __future__ import annotations

import os

from common.config import load_manifest, load_settings, load_yaml

from .base import Adapter, AdapterResult, JobInput

ARCH, PRETRAINED = "ViT-B-32", "laion2b_s34b_b79k"
HF_REPO, WEIGHTS = "laion/CLIP-ViT-B-32-laion2B-s34B-b79K", "open_clip_model.safetensors"   # pickle(.bin) 대신


class OpenClipAdapter(Adapter):
    model_id = "M2"
    CONFIG = {"arch": ARCH, "pretrained": PRETRAINED}

    def __init__(self):
        super().__init__()
        self.cfg = load_yaml("m2_prompts")
        self.cache_dir = load_settings().model_root / "hf"
        self.device = "cpu"
        m = (load_manifest().get("models") or {}).get("M2") or {}
        self.revision = os.environ.get("M2_REVISION") or m.get("revision")

    def load(self) -> None:
        import open_clip
        import torch
        from huggingface_hub import hf_hub_download

        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        from safetensors.torch import load_file

        path = hf_hub_download(HF_REPO, WEIGHTS, revision=self.revision, cache_dir=str(self.cache_dir))
        # open_clip 2.26은 체크포인트를 torch.load(pickle)로만 읽는다 — 빈 모델에 safetensors를 직접 넣는다
        self.model, _, self.preprocess = open_clip.create_model_and_transforms(ARCH, pretrained=None)
        self.model.load_state_dict(load_file(path), strict=True)
        self.model.to(self.device)
        self.model.eval()
        tok = open_clip.get_tokenizer(ARCH)
        self.kinds = list(self.cfg["kinds"])
        self.tags = list(self.cfg["tags"])
        with torch.inference_mode():
            k = self.model.encode_text(tok([self.cfg["kinds"][x] for x in self.kinds]).to(self.device))
            t = self.model.encode_text(tok([f"a child's drawing of {self.cfg['tags'][x]}" for x in self.tags]).to(self.device))
        self.k_emb = k / k.norm(dim=-1, keepdim=True)
        self.t_emb = t / t.norm(dim=-1, keepdim=True)

    def run(self, job: JobInput) -> AdapterResult:
        import torch
        from PIL import Image

        src = job.inputs.get("original")
        try:
            img = Image.open(src).convert("RGB")
        except (OSError, TypeError):
            return AdapterResult("storage", diagnostic="input_unreadable")
        with torch.inference_mode():
            f = self.model.encode_image(self.preprocess(img).unsqueeze(0).to(self.device))
            f = f / f.norm(dim=-1, keepdim=True)
            scale = self.model.logit_scale.exp()
            kp = (scale * f @ self.k_emb.T).softmax(dim=-1)[0].cpu()
            tp = (scale * f @ self.t_emb.T).softmax(dim=-1)[0].cpu()
        kind = self.kinds[int(kp.argmax())]
        top = [(self.tags[i], float(tp[i])) for i in tp.argsort(descending=True)[: self.cfg["tag_top_k"]]]
        tags = [label for label, p in top if p >= self.cfg["tag_min_score"]]
        return AdapterResult("ok", score=float(kp.max()),
                             values={"kind_candidate": kind, "person_score": round(float(kp[self.kinds.index("person")]), 4),
                                     "tags": tags})

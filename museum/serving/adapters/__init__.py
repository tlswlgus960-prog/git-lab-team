import os

# MPS에 없는 연산(bicubic 업샘플 — Depth Anything V2의 DINOv2 위치 임베딩 보간, 정사각형이 아닌 입력에서만)을
# CPU로 돌린다. torch가 처음 import되기 전에 정해야 한다(2026-09-28 실측: 800×600 입력에서 NotImplementedError)
os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

"""M1 구멍 채우기(D56) — 모델 없이. 채운 안쪽은 1, 가장자리 부드러운 값은 그대로, 비율은 채운 마스크 기준."""
import numpy as np

from adapters.m1_birefnet import fill_holes


def test_ring_is_filled_and_soft_edge_kept():
    y, x = np.mgrid[:100, :100]
    r = np.hypot(x - 50, y - 50)
    m = np.where((r >= 30) & (r <= 36), 0.9, 0.0).astype(np.float32)       # 선으로 그린 고리(안쪽은 배경)
    m[(r > 36) & (r <= 37)] = 0.3                                            # 부드러운 바깥 가장자리
    alpha, ratio = fill_holes(m, 0.5)
    assert alpha[50, 50] == 1.0                                              # 닫힌 안쪽이 채워진다
    assert np.allclose(alpha[(r > 36) & (r <= 37)], 0.3)                     # 가장자리 값은 그대로
    assert alpha[0, 0] == 0.0                                                # 테두리에 닿은 배경은 그대로
    assert ratio == float(((m > 0.5) | (r < 30)).mean())                     # 비율은 채운 마스크 기준


def test_open_shape_unchanged():
    m = np.zeros((50, 50), np.float32); m[10:40, 24:27] = 1.0              # 막대(닫힌 곳 없음)
    alpha, ratio = fill_holes(m, 0.5)
    assert np.array_equal(alpha, m) and ratio == float((m > 0.5).mean())

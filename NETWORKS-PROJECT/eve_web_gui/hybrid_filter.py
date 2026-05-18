import cv2
import numpy as np

_clahe = cv2.createCLAHE(clipLimit=3.0, tileGridSize=(8, 8))


def apply_clahe(frame: np.ndarray) -> np.ndarray:
    """
    Apply Contrast Limited Adaptive Histogram Equalization (CLAHE)
    to the L-channel of the LAB color space.
    """
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    cl_channel = _clahe.apply(l_channel)
    merged = cv2.merge((cl_channel, a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def apply_pure_red_recovery(frame: np.ndarray) -> np.ndarray:
    """
    Apply a physics-inspired red channel recovery.
    Optimized using OpenCV vectorized ops.
    """
    b_mean, g_mean, r_mean, _ = cv2.mean(frame)

    if r_mean == 0:
        r_mean = 0.001
    if b_mean == 0:
        b_mean = 0.001

    gain_r = g_mean / r_mean
    gain_b = g_mean / b_mean

    gain_r = np.clip(gain_r, 1.0, 4.0)

    b_channel, g_channel, r_channel = cv2.split(frame)

    r_channel = cv2.convertScaleAbs(r_channel, alpha=gain_r)
    b_channel = cv2.convertScaleAbs(b_channel, alpha=gain_b)

    return cv2.merge((b_channel, g_channel, r_channel))


def apply_hybrid(frame: np.ndarray) -> np.ndarray:
    """
    Apply the hybrid method:
    1) Red channel recovery
    2) CLAHE contrast enhancement
    """
    color_recovered = apply_pure_red_recovery(frame)
    return apply_clahe(color_recovered)

"""
LEGO piece segmentation service using OpenCV Watershed.

Watershed is the classical algorithm for separating touching colored objects
on a light/white background. It uses a distance transform to find the "center"
of each piece, then floods outward until regions collide — the collision line
becomes the boundary between touching pieces.

POST /segment
  Body: { "image": "<base64 jpeg>" }
  Returns: { "boxes": [{"x": %, "y": %, "w": %, "h": %}], "count": N }

POST /health
  Returns: { "ok": true }
"""

import base64
import io
import sys
import traceback

import cv2
import numpy as np
from flask import Flask, jsonify, request
from PIL import Image
from scipy import ndimage as ndi
from scipy.ndimage import label as scipy_label

app = Flask(__name__)

# ── Config ─────────────────────────────────────────────────────────────────
MIN_AREA_FRAC  = 0.0008  # ignore regions < 0.08% of image area (noise)
MAX_AREA_FRAC  = 0.06    # ignore regions > 6% of image area (baseplates, table)
MAX_DIM_FRAC   = 0.38    # ignore bounding boxes wider OR taller than 38% of image
MORPH_CLOSE_K  = 7       # kernel size for closing small gaps inside pieces
BORDER_MARGIN  = 0.01    # ignore regions whose center is within 1% of edge


# ── Helpers ────────────────────────────────────────────────────────────────

MAX_DIM = 1600  # cap processing resolution for speed; % coords still map correctly

def load_image(b64: str) -> np.ndarray:
    data = base64.b64decode(b64)
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if max(img.size) > MAX_DIM:
        img.thumbnail((MAX_DIM, MAX_DIM), Image.LANCZOS)
    return np.array(img)


def bgr(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


def segment_pieces(rgb: np.ndarray) -> list[dict]:
    H, W = rgb.shape[:2]
    img_area = H * W

    # ── 1. Background detection ─────────────────────────────────────────
    # Use full-image histogram MODE instead of corner sampling.
    # Corner sampling breaks when the photo backdrop (paper) sits in the
    # center surrounded by a different surface (wooden desk at the edges).
    # The most common pixel value in the whole image is almost always the
    # large background surface wherever it happens to appear.
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
    bg_brightness = float(np.argmax(hist))

    # ── 2. Threshold: foreground = piece pixels ─────────────────────────
    # Run Otsu with both polarities; pick whichever gives a foreground
    # fraction closest to a plausible range (TARGET ≈ 20 %).
    # The wrong polarity will produce near-0 % or near-100 % foreground.
    _, thresh_inv  = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    _, thresh_norm = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY     + cv2.THRESH_OTSU)

    fg_inv  = float(np.sum(thresh_inv  > 0)) / (H * W)
    fg_norm = float(np.sum(thresh_norm > 0)) / (H * W)

    TARGET = 0.20
    thresh = thresh_inv if abs(fg_inv - TARGET) <= abs(fg_norm - TARGET) else thresh_norm
    print(f'[SegService] bg_mode={bg_brightness:.0f} fg_inv={fg_inv:.2f} fg_norm={fg_norm:.2f} → {"inv" if thresh is thresh_inv else "norm"}', flush=True)

    # ── 3. Morphological cleanup ────────────────────────────────────────
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (MORPH_CLOSE_K, MORPH_CLOSE_K))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN,  kernel, iterations=1)

    # ── 4. Distance transform → sure foreground seeds ──────────────────
    # Each piece center will be a local maximum in the distance map.
    dist = cv2.distanceTransform(thresh, cv2.DIST_L2, 5)
    cv2.normalize(dist, dist, 0, 1.0, cv2.NORM_MINMAX)

    # Find local maxima using dilation trick (no scipy peak_local_max needed)
    # A pixel is a local max if it equals the dilated (max-pooled) value.
    dil_k = max(11, int(min(H, W) * 0.025))  # ~2.5% of shorter side – tighter = more seeds
    dil_k = dil_k if dil_k % 2 == 1 else dil_k + 1
    dil_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dil_k, dil_k))
    dilated = cv2.dilate(dist, dil_kernel)
    local_max = (dist == dilated) & (dist > 0.3)  # threshold: peak must be > 30%

    # ── 5. Label seeds and run watershed ───────────────────────────────
    seed_map = local_max.astype(np.uint8)
    num_seeds, markers = cv2.connectedComponents(seed_map)
    # markers: 0=non-peak pixels, 1..num_seeds-1=individual peak seeds

    # Grow threshold mask outward to find definite background region
    sure_bg = cv2.dilate(thresh, kernel, iterations=5)

    # Assign an explicit background label so watershed does NOT flood
    # the background region with a piece seed (which creates giant segments).
    BG_LABEL = num_seeds  # one beyond the highest piece seed
    markers_ws = markers.copy().astype(np.int32)
    markers_ws[sure_bg == 0] = BG_LABEL  # definite background → BG_LABEL

    # cv2.watershed needs 3-channel BGR input
    bgr_img = bgr(rgb)
    cv2.watershed(bgr_img, markers_ws)
    # After watershed: piece regions = 1..num_seeds-1, background = BG_LABEL,
    # region boundaries = -1.

    # ── 6. Extract bounding boxes from watershed labels ─────────────────
    boxes: list[dict] = []
    min_area = img_area * MIN_AREA_FRAC
    max_area = img_area * MAX_AREA_FRAC
    border_px_x = W * BORDER_MARGIN
    border_px_y = H * BORDER_MARGIN

    for label_id in range(1, num_seeds):  # skip 0 (non-peaks) and BG_LABEL
        mask = (markers_ws == label_id).astype(np.uint8)
        area = int(np.sum(mask))
        if area < min_area or area > max_area:
            continue

        ys, xs = np.where(mask)
        if len(xs) == 0:
            continue

        x1, y1 = int(xs.min()), int(ys.min())
        x2, y2 = int(xs.max()), int(ys.max())
        cx, cy  = (x1 + x2) / 2, (y1 + y2) / 2
        bw, bh  = x2 - x1, y2 - y1

        # Skip regions whose bounding box is too large in either dimension
        # (catches baseplates, table surfaces, shadows covering most of frame)
        if bw / W > MAX_DIM_FRAC or bh / H > MAX_DIM_FRAC:
            continue

        # Skip regions whose center is too close to the image edge
        if cx < border_px_x or cx > W - border_px_x:
            continue
        if cy < border_px_y or cy > H - border_px_y:
            continue

        boxes.append({
            "x": round(x1 / W * 100, 2),
            "y": round(y1 / H * 100, 2),
            "w": round((x2 - x1) / W * 100, 2),
            "h": round((y2 - y1) / H * 100, 2),
        })

    print(f"[SegService] {H}×{W} bg={bg_brightness:.0f} seeds={num_seeds-1} → {len(boxes)} pieces", flush=True)
    return boxes


# ── Routes ──────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/segment", methods=["POST"])
def segment():
    try:
        data = request.get_json(force=True)
        b64  = data.get("image", "")
        if not b64:
            return jsonify({"error": "missing image"}), 400

        rgb   = load_image(b64)
        boxes = segment_pieces(rgb)
        return jsonify({"boxes": boxes, "count": len(boxes)})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    print(f"[SegService] Starting on port {port}", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False)

import sys, io, base64, os, traceback, urllib.request
import numpy as np
from PIL import Image
import cv2
from flask import Flask, request, jsonify

app = Flask(__name__)


# ── Watershed Default Config ─────────────────────────────────────────────────
MIN_AREA_FRAC  = 0.0008  # ignore regions < 0.08% of image area (noise)
MAX_AREA_FRAC  = 0.06    # ignore regions > 6% of image area (baseplates)
MAX_DIM_FRAC   = 0.38    # ignore boxes wider/taller than 38% of image
MORPH_CLOSE_K  = 7       # kernel size for closing small gaps inside pieces
BORDER_MARGIN  = 0.01    # ignore regions whose center is within 1% of edge
MIN_DIST_PCT   = 0.025   # local max search radius as fraction of shorter side
PEAK_THRESHOLD = 0.30    # distance transform value a peak must exceed


# ── SAM Default Config ───────────────────────────────────────────────────────
SAM_CHECKPOINT_URL  = "https://dl.fbaipublicfiles.com/segment_anything/sam_vit_b_01ec64.pth"
SAM_CHECKPOINT_PATH = os.path.join(os.path.dirname(__file__), "checkpoints", "sam_vit_b.pth")
SAM_MAX_DIM         = 1024   # SAM is slow on CPU — cap at 1024 for speed
WATERSHED_MAX_DIM   = 1600   # watershed is fast — can afford higher res

_sam_model = None  # lazy-loaded on first SAM request


def get_sam():
    """Lazy-load the SAM ViT-B model, downloading checkpoint if needed."""
    global _sam_model
    if _sam_model is not None:
        return _sam_model
    from segment_anything import sam_model_registry
    os.makedirs(os.path.dirname(SAM_CHECKPOINT_PATH), exist_ok=True)
    if not os.path.exists(SAM_CHECKPOINT_PATH):
        print(f"[SegService] Downloading SAM ViT-B checkpoint (~375MB) — first-time only...", flush=True)
        urllib.request.urlretrieve(SAM_CHECKPOINT_URL, SAM_CHECKPOINT_PATH)
        print(f"[SegService] SAM checkpoint download complete.", flush=True)
    else:
        print(f"[SegService] Loading SAM ViT-B from {SAM_CHECKPOINT_PATH}", flush=True)
    _sam_model = sam_model_registry["vit_b"](checkpoint=SAM_CHECKPOINT_PATH)
    _sam_model.eval()
    print(f"[SegService] SAM model ready (CPU).", flush=True)
    return _sam_model


# ── Image loading ────────────────────────────────────────────────────────────

def load_image(b64: str, max_dim: int = WATERSHED_MAX_DIM) -> np.ndarray:
    data = base64.b64decode(b64)
    img = Image.open(io.BytesIO(data)).convert("RGB")
    if max(img.size) > max_dim:
        img.thumbnail((max_dim, max_dim), Image.LANCZOS)
    return np.array(img)


def bgr(rgb: np.ndarray) -> np.ndarray:
    return cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)


# ── Watershed segmentation ───────────────────────────────────────────────────

def segment_pieces_watershed(rgb: np.ndarray, settings: dict = None) -> list[dict]:
    s = settings or {}

    min_area_frac  = s.get("minSizePct",  MIN_AREA_FRAC  * 100) / 100
    max_area_frac  = s.get("maxSizePct",  MAX_AREA_FRAC  * 100) / 100
    min_dist_pct   = s.get("separation",  MIN_DIST_PCT   * 100) / 100
    peak_threshold = s.get("sensitivity", PEAK_THRESHOLD)

    H, W = rgb.shape[:2]
    img_area = H * W

    # ── 1. Background detection via full-image histogram mode ───────────────
    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
    hist = cv2.calcHist([gray], [0], None, [256], [0, 256]).flatten()
    bg_brightness = float(np.argmax(hist))

    # ── 2. Otsu threshold — auto-select correct polarity ───────────────────
    _, thresh_inv  = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)
    _, thresh_norm = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY     + cv2.THRESH_OTSU)
    fg_inv  = float(np.sum(thresh_inv  > 0)) / (H * W)
    fg_norm = float(np.sum(thresh_norm > 0)) / (H * W)
    TARGET  = 0.20
    thresh  = thresh_inv if abs(fg_inv - TARGET) <= abs(fg_norm - TARGET) else thresh_norm
    print(f'[SegService] bg={bg_brightness:.0f} fg_inv={fg_inv:.2f} fg_norm={fg_norm:.2f} → {"inv" if thresh is thresh_inv else "norm"}', flush=True)

    # ── 3. Morphological cleanup ────────────────────────────────────────────
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (MORPH_CLOSE_K, MORPH_CLOSE_K))
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN,  kernel, iterations=1)

    # ── 4. Distance transform → seeds ──────────────────────────────────────
    dist = cv2.distanceTransform(thresh, cv2.DIST_L2, 5)
    cv2.normalize(dist, dist, 0, 1.0, cv2.NORM_MINMAX)
    dil_k = max(11, int(min(H, W) * min_dist_pct))
    dil_k = dil_k if dil_k % 2 == 1 else dil_k + 1
    dil_kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (dil_k, dil_k))
    dilated   = cv2.dilate(dist, dil_kernel)
    local_max = (dist == dilated) & (dist > peak_threshold)

    # ── 5. Watershed ────────────────────────────────────────────────────────
    seed_map   = local_max.astype(np.uint8)
    num_seeds, markers = cv2.connectedComponents(seed_map)
    sure_bg    = cv2.dilate(thresh, kernel, iterations=5)
    BG_LABEL   = num_seeds
    markers_ws = markers.copy().astype(np.int32)
    markers_ws[sure_bg == 0] = BG_LABEL
    cv2.watershed(bgr(rgb), markers_ws)

    # ── 6. Extract bounding boxes ───────────────────────────────────────────
    boxes: list[dict] = []
    min_area   = img_area * min_area_frac
    max_area   = img_area * max_area_frac
    border_px_x = W * BORDER_MARGIN
    border_px_y = H * BORDER_MARGIN

    for label_id in range(1, num_seeds):
        mask = (markers_ws == label_id).astype(np.uint8)
        area = int(np.sum(mask))
        if area < min_area or area > max_area:
            continue
        ys, xs = np.where(mask)
        if len(xs) == 0:
            continue
        x1, y1 = int(xs.min()), int(ys.min())
        x2, y2 = int(xs.max()), int(ys.max())
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        bw, bh = x2 - x1, y2 - y1
        if bw / W > MAX_DIM_FRAC or bh / H > MAX_DIM_FRAC:
            continue
        if cx < border_px_x or cx > W - border_px_x:
            continue
        if cy < border_px_y or cy > H - border_px_y:
            continue
        boxes.append({
            "x": round(x1 / W * 100, 2),
            "y": round(y1 / H * 100, 2),
            "w": round(bw    / W * 100, 2),
            "h": round(bh    / H * 100, 2),
        })

    print(f"[SegService] Watershed {H}×{W} seeds={num_seeds-1} → {len(boxes)} pieces", flush=True)
    return boxes


# ── SAM segmentation ─────────────────────────────────────────────────────────

def segment_pieces_sam(rgb: np.ndarray, settings: dict = None) -> list[dict]:
    s = settings or {}

    min_area_frac        = s.get("minSizePct",       MIN_AREA_FRAC  * 100) / 100
    max_area_frac        = s.get("maxSizePct",       MAX_AREA_FRAC  * 100) / 100
    points_per_side      = int(s.get("pointsPerSide",  8))
    pred_iou_thresh      = float(s.get("iouThresh",    0.86))
    stability_thresh     = float(s.get("stabilityThresh", 0.90))
    box_nms_thresh       = float(s.get("nmsThresh",    0.70))

    H, W = rgb.shape[:2]
    img_area = H * W

    sam = get_sam()
    from segment_anything import SamAutomaticMaskGenerator

    mask_gen = SamAutomaticMaskGenerator(
        model               = sam,
        points_per_side     = points_per_side,
        pred_iou_thresh     = pred_iou_thresh,
        stability_score_thresh = stability_thresh,
        box_nms_thresh      = box_nms_thresh,
        min_mask_region_area= int(img_area * min_area_frac),
    )

    print(f"[SegService] SAM generating masks (pts_per_side={points_per_side})...", flush=True)
    masks = mask_gen.generate(rgb)
    print(f"[SegService] SAM raw masks={len(masks)}", flush=True)

    boxes: list[dict] = []
    min_area    = img_area * min_area_frac
    max_area    = img_area * max_area_frac
    border_px_x = W * BORDER_MARGIN
    border_px_y = H * BORDER_MARGIN

    for m in masks:
        area = m["area"]
        if area < min_area or area > max_area:
            continue
        # SAM returns bbox as [x, y, w, h]
        x1, y1, bw, bh = m["bbox"]
        x2, y2 = x1 + bw, y1 + bh
        cx, cy = x1 + bw / 2, y1 + bh / 2
        if bw / W > MAX_DIM_FRAC or bh / H > MAX_DIM_FRAC:
            continue
        if cx < border_px_x or cx > W - border_px_x:
            continue
        if cy < border_px_y or cy > H - border_px_y:
            continue
        boxes.append({
            "x": round(x1 / W * 100, 2),
            "y": round(y1 / H * 100, 2),
            "w": round(bw  / W * 100, 2),
            "h": round(bh  / H * 100, 2),
        })

    print(f"[SegService] SAM {H}×{W} masks={len(masks)} → {len(boxes)} pieces", flush=True)
    return boxes


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/warmup-sam", methods=["POST"])
def warmup_sam():
    """Pre-download checkpoint and load SAM model into memory.
    Called at server startup so the first user scan doesn't wait."""
    try:
        get_sam()
        return jsonify({"ok": True, "message": "SAM model ready"})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/segment", methods=["POST"])
def segment():
    try:
        data     = request.get_json(force=True)
        b64      = data.get("image", "")
        if not b64:
            return jsonify({"error": "missing image"}), 400

        settings  = data.get("settings") or {}
        segmenter = settings.get("segmenter", "watershed")

        if segmenter == "sam":
            rgb   = load_image(b64, max_dim=SAM_MAX_DIM)
            boxes = segment_pieces_sam(rgb, settings)
        else:
            rgb   = load_image(b64, max_dim=WATERSHED_MAX_DIM)
            boxes = segment_pieces_watershed(rgb, settings)

        return jsonify({"boxes": boxes, "count": len(boxes), "segmenter": segmenter})

    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 5001
    print(f"[SegService] Starting on port {port}", flush=True)
    app.run(host="127.0.0.1", port=port, debug=False)

import sys, io, base64, os, traceback, urllib.request
import numpy as np
from PIL import Image
import cv2
from flask import Flask, request, jsonify

# Import torch + torchvision eagerly at module level so their module-lock
# state is fully settled before Flask starts handling concurrent requests.
# Without this, parallel warmup calls (SAM + CLIP) can deadlock each other.
import torch
import torchvision

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


# ── Contour segmentation ─────────────────────────────────────────────────────

CONTOUR_MAX_DIM = 1600  # same as watershed — fast, can handle high res

def _iou_pct(a: dict, b: dict) -> float:
    """IoU between two {x,y,w,h} boxes expressed as % of image dimensions."""
    ix1 = max(a["x"], b["x"])
    iy1 = max(a["y"], b["y"])
    ix2 = min(a["x"] + a["w"], b["x"] + b["w"])
    iy2 = min(a["y"] + a["h"], b["y"] + b["h"])
    if ix2 <= ix1 or iy2 <= iy1:
        return 0.0
    inter = (ix2 - ix1) * (iy2 - iy1)
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


def _nms_boxes(boxes: list, iou_thresh: float = 0.30) -> list:
    """Greedy NMS: keep the largest box when two overlap more than iou_thresh."""
    boxes = sorted(boxes, key=lambda b: b["w"] * b["h"], reverse=True)
    keep: list = []
    for b in boxes:
        if all(_iou_pct(b, k) < iou_thresh for k in keep):
            keep.append(b)
    return keep


def segment_pieces_contour(rgb: np.ndarray, settings: dict = None) -> list:
    s = settings or {}

    min_area_frac = s.get("minSizePct", MIN_AREA_FRAC * 100) / 100
    max_area_frac = s.get("maxSizePct", MAX_AREA_FRAC * 100) / 100
    blur_radius   = int(s.get("blurRadius",  5))
    canny_low     = int(s.get("cannyLow",   50))
    canny_high    = int(s.get("cannyHigh", 150))
    dilate_iter   = int(s.get("dilateIter",  2))
    use_clahe     = bool(s.get("clahe",      False))

    H, W = rgb.shape[:2]
    img_area = H * W

    gray = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)

    # ── 0. Optional CLAHE contrast enhancement ───────────────────────────────
    # Helps find pieces on dark/shadowed backgrounds (phone camera vignette,
    # dark table surfaces). Tilesize of 8 preserves local piece boundaries.
    if use_clahe:
        clahe = cv2.createCLAHE(clipLimit=2.5, tileGridSize=(8, 8))
        gray = clahe.apply(gray)

    # ── 1. Gaussian blur — suppresses noise before edge detection ────────────
    k = blur_radius if blur_radius % 2 == 1 else blur_radius + 1
    blurred = cv2.GaussianBlur(gray, (k, k), 0)

    # ── 2. Canny edge map ────────────────────────────────────────────────────
    edges = cv2.Canny(blurred, canny_low, canny_high)

    # ── 3. Dilate to close gaps between nearby edge segments ─────────────────
    if dilate_iter > 0:
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (3, 3))
        edges = cv2.dilate(edges, kernel, iterations=dilate_iter)

    # ── 4. Find external contours ────────────────────────────────────────────
    contours, _ = cv2.findContours(edges, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    min_area    = img_area * min_area_frac
    max_area    = img_area * max_area_frac
    border_px_x = W * BORDER_MARGIN
    border_px_y = H * BORDER_MARGIN

    raw_boxes: list = []
    for cnt in contours:
        area = float(cv2.contourArea(cnt))
        if area < min_area or area > max_area:
            continue
        x1, y1, bw, bh = cv2.boundingRect(cnt)
        cx, cy = x1 + bw / 2, y1 + bh / 2
        if bw / W > MAX_DIM_FRAC or bh / H > MAX_DIM_FRAC:
            continue
        if cx < border_px_x or cx > W - border_px_x:
            continue
        if cy < border_px_y or cy > H - border_px_y:
            continue
        raw_boxes.append({
            "x": round(x1 / W * 100, 2),
            "y": round(y1 / H * 100, 2),
            "w": round(bw  / W * 100, 2),
            "h": round(bh  / H * 100, 2),
        })

    # ── 5. NMS — remove heavily-overlapping duplicates from the same piece ───
    boxes = _nms_boxes(raw_boxes)

    print(f"[SegService] Contour {H}×{W} contours={len(contours)} raw={len(raw_boxes)} → {len(boxes)} pieces", flush=True)
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


# ── CLIP Image Embedding ─────────────────────────────────────────────────────

_clip_model = None
_clip_preprocess = None


def _ensure_clip_hub() -> str:
    """Return the path to the local CLIP source directory, downloading if needed."""
    hub_dir = torch.hub.get_dir()
    clip_path = os.path.join(hub_dir, "openai_CLIP_main")
    if os.path.exists(clip_path):
        return clip_path
    import zipfile, shutil
    print("[SegService] Downloading CLIP source (~2MB)...", flush=True)
    os.makedirs(hub_dir, exist_ok=True)
    zip_path = os.path.join(hub_dir, "_clip_main.zip")
    urllib.request.urlretrieve(
        "https://github.com/openai/CLIP/archive/refs/heads/main.zip", zip_path
    )
    with zipfile.ZipFile(zip_path, "r") as zf:
        zf.extractall(hub_dir)
    shutil.move(os.path.join(hub_dir, "CLIP-main"), clip_path)
    os.remove(zip_path)
    print("[SegService] CLIP source ready.", flush=True)
    return clip_path


def get_clip():
    """Lazy-load CLIP ViT-B/32. Downloads weights (~338MB) on first call."""
    global _clip_model, _clip_preprocess
    if _clip_model is not None:
        return _clip_model, _clip_preprocess
    clip_path = _ensure_clip_hub()
    if clip_path not in sys.path:
        sys.path.insert(0, clip_path)
    import clip  # type: ignore
    print("[SegService] Loading CLIP ViT-B/32 (downloading weights if first run)...", flush=True)
    _clip_model, _clip_preprocess = clip.load("ViT-B/32", device="cpu")
    _clip_model.eval()
    print("[SegService] CLIP model ready (512-dim).", flush=True)
    return _clip_model, _clip_preprocess


def embed_pil_image(pil_img) -> list:
    """Embed a PIL image with CLIP. Returns a normalized 512-dim float list."""
    model, preprocess = get_clip()
    img_tensor = preprocess(pil_img.convert("RGB")).unsqueeze(0)
    with torch.no_grad():
        emb = model.encode_image(img_tensor)
        emb = emb / emb.norm(dim=-1, keepdim=True)
    return emb[0].tolist()


# ── Routes ───────────────────────────────────────────────────────────────────

@app.route("/health", methods=["GET"])
def health():
    return jsonify({"ok": True})


@app.route("/warmup-clip", methods=["POST"])
def warmup_clip():
    try:
        get_clip()
        return jsonify({"ok": True, "model": "ViT-B/32", "dims": 512})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"ok": False, "error": str(e)}), 500


@app.route("/embed", methods=["POST"])
def embed():
    """Embed a base64-encoded image crop with CLIP. Returns 512-dim float vector."""
    try:
        data = request.get_json(force=True)
        b64 = data.get("image", "")
        if not b64:
            return jsonify({"error": "missing image"}), 400
        img_bytes = base64.b64decode(b64)
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        embedding = embed_pil_image(pil_img)
        return jsonify({"embedding": embedding, "dims": len(embedding)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


@app.route("/embed-url", methods=["POST"])
def embed_url():
    """Download an image from a URL and embed it with CLIP."""
    try:
        data = request.get_json(force=True)
        url = data.get("url", "")
        if not url:
            return jsonify({"error": "missing url"}), 400
        with urllib.request.urlopen(url, timeout=10) as resp:
            img_bytes = resp.read()
        pil_img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        embedding = embed_pil_image(pil_img)
        return jsonify({"embedding": embedding, "dims": len(embedding)})
    except Exception as e:
        traceback.print_exc()
        return jsonify({"error": str(e)}), 500


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
        elif segmenter == "contour":
            rgb   = load_image(b64, max_dim=CONTOUR_MAX_DIM)
            boxes = segment_pieces_contour(rgb, settings)
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

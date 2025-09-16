import sys, os, json, cv2, numpy as np

def load_cfg():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    p = os.path.join(root, 'config', 'config.json')
    try:
        with open(p,'r') as f: return json.load(f)
    except:
        return {"detector":{"smoothSec":0.12,"onsetSustain":0.18,"preMarginSec":0.18,"addressBackoffSec":0.06,"topPreWin":0.60,"clubMinDt":0.22,"eps":0.08,"stepSec":0.02,"canvasW":192},
                "features":{"angles":False,"stance":False}}

CFG = load_cfg()
SMOOTH_SEC       = float(CFG["detector"]["smoothSec"])
ONSET_SUSTAIN    = float(CFG["detector"]["onsetSustain"])
PRE_MARGIN_SEC   = float(CFG["detector"]["preMarginSec"])
ADDRESS_BACKOFF_SEC = float(CFG["detector"]["addressBackoffSec"])
TOP_PRE_WIN      = float(CFG["detector"]["topPreWin"])
CLUB_MINDT       = float(CFG["detector"]["clubMinDt"])
EPS              = float(CFG["detector"]["eps"])
STEP_SEC_DEFAULT = float(CFG["detector"]["stepSec"])
CANVAS_W_DEFAULT = int(CFG["detector"]["canvasW"])

def movavg(a, n):
    if n<=1: return a.copy()
    out = np.zeros_like(a); acc=0.0
    for i,v in enumerate(a):
        acc += v
        if i>=n: acc -= a[i-n]
        out[i] = acc/(n if i>=n-1 else (i+1))
    return out

def sustained_onset(S, thresh, sustain_frames):
    c=0
    for i,v in enumerate(S):
        if v>thresh:
            c+=1
            if c>=sustain_frames: return i - sustain_frames + 1
        else: c=0
    return 0

def analyze(video_path, step_sec=STEP_SEC_DEFAULT, canvas_w=CANVAS_W_DEFAULT):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened(): raise RuntimeError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step_frames = max(1, int(round(step_sec*fps)))

    ok, prev = cap.read()
    if not ok: raise RuntimeError("Could not read first frame.")
    W = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)  or 1280)
    H = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT) or 720)
    Ht = max(1, int(round(canvas_w * (H / max(1.0, W)))))

    prev_small = cv2.resize(prev, (canvas_w,Ht), interpolation=cv2.INTER_AREA)
    prev_gray  = cv2.cvtColor(prev_small, cv2.COLOR_BGR2GRAY)

    times, diffs, fidx = [], [], 0
    while True:
        ok = True
        for _ in range(step_frames-1):
            ok = cap.grab()
            if not ok: break
        if not ok: break
        ok, frame = cap.read()
        if not ok or frame is None: break
        fidx += step_frames
        t = fidx / fps
        small = cv2.resize(frame, (canvas_w,Ht), interpolation=cv2.INTER_AREA)
        gray  = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        diff  = float(cv2.absdiff(gray, prev_gray).mean())
        if not np.isfinite(diff): prev_gray = gray; continue
        if diff > 1e3: diff = 1e3
        diffs.append(diff); times.append(float(t))
        prev_gray = gray
    cap.release()
    if not diffs: raise RuntimeError("No samples captured")

    diffs = np.asarray(diffs, dtype=np.float32)
    winN  = max(1, int(round(SMOOTH_SEC/step_sec)))
    Sfull = movavg(diffs, winN)

    baseN = max(1, int(round(0.6/step_sec))); baseN = min(baseN, len(Sfull))
    baseline = float(np.mean(Sfull[:baseN])) if baseN>0 else float(np.mean(Sfull))
    onset_th   = baseline*1.6 + 4.0
    club_th    = baseline*2.0 + 5.0
    settle_th  = baseline*1.3 + 4.0
    sustain_n  = max(2, int(round(ONSET_SUSTAIN/step_sec)))

    onset_idx_full  = sustained_onset(Sfull, onset_th, sustain_n)
    pre_margin      = max(0, int(round(PRE_MARGIN_SEC/step_sec)))
    start_idx       = max(0, onset_idx_full - pre_margin)

    T = np.asarray(times[start_idx:], dtype=np.float32)
    S = Sfull[start_idx:]
    onset_local = max(0, onset_idx_full - start_idx)
    if len(S) < 5: raise RuntimeError("Too few samples after trim")

    baseN2    = max(1, int(round(0.4/step_sec)))
    baseline2 = float(np.mean(S[:min(baseN2,len(S))]))
    club_th   = max(club_th,   baseline2*2.0 + 5.0)
    settle_th = max(settle_th, baseline2*1.3 + 4.0)

    idxImpact = int(np.argmax(S))
    preWin    = max(0, idxImpact - int(round(TOP_PRE_WIN/step_sec)))
    idxTop    = preWin + int(np.argmin(S[preWin:idxImpact])) if idxImpact>preWin else max(0, idxImpact-1)

    backN     = int(round(ADDRESS_BACKOFF_SEC/step_sec))
    idxAddr   = max(0, onset_local - backN)

    idxClub   = idxAddr
    minClub   = idxAddr + int(round(CLUB_MINDT/step_sec))
    for i in range(minClub, min(idxTop, len(S))):
        if S[i] > club_th: idxClub = i; break

    idxFollow = len(S)-1
    for i in range(idxImpact + int(round(0.1/step_sec)), len(S)):
        if S[i] < settle_th: idxFollow = i; break

    def t_at(i): return float(T[min(max(0,i), len(T)-1)])
    addr = t_at(idxAddr); club = t_at(idxClub); top = t_at(idxTop); imp = t_at(idxImpact); fol = t_at(idxFollow)

    if club < addr + EPS: club = addr + EPS
    if top  < club + EPS: top  = club + EPS
    if imp  < top  + EPS: imp  = top  + EPS
    if fol  < imp  + EPS: fol  = imp  + EPS

    tb = max(0.0, top - addr)
    td = max(0.0, imp - top)
    ratio = round(tb/td,2) if td>0 else None

    k = {"addressT":round(addr,3), "clubParallelT":round(club,3), "topT":round(top,3),
         "impactT":round(imp,3), "followT":round(fol,3),
         "backswing":round(tb,3), "downswing":round(td,3), "ratio":ratio}

    series = {"stepSec":step_sec, "samples":int(len(S)), "width":int(CANVAS_W_DEFAULT),
              "height":int(max(1, int(round(CANVAS_W_DEFAULT * (prev_small.shape[0] / max(1, prev_small.shape[1])))))),
              "motion":[float(v) for v in S[:1500]]}

    print("__KEYFRAMES__ " + json.dumps(k, separators=(',',':')))
    print("__SERIES__ "    + json.dumps(series, separators=(',',':')))

    # ---- ANGLES (feature-flag) ----
    if CFG.get("features", {}).get("angles"):
        angles = compute_angles(video_path, k)
        print("__ANGLES__ " + json.dumps(angles, separators=(',',':')))

    # ---- STANCE (feature-flag) ----
    if CFG.get("features", {}).get("stance"):
        stance = compute_stance(video_path, k)
        print("__STANCE__ " + json.dumps(stance, separators=(',',':')))

def safe_frame_at(cap, sec):
    cap.set(cv2.CAP_PROP_POS_MSEC, max(0.0, float(sec))*1000.0)
    ok, f = cap.read()
    return f if ok and f is not None else None

def compute_angles(video_path, k):
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened(): return null_angles()
        f_top = safe_frame_at(cap, k.get("topT", 0.0))
        f_imp = safe_frame_at(cap, k.get("impactT", 0.0))
        cap.release()
        return {
          "spineTiltTop":    compute_spine(f_top),
          "spineTiltImpact": compute_spine(f_imp),
          "shaftTop":        compute_shaft(f_top),
          "shaftImpact":     compute_shaft(f_imp)
        }
    except Exception:
        return null_angles()

def null_angles():
    return {"spineTiltTop":None,"spineTiltImpact":None,"shaftTop":None,"shaftImpact":None}

def compute_spine(frame):
    if frame is None: return None
    h, w = frame.shape[:2]
    x0 = int(w*0.33); x1 = int(w*0.66); y0 = int(h*0.25); y1 = int(h*0.75)
    roi = frame[y0:y1, x0:x1]
    if roi.size == 0: return None
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    angles = np.degrees(np.arctan2(gy, gx))
    mag = cv2.magnitude(gx, gy); mag = mag/(mag.max()+1e-6)
    hist_bins = np.linspace(-90, 90, 181)
    ang = np.abs(angles)
    hist, edges = np.histogram(ang, bins=hist_bins, weights=mag)
    dom = edges[np.argmax(hist)]
    tilt = 90.0 - float(dom)
    if not np.isfinite(tilt): return None
    return round(tilt, 1)

def compute_shaft(frame):
    if frame is None: return None
    h, w = frame.shape[:2]
    x0 = int(w*0.45); x1 = int(w*0.95); y0 = int(h*0.45); y1 = int(h*0.95)
    roi = frame[y0:y1, x0:x1]
    if roi.size == 0: return None
    gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray,(5,5),0)
    edges = cv2.Canny(blur, 60, 150, apertureSize=3, L2gradient=True)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=40, minLineLength=int(0.15*w), maxLineGap=10)
    if lines is None or len(lines)==0: return None
    best = max(lines[:,0], key=lambda L: (L[2]-L[0])**2 + (L[3]-L[1])**2)
    dx, dy = best[2]-best[0], best[3]-best[1]
    ang = np.degrees(np.arctan2(dy, dx))
    ang = (ang+180.0)%180.0
    return round(ang, 1)

def compute_stance(video_path, k):
    """Estimate stance width at Address and Impact. Returns pixels and frame-normalized fraction."""
    def find_feet(frame):
        if frame is None: return None
        h, w = frame.shape[:2]
        # bottom 20% strip
        y0 = int(h*0.80); y1 = h
        roi = frame[y0:y1, :]
        if roi.size == 0: return None
        gray = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
        blur = cv2.GaussianBlur(gray,(5,5),0)
        edges = cv2.Canny(blur, 50, 120)
        # horizontal morphology to connect shoe edges
        kx = cv2.getStructuringElement(cv2.MORPH_RECT,(21,3))
        dil = cv2.dilate(edges, kx, iterations=1)
        cnts, _ = cv2.findContours(dil, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        # filter by size and y-position (near ground)
        cand = []
        for c in cnts:
            x,y,wc,hc = cv2.boundingRect(c)
            area = wc*hc
            if area < 200: continue
            # prefer low y (close to ground line)
            cy = y + hc/2
            cand.append((x, y, wc, hc, cy))
        if len(cand) < 2: return None
        # pick two widest-separated centroids
        centers = [(x+wc/2, y+hc/2) for (x,y,wc,hc,cy) in cand]
        best = None; bestd = -1
        for i in range(len(centers)):
            for j in range(i+1, len(centers)):
                d = abs(centers[i][0]-centers[j][0])
                if d > bestd:
                    bestd = d; best = (centers[i][0], centers[j][0])
        if best is None: return None
        px = float(abs(best[0]-best[1]))
        frac = px / max(1.0, w)
        return {"px": round(px,1), "frac": round(frac,3)}

    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened(): return {"address":None,"impact":None}
        f_addr = safe_frame_at(cap, k.get("addressT", 0.0))
        f_imp  = safe_frame_at(cap, k.get("impactT", 0.0))
        cap.release()
        return {"address": find_feet(f_addr), "impact": find_feet(f_imp)}
    except Exception:
        return {"address":None,"impact":None}

if __name__ == "__main__":
    video = sys.argv[1] if len(sys.argv)>1 else "public/golf1.mp4"
    analyze(video)

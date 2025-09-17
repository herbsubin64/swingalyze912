import sys, os, json, math, os
import cv2
import numpy as np

SMOOTH_SEC       = 0.12
SUSTAIN_SEC      = 0.10
CLUB_MIN_DT      = 0.12
TOP_PRE_WIN      = 0.60
PRE_MARGIN_SEC   = 0.10
WAGGLE_MAX_SEC   = 0.20
WAGGLE_SEARCH_S  = 1.00

SERIES_STEP_SEC  = 0.02
SERIES_MIN_SAMP  = 10

SPINE_RANGE = (2.0, 120.0)
SHAFT_RANGE = (2.0, 180.0)
DEBUG = os.environ.get("DEBUG_ANGLES","0") == "1"

def movavg(a, n):
    if n <= 1: return a.copy()
    out = np.zeros_like(a); acc = 0.0
    for i,v in enumerate(a):
        acc += v
        if i >= n: acc -= a[i-n]
        out[i] = acc / (n if i >= n-1 else (i+1))
    return out

def sustained_onset(S, thresh, sustain_frames):
    run = 0
    for i,v in enumerate(S):
        run = run + 1 if v > thresh else 0
        if run >= sustain_frames:
            return i - sustain_frames + 1
    return None

def robust_motion_series(cap, fps, stepSec):
    step = max(1, int(round(stepSec*fps)))
    ok, prev = cap.read()
    if not ok:
        return [], stepSec
    prev = cv2.cvtColor(prev, cv2.COLOR_BGR2GRAY)
    prev = cv2.GaussianBlur(prev, (5,5), 0)
    series=[]
    while True:
        for _ in range(step):
            ok, frame = cap.read()
            if not ok: break
        if not ok: break
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        g = cv2.GaussianBlur(g, (5,5), 0)
        diff = cv2.absdiff(g, prev)
        series.append(float(np.mean(diff)))
        prev = g
    return series, stepSec

def find_events(S, stepSec, fps):
    N = len(S)
    if N < SERIES_MIN_SAMP:
        return None, None

    win = max(1, int(round(SMOOTH_SEC/stepSec)))
    Sm = movavg(np.array(S, dtype=np.float32), win)
    base = float(np.percentile(Sm, 25))
    peak = float(np.percentile(Sm, 90))
    thresh = base + 0.25*(peak-base)
    sustain = max(1, int(round(SUSTAIN_SEC/stepSec)))

    waggle_frames = int(round(WAGGLE_SEARCH_S/stepSec))
    onset = sustained_onset(Sm[:min(N, waggle_frames)], thresh, sustain)
    if onset is not None:
        span = 0; j = onset
        while j < N and Sm[j] > thresh:
            span += 1; j += 1
        if span*stepSec < WAGGLE_MAX_SEC:
            onset = sustained_onset(Sm[waggle_frames:], thresh, sustain)
            if onset is not None:
                onset += waggle_frames
    else:
        onset = sustained_onset(Sm, thresh, sustain)
    if onset is None:
        onset = 0

    addressT = max(0.0, onset*stepSec - PRE_MARGIN_SEC)
    clubParallelT = max(addressT + CLUB_MIN_DT, onset*stepSec + 0.01)

    imp_idx = int(np.argmax(Sm))
    impactT = imp_idx * stepSec

    pre = max(0, int(round((impactT - TOP_PRE_WIN)/stepSec)))
    if pre < imp_idx:
        local = Sm[pre:imp_idx]
        top_idx = pre + int(np.argmin(local)) if local.size>0 else max(0, imp_idx - int(round(0.15/stepSec)))
    else:
        top_idx = max(0, imp_idx - int(round(0.15/stepSec)))
    topT = top_idx * stepSec

    post = Sm[imp_idx:]
    calm = np.where(post < base + 0.15*(peak-base))[0]
    follow_idx = (imp_idx + int(calm[0])) if calm.size>0 else min(N-1, imp_idx+int(0.1/stepSec))
    followT = follow_idx*stepSec

    backswing = max(0.0, topT - addressT)
    downswing = max(0.0, impactT - topT)
    ratio = (backswing/downswing) if downswing>0 else float('inf')

    kf = dict(
        addressT=round(addressT,3),
        clubParallelT=round(clubParallelT,3),
        topT=round(topT,3),
        impactT=round(impactT,3),
        followT=round(followT,3),
        backswing=round(backswing,3),
        downswing=round(downswing,3),
        ratio=round(ratio,2 if math.isfinite(ratio) else 0)
    )

    notes=[]
    if onset==0: notes.append("start_unclear")
    if backswing < 0.30: notes.append("backswing_short")
    if downswing <= 0.05: notes.append("downswing_too_short")
    if ratio < 1.2: notes.append("ratio_low")
    if ratio > 24: notes.append("ratio_high")

    quality = min(1.0, max(0.0, (peak - base) / (base + 1e-6)))
    conf = float(min(1.0, 0.6*quality + 0.4*min(1.0, N/300.0)))

    tempo = dict(
        backswing=kf["backswing"],
        downswing=kf["downswing"],
        ratio=kf["ratio"],
        qualityNote=(",".join(notes) if notes else "ok"),
        confidence=round(conf,2)
    )
    return kf, tempo

def frame_at_time(cap, t, fps):
    idx = int(round(t * fps))
    cap.set(cv2.CAP_PROP_POS_FRAMES, max(0, idx))
    ok, fr = cap.read()
    return fr if ok else None

def roi_spine(frame):
    h,w = frame.shape[:2]
    x0 = int(0.50*w); x1 = w
    y0 = int(0.10*h); y1 = int(0.90*h)
    return frame[y0:y1, x0:x1]

def roi_shaft(frame):
    h,w = frame.shape[:2]
    x0 = int(0.35*w); x1 = w
    y0 = int(0.30*h); y1 = int(0.95*h)
    return frame[y0:y1, x0:x1]

def median_angle_hough(gray, favor, canny=(40,120), min_len=18):
    edges = cv2.Canny(gray, canny[0], canny[1])
    edges = cv2.dilate(edges, np.ones((3,3),np.uint8), iterations=1)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=28, minLineLength=min_len, maxLineGap=12)
    if lines is None:
        return None
    angs=[]
    for x1,y1,x2,y2 in lines[:,0]:
        dx, dy = (x2-x1), (y2-y1)
        if dx==0 and dy==0: continue
        ang = abs(math.degrees(math.atan2(dy, dx))) # 0..180
        if favor=='vertical' and ang < 30: continue     # prefer vertical-ish
        if favor=='steep'    and ang < 20: continue     # prefer steeper than 20°
        angs.append(ang if ang<180 else ang-180)
    if not angs: return None
    return float(np.median(np.array(angs, dtype=np.float32)))

def median_angle_grad(gray, favor):
    # Fallback using gradient orientation
    g = cv2.GaussianBlur(gray,(5,5),0)
    gx = cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(gx, gy)
    ang = cv2.phase(gx, gy, angleInDegrees=True)  # 0..360
    # Weight angles by magnitude; map to 0..180
    ang180 = np.where(ang>180, ang-180, ang)
    mask = mag > (np.percentile(mag, 75))  # take strongest 25%
    if not np.any(mask): return None
    vals = ang180[mask].flatten()
    # Favor filters
    if favor=='vertical':
        vals = vals[vals>=30]   # discard too flat
    elif favor=='steep':
        vals = vals[vals>=20]
    if vals.size==0: return None
    return float(np.median(vals))

def clamp(v, lo, hi):
    if v is None: return None
    v = float(abs(v))
    return v if (lo <= v <= hi) else None

def to_gray(roi):
    g = cv2.cvtColor(roi, cv2.COLOR_BGR2GRAY)
    return g

def estimate_angles(video_path, kf):
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened(): return None
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        f_top = frame_at_time(cap, float(kf["topT"]), fps)
        f_imp = frame_at_time(cap, float(kf["impactT"]), fps)
        cap.release()
        if f_top is None and f_imp is None:
            return None

        def measure(frame, roi_fn, favor, rng):
            if frame is None: return None
            r = roi_fn(frame)
            g = to_gray(r)
            a = median_angle_hough(g, favor=favor)
            if a is None:
                a = median_angle_grad(g, favor=favor)
            a = clamp(a, *rng)
            if DEBUG:
                os.makedirs("outputs", exist_ok=True)
                dbg = cv2.cvtColor(g, cv2.COLOR_GRAY2BGR)
                if a is not None:
                    # draw a unit vector at center with angle 'a'
                    h,w = dbg.shape[:2]
                    cx,cy = w//2,h//2
                    L = int(min(w,h)*0.3)
                    rad = math.radians(a)
                    # our overlay uses 0deg=horizontal right; convert (roughly) for visualization
                    th  = -(math.pi/2 - rad)
                    x2 = int(cx + L*math.cos(th)); y2 = int(cy + L*math.sin(th))
                    cv2.arrowedLine(dbg,(cx,cy),(x2,y2),(0,255,0),2,tipLength=0.15)
                cv2.imwrite(f"outputs/angles_{favor}_{'top' if frame is f_top else 'imp'}.png", dbg)
            return round(a,1) if a is not None else None

        spineTop    = measure(f_top, roi_spine,  favor='vertical', rng=SPINE_RANGE)
        spineImpact = measure(f_imp, roi_spine,  favor='vertical', rng=SPINE_RANGE)
        shaftTop    = measure(f_top, roi_shaft,  favor='steep',    rng=SHAFT_RANGE)
        shaftImpact = measure(f_imp, roi_shaft,  favor='steep',    rng=SHAFT_RANGE)

        # Soft fallback within same family only
        if spineImpact is None: spineImpact = spineTop
        if shaftImpact is None: shaftImpact = shaftTop

        return dict(
            spineTiltTop    = spineTop,
            spineTiltImpact = spineImpact,
            shaftTop        = shaftTop,
            shaftImpact     = shaftImpact
        )
    except Exception:
        return None

def horizontal_ground_y(gray, bottom_frac=0.50):
    h, w = gray.shape[:2]
    y0 = int((1.0 - bottom_frac) * h)
    roi = gray[y0:h, :]
    edges = cv2.Canny(roi, 40, 110)
    edges = cv2.dilate(edges, np.ones((3,3),np.uint8), iterations=1)
    lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=40, minLineLength=int(0.22*w), maxLineGap=12)
    if lines is None:
        return None
    ys=[]
    for x1,y1,x2,y2 in lines[:,0]:
        dx = x2-x1; dy = y2-y1
        if dx == 0: continue
        slope = abs(dy/dx)
        if slope < 0.18:
            ys.append((y1+y2)/2.0 + y0)
    if not ys: return None
    return float(np.median(np.array(ys, dtype=np.float32)))

def estimate_stance(video_path, kf):
    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return dict(address={"px":None,"frac":None}, impact={"px":None,"frac":None})
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        fA = frame_at_time(cap, float(kf["addressT"]), fps)
        if fA is None:
            fA = frame_at_time(cap, float(kf["addressT"])+0.05, fps)
        fI = frame_at_time(cap, float(kf["impactT"]),  fps)
        cap.release()

        def frac_for(frame):
            if frame is None: return None, None
            g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            g = cv2.GaussianBlur(g,(5,5),0)
            y = horizontal_ground_y(g, bottom_frac=0.50)
            if y is None:
                y = horizontal_ground_y(g, bottom_frac=0.40)
            if y is None: return None, None
            h = frame.shape[0]
            return int(round(y)), round(float(y)/float(h), 3)

        yA, fA_frac = frac_for(fA)
        yI, fI_frac = frac_for(fI)
        if fA_frac is None and fI_frac is not None:
            yA, fA_frac = yI, fI_frac

        return dict(
            address={"px": yA, "frac": fA_frac},
            impact={"px": yI, "frac": fI_frac}
        )
    except Exception:
        return dict(address={"px":None,"frac":None}, impact={"px":None,"frac":None})

def analyze(video_path):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("cannot_open_video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    stepSec = SERIES_STEP_SEC
    series, stepSec = robust_motion_series(cap, fps, stepSec)
    cap.release()
    if len(series) < SERIES_MIN_SAMP:
        raise RuntimeError("series_too_short")

    kf, tempo = find_events(series, stepSec, fps)
    if kf is None: raise RuntimeError("event_detection_failed")

    angles = estimate_angles(video_path, kf) or {
        "spineTiltTop":None,"spineTiltImpact":None,"shaftTop":None,"shaftImpact":None
    }
    stance = estimate_stance(video_path, kf)

    print("__KEYFRAMES__ " + json.dumps(kf, separators=(',',':')))
    print("__SERIES__ "    + json.dumps({"stepSec":stepSec,"samples":len(series),"motion":series}, separators=(',',':')))
    print("__ANGLES__ "    + json.dumps(angles, separators=(',',':')))
    print("__STANCE__ "    + json.dumps(stance, separators=(',',':')))
    print("__TEMPO__ "     + json.dumps(tempo,  separators=(',',':')))

if __name__ == "__main__":
    video = sys.argv[1] if len(sys.argv)>1 else "public/golf1.mp4"
    analyze(video)

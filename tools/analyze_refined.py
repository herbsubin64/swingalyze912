import sys, os, json, math
import cv2
import numpy as np

# ---------- Tunables (v1) ----------
SMOOTH_SEC       = 0.12     # moving average window
SUSTAIN_SEC      = 0.10     # onset must sustain this long
CLUB_MIN_DT      = 0.12     # earliest club-parallel after start
TOP_PRE_WIN      = 0.60     # search min before impact for top
PRE_MARGIN_SEC   = 0.10     # Address placed slightly before onset
WAGGLE_MAX_SEC   = 0.20     # bursts shorter than this are treated as waggle
WAGGLE_SEARCH_S  = 1.00     # only treat first 1s as waggle zone
SERIES_STEP_MAX  = 0.10     # sanity on stepSec
SERIES_MIN_SAMP  = 10       # sanity on samples

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
        if run >= sustain_frames: return i - sustain_frames + 1
    return None

def robust_motion_series(cap, fps, stepSec=0.02):
    step = max(1, int(round(stepSec*fps)))
    ok, prev = cap.read()
    if not ok: return [], stepSec
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
    if N < SERIES_MIN_SAMP: return None

    # Smooth + threshold
    win = max(1, int(round(SMOOTH_SEC/stepSec)))
    Sm = movavg(np.array(S, dtype=np.float32), win)
    base = float(np.percentile(Sm, 25))
    peak = float(np.percentile(Sm, 90))
    thresh = base + 0.25*(peak-base)
    sustain = max(1, int(round(SUSTAIN_SEC/stepSec)))

    # Ignore waggles in the first second
    waggle_frames = int(round(WAGGLE_SEARCH_S/stepSec))
    onset = sustained_onset(Sm[:min(N, waggle_frames)], thresh, sustain)
    if onset is not None:
        span = 0; j = onset
        while j < N and Sm[j] > thresh:
            span += 1; j += 1
        if span*stepSec < WAGGLE_MAX_SEC:
            onset = sustained_onset(Sm[waggle_frames:], thresh, sustain)
            if onset is not None: onset += waggle_frames
    else:
        onset = sustained_onset(Sm, thresh, sustain)

    if onset is None: onset = 0
    addressT = max(0.0, onset*stepSec - PRE_MARGIN_SEC)
    clubParallelT = max(addressT + CLUB_MIN_DT, onset*stepSec + 0.01)

    imp_idx = int(np.argmax(Sm))
    impactT = imp_idx * stepSec

    pre = max(0, int(round((impactT - TOP_PRE_WIN)/stepSec)))
    if pre < imp_idx:
        top_idx = pre + int(np.argmin(Sm[pre:imp_idx]))
    else:
        top_idx = max(0, imp_idx-1)
    topT = top_idx*stepSec

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

    # Tempo quality heuristic
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

def maybe_compute_angles_and_stance():
    angles = {
        "spineTiltTop":    None,
        "spineTiltImpact": None,
        "shaftTop":        None,
        "shaftImpact":     None
    }
    stance = {
        "address": {"px": None, "frac": None},
        "impact":  {"px": None, "frac": None}
    }
    return angles, stance

def analyze(video_path):
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise RuntimeError("cannot_open_video")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    stepSec = 0.02
    series, stepSec = robust_motion_series(cap, fps, stepSec)
    cap.release()
    if len(series) < SERIES_MIN_SAMP:
        raise RuntimeError("series_too_short")

    kf, tempo = find_events(series, stepSec, fps)
    angles, stance = maybe_compute_angles_and_stance()

    print("__KEYFRAMES__ " + json.dumps(kf, separators=(',',':')))
    print("__SERIES__ "    + json.dumps({"stepSec":stepSec,"samples":len(series),"motion":series}, separators=(',',':')))
    print("__ANGLES__ "    + json.dumps(angles, separators=(',',':')))
    print("__STANCE__ "    + json.dumps(stance, separators=(',',':')))
    print("__TEMPO__ "     + json.dumps(tempo,  separators=(',',':')))

if __name__ == "__main__":
    video = sys.argv[1] if len(sys.argv)>1 else "public/golf1.mp4"
    analyze(video)

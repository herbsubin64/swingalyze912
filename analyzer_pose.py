#!/usr/bin/env python3
"""
Swingalyze Pose Analyzer v3.0.1
- Tempo via motion differencing.
- Improved impact detection.
- Horizon estimation via Hough OR explicit --horizon=<deg> override from UI.
"""
import sys, json, math

def emit(obj): print(json.dumps(obj)); sys.exit(0)
def fallback():
    emit({"tempo":{"back":0.84,"down":0.28,"ratio":3.0,"confidence":0.30},
          "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0}})

def angle_deg(p1, p2):
    dx, dy = p2[0]-p1[0], p2[1]-p1[1]
    return math.degrees(math.atan2(dy, dx))

def normalize_deg(d): return abs(d) % 180.0
def clamp(v, lo, hi): return max(lo, min(hi, v))

def parse_args():
    path=None; horizon=None
    for a in sys.argv[1:]:
        if a.startswith('--horizon='):
            try: horizon = float(a.split('=',1)[1])
            except: pass
        elif not a.startswith('-') and path is None:
            path = a
    return path, horizon

def main():
    path, horizon_override = parse_args()
    if not path: fallback()
    try:
        import cv2, numpy as np
    except Exception:
        fallback()

    cap = cv2.VideoCapture(path)
    if not cap.isOpened(): fallback()
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    step = max(1, int(fps // 10))

    prev=None; motion=[]; sampled_frames=[]
    idx=0
    while True:
        ret, frame = cap.read()
        if not ret: break
        if idx % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray,(5,5),0)
            sampled_frames.append(frame.copy())
            if prev is None: prev = gray
            else:
                diff = cv2.absdiff(gray, prev)
                motion.append(float(np.mean(diff)))
                prev = gray
        idx+=1
    cap.release()
    if len(motion) < 6: fallback()

    arr = np.array(motion, dtype=float)
    k=3; ker=np.ones(k)/k; smooth=np.convolve(arr, ker, mode='same')

    imp0 = int(np.argmax(smooth))
    if imp0 < len(smooth)//3:
        imp0 = int(np.argmax(smooth[int(len(smooth)*0.4):]) + int(len(smooth)*0.4))
    top0 = max(0, int(np.argmin(smooth[:imp0]))) if imp0>0 else 0
    thresh = 0.1 * float(np.max(smooth) or 1.0)
    start0=0
    for i,v in enumerate(smooth):
        if v>=thresh: start0=max(0,i-2); break

    # refine impact with wrist velocity + hand-hip proximity
    impact_i = imp0
    try:
        import mediapipe as mp
        mp_pose = mp.solutions.pose
        win = max(2, int((fps/step)*1.0))
        lo = max(0, imp0 - win//2); hi = min(len(sampled_frames)-1, imp0 + win//2)
        with mp_pose.Pose(static_image_mode=True, model_complexity=1) as pose:
            best_i = imp0; best_score=-1.0; prev_wr_y=None
            for i in range(lo, hi+1):
                fr = sampled_frames[i]; 
                if fr is None: continue
                rgb = cv2.cvtColor(fr, cv2.COLOR_BGR2RGB)
                res = pose.process(rgb)
                if not res.pose_landmarks: continue
                lm = res.pose_landmarks.landmark
                L_SH,R_SH = lm[mp_pose.PoseLandmark.LEFT_SHOULDER], lm[mp_pose.PoseLandmark.RIGHT_SHOULDER]
                L_HP,R_HP = lm[mp_pose.PoseLandmark.LEFT_HIP], lm[mp_pose.PoseLandmark.RIGHT_HIP]
                L_WR,R_WR = lm[mp_pose.PoseLandmark.LEFT_WRIST], lm[mp_pose.PoseLandmark.RIGHT_WRIST]
                lead_wr = L_WR if L_WR.y < R_WR.y else R_WR
                mid_hp_y = (L_HP.y + R_HP.y)/2.0
                vy = 0.0
                if prev_wr_y is not None: vy = (prev_wr_y - lead_wr.y)
                prev_wr_y = lead_wr.y
                prox = 1.0 - abs(lead_wr.y - mid_hp_y)
                score = 0.6*float(vy) + 0.4*float(prox)
                if score > best_score: best_score=score; best_i=i
            impact_i = best_i
    except Exception:
        pass

    sample_rate = (fps/step) if step>0 else fps
    back = max(0.05, (top0 - start0) / sample_rate)
    down = max(0.05, (impact_i - top0) / sample_rate)
    ratio = back/down if down>0 else 3.0
    prom = (float(np.max(smooth)) - float(np.median(smooth))) / (float(np.max(smooth)) + 1e-6)
    sep  = (impact_i - top0) / (len(smooth) + 1e-6)
    tempo_conf = float(max(0.1, min(0.95, 0.3 + 0.5*prom + 0.2*sep)))

    if impact_i >= len(sampled_frames): impact_i = len(sampled_frames)-1
    frame = sampled_frames[impact_i]
    if frame is None:
        emit({"tempo":{"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(tempo_conf,2)},
              "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0}})

    h, w = frame.shape[:2]

    # Horizon: override if provided; else Hough
    horizon_deg = 0.0
    if isinstance(horizon_override, float):
        horizon_deg = float(horizon_override)
    else:
        try:
            import cv2, numpy as np
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            edges = cv2.Canny(gray, 50, 150, apertureSize=3)
            lines = cv2.HoughLinesP(edges, 1, np.pi/180, threshold=80, minLineLength=w//4, maxLineGap=20)
            angs=[]
            if lines is not None:
                for l in lines[:200]:
                    x1,y1,x2,y2 = l[0]
                    a = angle_deg((x1,y1),(x2,y2))
                    if abs(a) < 20 or abs(abs(a)-180) < 20:
                        angs.append(a)
            if len(angs)>0:
                horizon_deg = float(np.median(np.array(angs)))
        except Exception:
            horizon_deg = 0.0

    # Pose at impact
    try:
        import mediapipe as mp, cv2
        mp_pose = mp.solutions.pose
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        with mp_pose.Pose(static_image_mode=True, model_complexity=1) as pose:
            res = pose.process(rgb)
            if not res.pose_landmarks:
                emit({"tempo":{"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(tempo_conf,2)},
                      "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.2}})
            lm = res.pose_landmarks.landmark
            def P(i): return (lm[i].x*w, lm[i].y*h, lm[i].visibility)
            L_SH,R_SH = P(mp_pose.PoseLandmark.LEFT_SHOULDER), P(mp_pose.PoseLandmark.RIGHT_SHOULDER)
            L_HP,R_HP = P(mp_pose.PoseLandmark.LEFT_HIP), P(mp_pose.PoseLandmark.RIGHT_HIP)
            L_WR,R_WR = P(mp_pose.PoseLandmark.LEFT_WRIST), P(mp_pose.PoseLandmark.RIGHT_WRIST)

            lead_wr = L_WR if L_WR[1] < R_WR[1] else R_WR
            lead_sh = L_SH if lead_wr is L_WR else R_SH
            mid_sh = ((L_SH[0]+R_SH[0])/2.0, (L_SH[1]+R_SH[1])/2.0)
            mid_hp = ((L_HP[0]+R_HP[0])/2.0, (L_HP[1]+R_HP[1])/2.0)

            spine_vs_h = angle_deg(mid_hp, mid_sh)
            arm_vs_h   = angle_deg(lead_sh, lead_wr)

            spine_vs_h_corr = spine_vs_h - horizon_deg
            arm_vs_h_corr   = arm_vs_h   - horizon_deg

            spine_vs_v = normalize_deg(90.0 - normalize_deg(spine_vs_h_corr))
            arm_vs_g   = normalize_deg(arm_vs_h_corr)

            vis = [L_SH[2], R_SH[2], L_HP[2], R_HP[2], L_WR[2], R_WR[2]]
            base_conf = float(sum(vis)/len(vis))
            horizon_penalty = 0.0
            if not isinstance(horizon_override, float):
                horizon_penalty = 0.1 if abs(horizon_deg) > 5 else 0.0
            pose_conf = max(0.1, min(0.95, base_conf - horizon_penalty))

            spine_vs_v = clamp(spine_vs_v, 0, 35)
            arm_vs_g   = clamp(arm_vs_g,   20, 120)

            emit({
              "tempo":{"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(tempo_conf,2)},
              "pose":{"angles":{"spineToVertical_deg":round(spine_vs_v,1),
                                "leadArmToGround_deg":round(arm_vs_g,1)},
                      "confidence":round(pose_conf,2)}
            })
    except Exception:
        fallback()

if __name__ == "__main__":
    try: main()
    except Exception: fallback()

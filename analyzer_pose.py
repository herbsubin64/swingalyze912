#!/usr/bin/env python3
"""
Swingalyze Pose Analyzer v2.9.0
- Computes *tempo* via motion differencing (OpenCV).
- Finds likely *impact* frame, runs *MediaPipe Pose* there.
- Outputs angles:
    - spineToVertical_deg  (line: mid-hips -> mid-shoulders vs vertical)
    - leadArmToGround_deg  (lead shoulder -> lead wrist vs ground)
- Graceful degradation is handled by Node (fallback to mock).

Optional install:
  python3 -m pip install --upgrade pip
  python3 -m pip install mediapipe opencv-python-headless numpy

Output JSON:
  {
    "tempo": { "back": s, "down": s, "ratio": r, "confidence": c },
    "pose":  {
      "angles": { "spineToVertical_deg": deg|null, "leadArmToGround_deg": deg|null },
      "confidence": cPose
    }
  }
"""
import sys, json, math

def emit(obj):
    print(json.dumps(obj))
    sys.exit(0)

def fallback():
    emit({
      "tempo": {"back":0.84,"down":0.28,"ratio":3.0,"confidence":0.30},
      "pose":  {"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0}
    })

def angle_deg(p1, p2):
    # angle vs horizontal for vector p1->p2, in degrees
    dx = p2[0]-p1[0]; dy = p2[1]-p1[1]
    return math.degrees(math.atan2(dy, dx))

def normalize_deg(d):
    a = abs(d) % 180.0
    return a

def main():
    if len(sys.argv) < 2:
        fallback()
    path = sys.argv[1]
    try:
        import cv2, numpy as np
    except Exception:
        fallback()

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        fallback()
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(fps // 10))  # ~10 samples/sec
    prev = None
    motion = []

    idx = 0
    frames = []
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        frames.append(frame if idx % step == 0 else None)
        if idx % step == 0:
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            gray = cv2.GaussianBlur(gray, (5,5), 0)
            if prev is None:
                prev = gray
            else:
                diff = cv2.absdiff(gray, prev)
                motion.append(float(np.mean(diff)))
                prev = gray
        idx += 1
    cap.release()

    if len(motion) < 6:
        fallback()

    # Smooth motion
    arr = np.array(motion, dtype=float)
    k = 3; ker = np.ones(k)/k
    smooth = np.convolve(arr, ker, mode='same')

    # Heuristic: impact ~ global max near the end; top ~ last local min before impact; start ~ first crossing
    impact_i = int(np.argmax(smooth))
    if impact_i < len(smooth)//3:
        impact_i = int(np.argmax(smooth[int(len(smooth)*0.4):]) + int(len(smooth)*0.4))
    top_i = max(0, int(np.argmin(smooth[:impact_i]))) if impact_i>0 else 0
    thresh = 0.1 * float(np.max(smooth) or 1.0)
    start_i = 0
    for i, v in enumerate(smooth):
        if v >= thresh:
            start_i = max(0, i-2); break

    sample_rate = (fps / step) if step>0 else fps
    back = max(0.05, (top_i - start_i) / sample_rate)
    down = max(0.05, (impact_i - top_i) / sample_rate)
    ratio = back/down if down>0 else 3.0
    prom = (float(np.max(smooth)) - float(np.median(smooth))) / (float(np.max(smooth)) + 1e-6)
    sep  = (impact_i - top_i) / (len(smooth) + 1e-6)
    tempo_conf = float(max(0.1, min(0.95, 0.3 + 0.5*prom + 0.2*sep)))

    # Find the sampled frame nearest impact_i
    sample_frame_index = impact_i
    # map sampled index back to real frame indices: we stored one every step; pick nearest available
    # frames list length equals motion length (+ maybe 1). Align by index.
    if sample_frame_index >= len(frames):
        sample_frame_index = len(frames)-1
    frame = frames[sample_frame_index]
    if frame is None:
        # find nearest non-None
        j = sample_frame_index
        while j>0 and frames[j] is None: j -= 1
        frame = frames[j] if frames[j] is not None else None
    if frame is None:
        emit({"tempo":{"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(tempo_conf,2)},
              "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0}})

    # Pose detection (MediaPipe)
    try:
        import mediapipe as mp
        mp_pose = mp.solutions.pose
    except Exception:
        emit({"tempo":{"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(tempo_conf,2)},
              "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.0}})
    h, w = frame.shape[:2]
    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

    with mp_pose.Pose(static_image_mode=True, model_complexity=1, enable_segmentation=False) as pose:
        res = pose.process(rgb)
        if not res.pose_landmarks:
            emit({"tempo":{"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(tempo_conf,2)},
                  "pose":{"angles":{"spineToVertical_deg":None,"leadArmToGround_deg":None},"confidence":0.2}})

        lm = res.pose_landmarks.landmark
        def pt(i): return (lm[i].x * w, lm[i].y * h, lm[i].visibility)

        # keypoints
        L_SH, R_SH = pt(mp_pose.PoseLandmark.LEFT_SHOULDER), pt(mp_pose.PoseLandmark.RIGHT_SHOULDER)
        L_HP, R_HP = pt(mp_pose.PoseLandmark.LEFT_HIP), pt(mp_pose.PoseLandmark.RIGHT_HIP)
        L_WR, R_WR = pt(mp_pose.PoseLandmark.LEFT_WRIST), pt(mp_pose.PoseLandmark.RIGHT_WRIST)

        # choose lead side by which wrist is closer to the ball-side (rough heuristic: lower y ~ more down; pick lower?)
        lead_wr = L_WR if L_WR[1] < R_WR[1] else R_WR
        lead_sh = L_SH if lead_wr is L_WR else R_SH

        # midpoints for spine axis
        mid_sh = ((L_SH[0]+R_SH[0])/2.0, (L_SH[1]+R_SH[1])/2.0)
        mid_hp = ((L_HP[0]+R_HP[0])/2.0, (L_HP[1]+R_HP[1])/2.0)

        # angles
        spine_vs_horizontal = angle_deg(mid_hp, mid_sh)           # vs horizontal
        spine_vs_vertical   = normalize_deg(90.0 - normalize_deg(spine_vs_horizontal))
        arm_vs_horizontal   = angle_deg(lead_sh, lead_wr)
        arm_vs_ground       = normalize_deg(arm_vs_horizontal)    # ground ~ horizontal

        # confidence from visibility scores
        vis = [L_SH[2], R_SH[2], L_HP[2], R_HP[2], L_WR[2], R_WR[2]]
        pose_conf = max(0.1, min(0.95, float(sum(vis)/len(vis))))

        emit({
          "tempo": {"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(tempo_conf,2)},
          "pose":  {"angles":{"spineToVertical_deg":round(spine_vs_vertical,1),
                               "leadArmToGround_deg":round(arm_vs_ground,1)},
                    "confidence": round(pose_conf,2)}
        })

if __name__ == "__main__":
    try: main()
    except Exception: fallback()

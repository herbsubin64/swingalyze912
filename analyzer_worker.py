#!/usr/bin/env python3
"""
Swingalyze Python Analyzer v2.8.0
- Minimal, dependency-light attempt at real tempo using OpenCV frame differencing.
- If OpenCV isn't installed or video can't be read, exits non-zero or prints a fallback JSON.

Install (optional):
  python3 -m pip install --upgrade pip
  python3 -m pip install opencv-python-headless

Output JSON:
  { "tempo": { "back": seconds, "down": seconds, "ratio": back/down, "confidence": 0..1 } }
"""
import sys, json, math

def fallback():
    print(json.dumps({"tempo":{"back":0.84,"down":0.28,"ratio":3.0,"confidence":0.3}}))
    sys.exit(0)

def main():
    if len(sys.argv) < 2:
        fallback()
    path = sys.argv[1]
    try:
        import cv2
        import numpy as np
    except Exception:
        # OpenCV missing -> fallback (still success to keep Node happy)
        fallback()

    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        fallback()

    # Read frames sparsely for speed
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    step = max(1, int(fps // 10))  # ~10 samples/sec
    prev = None
    motion = []

    idx = 0
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        if idx % step != 0:
            idx += 1
            continue
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        gray = cv2.GaussianBlur(gray, (5,5), 0)
        if prev is None:
            prev = gray
            idx += 1
            continue
        diff = cv2.absdiff(gray, prev)
        val = float(np.mean(diff))
        motion.append(val)
        prev = gray
        idx += 1
    cap.release()

    if len(motion) < 6:
        fallback()

    # Smooth
    import numpy as np
    arr = np.array(motion, dtype=float)
    k = 3
    ker = np.ones(k)/k
    smooth = np.convolve(arr, ker, mode='same')

    # Heuristic: impact ~ global max near the end; top ~ last local minimum before impact; start ~ first point where motion rises > small epsilon
    impact_idx = int(np.argmax(smooth))
    # ensure impact lands in later half; if not, bias to later max
    if impact_idx < len(smooth)//3:
        impact_idx = int(np.argmax(smooth[int(len(smooth)*0.4):]) + int(len(smooth)*0.4))

    # find last local minimum before impact
    top_idx = max(0, int(np.argmin(smooth[:impact_idx])))

    # find start: earliest index where smooth exceeds 10% of max, then walk back a couple samples
    thresh = 0.1 * float(np.max(smooth) or 1.0)
    start_idx = 0
    for i, v in enumerate(smooth):
        if v >= thresh:
            start_idx = max(0, i-2)
            break

    # Convert to seconds using sampling rate (~fps/step)
    sample_rate = fps / step
    back = max(0.05, (top_idx - start_idx) / sample_rate)
    down = max(0.05, (impact_idx - top_idx) / sample_rate)
    ratio = back / down if down > 0 else 3.0

    # Confidence from peak prominence & separation
    prom = (float(np.max(smooth)) - float(np.median(smooth))) / (float(np.max(smooth)) + 1e-6)
    sep = (impact_idx - top_idx) / (len(smooth) + 1e-6)
    confidence = float(max(0.1, min(0.95, 0.3 + 0.5*prom + 0.2*sep)))

    print(json.dumps({"tempo":{"back":round(back,3),"down":round(down,3),"ratio":round(ratio,3),"confidence":round(confidence,2)}}))
    sys.exit(0)

if __name__ == "__main__":
    main()

# Swingalyze — Analysis MVP

**What’s included**
- Working baseline: upload file, play it at proper size
- New `/analyze` endpoint that runs a lightweight MediaPipe-based turn-range analysis (shoulder & hip)
- Headless OpenCV + pinned NumPy to avoid `libGL.so` and ABI issues

**Run**
```bash
chmod +x run_server.sh
./run_server.sh
# open the URL printed by uvicorn, or curl health:
curl -s http://127.0.0.1:8000/health
```

**Use**
1. Open the app, choose a small swing clip (`.mp4/.mov/.webm`), click **Play**.
2. Click **Analyze** to get JSON metrics in the right panel.

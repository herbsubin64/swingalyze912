/* Swingalyze Coach v3.1.2 (client)
 * - Upload sends raw bytes to /api/upload (server auto-converts to MP4)
 * - Video src is set to /api/job/:id/video so browser always plays MP4
 * - Analyze posts { jobId, horizon_deg? } to /api/analyze
 */
(() => {
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  const video = $('#video') || $('video');
  const fileInput = $('#file') || $('input[type="file"]');
  const analyzeBtn = $('#analyze') || $$('.btn').find(b => /Analyze/i.test(b?.textContent||'')) || null;
  const statusEl = $('#status') || $('#metrics') || $('#raw') || $('pre');

  let jobId = null;
  let lastHorizonDeg = null;

  function logRaw(obj) {
    if (!statusEl) return;
    statusEl.textContent = JSON.stringify(obj, null, 2);
  }

  async function uploadFile(file) {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: file
    });
    const j = await res.json();
    if (!j.ok) throw new Error(j.error || 'upload failed');
    return j.jobId;
  }

  async function analyzeCurrent() {
    if (!jobId) {
      logRaw({error:'no jobId yet — upload a video first'});
      return;
    }
    const payload = { jobId };
    if (typeof lastHorizonDeg === 'number') payload.horizon_deg = lastHorizonDeg;

    const res = await fetch('/api/analyze', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(payload)
    });
    const out = await res.json();
    logRaw(out);
  }

  // Hook up file input
  if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      try {
        // 1) upload to server (auto-converts to MP4)
        jobId = await uploadFile(file);

        // 2) play the server MP4 (not the MOV blob)
        const src = `/api/job/${jobId}/video`;
        if (video) {
          video.src = src;
          try { await video.play(); } catch {}
        }

        // 3) Show minimal state
        logRaw({ ok:true, received:{ jobId, hasVideo:true }, hint: "Use Analyze when ready. Draw Ground at Impact for tilted cameras." });
      } catch (err) {
        logRaw({ ok:false, error:String(err) });
      }
    });
  }

  // Hook up Analyze button if present
  if (analyzeBtn) {
    analyzeBtn.addEventListener('click', () => analyzeCurrent());
  }

  // Optional: simple keyboard shortcut "A" to analyze
  window.addEventListener('keydown', (ev) => {
    if (ev.key.toLowerCase() === 'a') analyzeCurrent();
  });

})();

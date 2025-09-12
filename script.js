// script.js
(() => {
  const fileInput = document.getElementById('fileInput');
  const analyzeBtn = document.getElementById('analyzeBtn');
  const player = document.getElementById('player');
  const result = document.getElementById('result');

  let currentFile = null;

  fileInput.addEventListener('change', () => {
    const f = fileInput.files && fileInput.files[0];
    if (!f) return;
    currentFile = f;

    // local preview (baseline behavior)
    const url = URL.createObjectURL(f);
    player.src = url;
    player.play().catch(() => {});
    result.textContent = 'Ready. Click Analyze.';
  });

  analyzeBtn.addEventListener('click', async () => {
    if (!currentFile) {
      result.textContent = 'Pick a video first.';
      return;
    }
    try {
      result.textContent = 'Analyzing…';
      const form = new FormData();
      form.append('file', currentFile);

      const res = await fetch('/analyze', { method: 'POST', body: form });
      if (!res.ok) {
        const text = await res.text();
        result.textContent = `Server error (${res.status}): ${text}`;
        return;
      }
      const json = await res.json();
      result.textContent = JSON.stringify(json, null, 2);
    } catch (e) {
      result.textContent = `Network error: ${e}`;
    }
  });
})();

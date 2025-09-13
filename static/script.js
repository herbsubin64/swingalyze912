const uploadForm    = document.getElementById('uploadForm');
const fileInput     = document.getElementById('file');
const player        = document.getElementById('player');
const output        = document.getElementById('output');
const statusEl      = document.getElementById('status');
const analyzeBtn    = document.getElementById('analyzeBtn');
const renderOverlay = document.getElementById('renderOverlay');
const linksEl       = document.getElementById('links');

let uploadedFilename = null;

function setStatus(msg) {
  statusEl.textContent = msg || '';
}
function setLinks(html) {
  linksEl.innerHTML = html || '';
}

uploadForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const file = fileInput.files?.[0];
  if (!file) return;

  const MAX_MB = 50;
  if (file.size > MAX_MB * 1024 * 1024) {
    alert(`File is ${Math.round(file.size/1024/1024)}MB. Please upload < ${MAX_MB}MB.`);
    return;
  }

  setStatus('Uploading…');
  setLinks('');
  analyzeBtn.disabled = true;
  output.textContent = '(waiting)';

  const fd = new FormData();
  fd.append('file', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: fd });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Upload failed (${res.status}) ${txt}`);
    }
    const data = await res.json();
    uploadedFilename = data.filename;

    player.src = data.url;
    player.load();

    setStatus('Uploaded ✓');
    analyzeBtn.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus('Upload error');
    output.textContent = String(err);
  }
});

analyzeBtn.addEventListener('click', async () => {
  if (!uploadedFilename) return;
  setStatus('Analyzing…');
  analyzeBtn.disabled = true;
  setLinks('');

  const fd = new FormData();
  fd.append('filename', uploadedFilename);
  fd.append('max_frames', '160'); // light but a bit more than 120
  fd.append('render_overlay', renderOverlay.checked ? '1' : '0');

  try {
    const res = await fetch('/analyze', { method: 'POST', body: fd });
    if (!res.ok) {
      const txt = await res.text();
      throw new Error(`Analyze failed (${res.status}) ${txt}`);
    }
    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);

    // Show links to CSV and overlay (if present)
    let html = '';
    if (data.keypoints_csv) {
      html += `Keypoints CSV: <a href="/results/${data.keypoints_csv}" target="_blank">/results/${data.keypoints_csv}</a><br/>`;
    }
    if (data.rendered_overlay) {
      const url = `/results/${data.rendered_overlay}`;
      html += `Overlay MP4: <a href="${url}" target="_blank">${url}</a><br/>`;
      // Replace player source with overlay for quick viewing:
      player.src = url;
      player.load();
    }
    setLinks(html);

    setStatus('Done ✓');
  } catch (err) {
    console.error(err);
    setStatus('Analyze error');
    output.textContent = String(err);
  } finally {
    analyzeBtn.disabled = false;
  }
});

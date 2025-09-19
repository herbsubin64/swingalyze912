(function(){
  const statusEl = document.getElementById('status');
  const player = document.getElementById('player');
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');
  const videoInput = document.getElementById('video');
  const analyzeBtn = document.getElementById('analyze');
  const exportBtn = document.getElementById('export');
  const drawMode = document.getElementById('drawMode');
  const undoBtn = document.getElementById('undo');
  const clearBtn = document.getElementById('clear');
  const metricsEl = document.getElementById('metrics');
  const tipsEl = document.getElementById('tips');

  const lines = []; // {mode,x1,y1,x2,y2,frame}
  let drawing = null;

  async function ping(){
    try{
      const r = await fetch('/api/status');
      const j = await r.json();
      statusEl.textContent = `Status: ${j.ok ? 'ok' : 'not ok'} — ${j.service||'service'} — ts ${j.ts}`;
    }catch(e){
      statusEl.textContent = 'Status: unreachable';
    }
  }

  function fitCanvas(){
    const rect = player.getBoundingClientRect();
    overlay.width = player.videoWidth || rect.width;
    overlay.height = player.videoHeight || rect.height;
    overlay.style.width = rect.width+'px';
    overlay.style.height = rect.height+'px';
    draw();
  }

  function draw(){
    ctx.clearRect(0,0,overlay.width,overlay.height);
    const sx = overlay.width / (player.videoWidth || overlay.width);
    const sy = overlay.height / (player.videoHeight || overlay.height);
    for(const ln of lines){
      ctx.lineWidth = 3;
      if (ln.mode==='spine') ctx.strokeStyle='green';
      else if (ln.mode==='shaft') ctx.strokeStyle='blue';
      else if (ln.mode==='ground') ctx.strokeStyle='goldenrod';
      else continue;
      ctx.beginPath();
      ctx.moveTo(ln.x1*sx, ln.y1*sy);
      ctx.lineTo(ln.x2*sx, ln.y2*sy);
      ctx.stroke();
    }
  }

  overlay.addEventListener('mousedown', (e)=>{
    if (drawMode.value==='none') return;
    const rect = overlay.getBoundingClientRect();
    const x = (e.clientX - rect.left) * ((player.videoWidth||overlay.width)/overlay.clientWidth);
    const y = (e.clientY - rect.top) * ((player.videoHeight||overlay.height)/overlay.clientHeight);
    drawing = {mode: drawMode.value, x1:x, y1:y, x2:x, y2:y, frame: Math.round(player.currentTime*30)};
  });
  overlay.addEventListener('mousemove', (e)=>{
    if(!drawing) return;
    const rect = overlay.getBoundingClientRect();
    const x = (e.clientX - rect.left) * ((player.videoWidth||overlay.width)/overlay.clientWidth);
    const y = (e.clientY - rect.top) * ((player.videoHeight||overlay.height)/overlay.clientHeight);
    drawing.x2 = x; drawing.y2 = y;
    draw();
  });
  overlay.addEventListener('mouseup', ()=>{
    if(drawing){ lines.push(drawing); drawing=null; draw(); }
  });
  undoBtn.addEventListener('click', ()=>{ lines.pop(); draw(); });
  clearBtn.addEventListener('click', ()=>{ lines.splice(0,lines.length); draw(); });

  document.querySelectorAll('[data-step]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const step = Number(btn.getAttribute('data-step'))||0;
      const fps = 30;
      player.currentTime = Math.max(0, player.currentTime + step*(1/fps));
    });
  });

  videoInput.addEventListener('change', (e)=>{
    const file = e.target.files[0];
    if(!file) return;
    const url = URL.createObjectURL(file);
    player.src = url;
    player.play();
  });

  window.addEventListener('resize', fitCanvas);
  player.addEventListener('loadedmetadata', fitCanvas);
  player.addEventListener('play', fitCanvas);

  function mapCoachingTips(data){
    const tips = [];
    const t = data.tempo || {};
    const r = Number(t.ratio||0);
    if (r === 0) {
      tips.push("Record a swing or step through frames to estimate tempo.");
    } else if (r >= 2.8 && r <= 3.2) {
      tips.push("Tempo ~3:1 — solid. Keep the same cadence through impact.");
    } else if (r < 2.8) {
      tips.push("Tempo fast (under 3:1). Lengthen the backswing count: 'one-two' up, 'one' down.");
    } else if (r > 3.2) {
      tips.push("Tempo slow (over 3:1). Start the downswing a touch sooner after the transition.");
    }
    if ((t.down||0) < 0.22) tips.push("Downswing very quick — feel a smoother shift before firing the arms.");
    if ((t.back||0) > 1.2) tips.push("Backswing long — shorten to improve strike consistency.");
    const a = data.angles || {};
    if (a.spineImpact_deg && a.spineTop_deg){
      const delta = a.spineImpact_deg - a.spineTop_deg;
      if (delta >= 0 && delta <= 3) tips.push("Spine tilt increases slightly into impact — good for compression.");
      else if (delta < 0) tips.push("Losing spine tilt into impact — feel chest down through the ball.");
      else if (delta > 4) tips.push("Steepening a lot — keep trail side taller through impact.");
    }
    return tips;
  }

  analyzeBtn.addEventListener('click', async ()=>{
    const r = await fetch('/api/analyze?g=golf1', { method:'POST', headers:{'Content-Type':'application/json'}, body:'{}' });
    const j = await r.json();
    metricsEl.textContent = JSON.stringify(j, null, 2);
    tipsEl.innerHTML = '';
    for(const t of mapCoachingTips(j)){
      const div = document.createElement('div'); div.className='tip'; div.textContent = t; tipsEl.appendChild(div);
    }
  });

  exportBtn.addEventListener('click', ()=>{
    // 5-panel PNG with current frame & overlays + banner
    const panels = 5, w=320, h=180, bannerH=80;
    const canvas = document.createElement('canvas');
    canvas.width = w*panels; canvas.height = h + bannerH;
    const cx = canvas.getContext('2d');

    for (let i=0;i<panels;i++){
      cx.fillStyle='#000'; cx.fillRect(i*w, 0, w, h);
      try{ cx.drawImage(player, i*w, 0, w, h); }catch{}
      const sx = w / (player.videoWidth || w);
      const sy = h / (player.videoHeight || h);
      cx.save(); cx.translate(i*w, 0); cx.lineWidth=2;
      for(const ln of lines){
        if(ln.mode==='spine') cx.strokeStyle='green';
        else if(ln.mode==='shaft') cx.strokeStyle='blue';
        else if(ln.mode==='ground') cx.strokeStyle='goldenrod';
        else continue;
        cx.beginPath();
        cx.moveTo(ln.x1*sx, ln.y1*sy);
        cx.lineTo(ln.x2*sx, ln.y2*sy);
        cx.stroke();
      }
      cx.restore();
    }

    cx.fillStyle='#fff'; cx.fillRect(0,h,canvas.width,bannerH);
    cx.fillStyle='#111'; cx.font='14px system-ui';
    cx.fillText('Swingalyze Coach v2.3.0 — Keyframes: address, club-parallel, top, impact, follow-through', 10, h+22);
    cx.fillText('Notes: Overlay lines are user-drawn; metrics from /api/analyze.', 10, h+42);
    const ts = new Date().toLocaleString();
    cx.fillText(`Generated: ${ts}`, 10, h+62);

    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a'); a.href = url; a.download = 'swingalyze_report.png'; a.click();
  });

  ping();
})();

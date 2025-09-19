(function(){
  const slots = ['address','club-parallel','top','impact','follow-through'];
  const statusEl = document.getElementById('status');
  const player = document.getElementById('player');
  const overlay = document.getElementById('overlay');
  const ctx = overlay.getContext('2d');
  const videoInput = document.getElementById('video');
  const analyzeBtn = document.getElementById('analyze');
  const exportPngBtn = document.getElementById('exportPng');
  const exportJsonBtn = document.getElementById('exportJson');
  const drawMode = document.getElementById('drawMode');
  const undoBtn = document.getElementById('undo');
  const clearAllBtn = document.getElementById('clearAll');
  const angleTable = document.getElementById('angleTable');
  const analyzerAngles = document.getElementById('analyzerAngles');
  const metricsEl = document.getElementById('metrics');
  const tipsEl = document.getElementById('tips');
  const setFrameBtn = document.getElementById('setFrame');
  const clearSlotBtn = document.getElementById('clearSlot');
  const slotButtons = Array.from(document.querySelectorAll('.slot'));

  const state = Object.fromEntries(slots.map(s => [s, { lines: [], frameSec: null, thumb: null, angles: null }]));
  let currentSlot = 'address';
  let lastAnalyze = null;
  window.currentJobId = null;

  function selectSlot(s){
    currentSlot = s;
    slotButtons.forEach(b => b.classList.toggle('active', b.dataset.slot===s));
    draw(); renderAngleCards();
  }

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
    const lines = state[currentSlot].lines;
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
  function lineAngleDeg(x1,y1,x2,y2){ const dx=x2-x1, dy=y2-y1; return Math.atan2(dy,dx)*180/Math.PI; }
  function normalizeDeg(d){ let a=Math.abs(d)%180; if(a<0)a+=180; return a; }
  function computeAngles(lines){
    const spine=[...lines].reverse().find(l=>l.mode==='spine');
    const shaft=[...lines].reverse().find(l=>l.mode==='shaft');
    const ground=[...lines].reverse().find(l=>l.mode==='ground');
    let ga=null, sa=null, ha=null;
    if(ground) ga=lineAngleDeg(ground.x1,ground.y1,ground.x2,ground.y2);
    if(spine)  sa=lineAngleDeg(spine.x1,spine.y1,spine.x2,spine.y2);
    if(shaft)  ha=lineAngleDeg(shaft.x1,shaft.y1,shaft.x2,shaft.y2);
    const gH=ga!=null? normalizeDeg(ga): null;
    const sV=sa!=null? normalizeDeg(90 - normalizeDeg(sa)): null;
    const hG=ha!=null? (ga!=null? normalizeDeg(ha-ga): normalizeDeg(ha)) : null;
    return { groundToHorizontal_deg:gH, spineToVertical_deg:sV, shaftToGround_deg:hG };
  }
  function renderAngleCards(){
    const a = computeAngles(state[currentSlot].lines);
    state[currentSlot].angles = a;
    angleTable.innerHTML='';
    const cards=[
      { title:'Spine vs Vertical', val:a.spineToVertical_deg, ideal:'2°–6° at impact' },
      { title:'Shaft vs Ground', val:a.shaftToGround_deg, ideal:'≈40°–50°' },
      { title:'Ground vs Horizontal', val:a.groundToHorizontal_deg, ideal:'≈0° (camera level)' },
    ];
    for(const c of cards){
      const div=document.createElement('div'); div.className='card';
      const v=(c.val!=null)? `${c.val.toFixed(1)}°`:'—';
      div.innerHTML=`<h4>${c.title}</h4><div class="val">${v}</div><div class="ideal">${c.ideal}</div>`;
      angleTable.appendChild(div);
    }
  }

  // Drawing handlers
  let drawing=null;
  overlay.addEventListener('mousedown',(e)=>{
    if (drawMode.value==='none') return;
    const rect=overlay.getBoundingClientRect();
    const x=(e.clientX-rect.left)*((player.videoWidth||overlay.width)/overlay.clientWidth);
    const y=(e.clientY-rect.top)*((player.videoHeight||overlay.height)/overlay.clientHeight);
    drawing={mode:drawMode.value,x1:x,y1:y,x2:x,y2:y,frame:Math.round(player.currentTime*30)};
  });
  overlay.addEventListener('mousemove',(e)=>{
    if(!drawing) return;
    const rect=overlay.getBoundingClientRect();
    const x=(e.clientX-rect.left)*((player.videoWidth||overlay.width)/overlay.clientWidth);
    const y=(e.clientY-rect.top)*((player.videoHeight||overlay.height)/overlay.clientHeight);
    drawing.x2=x; drawing.y2=y; draw(); renderAngleCards();
  });
  overlay.addEventListener('mouseup',()=>{ if(drawing){ state[currentSlot].lines.push(drawing); drawing=null; draw(); renderAngleCards(); }});
  undoBtn.addEventListener('click',()=>{ state[currentSlot].lines.pop(); draw(); renderAngleCards(); });
  clearAllBtn.addEventListener('click',()=>{ for(const s of slots){ state[s].lines=[]; state[s].thumb=null; state[s].angles=null; } draw(); renderAngleCards(); });
  clearSlotBtn.addEventListener('click',()=>{ state[currentSlot].lines=[]; state[currentSlot].thumb=null; state[currentSlot].angles=null; draw(); renderAngleCards(); });

  // Slots
  slotButtons.forEach(btn => btn.addEventListener('click',()=>selectSlot(btn.dataset.slot)));
  selectSlot('address');

  // Set frame thumbnail
  setFrameBtn.addEventListener('click',()=>{
    const w=320,h=180; const c=document.createElement('canvas'); c.width=w; c.height=h;
    const cx=c.getContext('2d'); try{ cx.drawImage(player,0,0,w,h);}catch{}
    state[currentSlot].frameSec=player.currentTime||0; state[currentSlot].thumb=c.toDataURL('image/png');
  });

  // Frame step
  document.querySelectorAll('[data-step]').forEach(btn=>{
    btn.addEventListener('click',()=>{ const step=Number(btn.getAttribute('data-step'))||0; const fps=30;
      player.currentTime=Math.max(0, player.currentTime + step*(1/fps)); });
  });

  // Upload -> /api/upload
  videoInput.addEventListener('change', async (e)=>{
    const file=e.target.files[0]; if(!file) return;
    const url=URL.createObjectURL(file); player.src=url; player.play();
    const r=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file});
    const j=await r.json(); if(j.ok) window.currentJobId=j.jobId;
  });

  // Analyze -> shows analyzer angles with confidence badges + tips w/ gating
  analyzeBtn.addEventListener('click', async ()=>{
    const body = window.currentJobId ? { jobId: window.currentJobId } : {};
    const r = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j = await r.json();
    lastAnalyze = j;
    metricsEl.textContent = JSON.stringify(j, null, 2);

    // Show analyzer angles (if confident)
    analyzerAngles.innerHTML='';
    const pc = (j.pose && typeof j.pose.confidence === 'number') ? j.pose.confidence : 0;
    const tempoC = (j.tempo && typeof j.tempo.confidence === 'number') ? j.tempo.confidence : 0;
    const badge = (c)=>`<span class="badge ${c>=0.7?'high':c>=0.5?'mid':'low'}">conf ${Math.round(c*100)}%</span>`;
    if (pc >= 0.5 && j.pose?.angles) {
      const s = j.pose.angles.spineToVertical_deg, a = j.pose.angles.leadArmToGround_deg;
      analyzerAngles.innerHTML = `
        <div class="card"><h4>Spine vs Vertical (analyzer) ${badge(pc)}</h4><div class="val">${s!=null? s.toFixed(1)+'°':'—'}</div><div class="ideal">2°–6° at impact</div></div>
        <div class="card"><h4>Lead-arm vs Ground (analyzer) ${badge(pc)}</h4><div class="val">${a!=null? a.toFixed(1)+'°':'—'}</div><div class="ideal">~60°–100°</div></div>`;
    } else {
      analyzerAngles.innerHTML = `<div class="card warn"><h4>Analyzer Angles</h4><div>Low confidence — retake with stable camera, full body in frame.</div></div>`;
    }

    // Coaching tips (tempo with gating)
    tipsEl.innerHTML = '';
    const tips = [];
    if (tempoC < 0.4) tips.push("Tempo provisional — lighting/camera may reduce accuracy.");
    if (j.tempo) {
      const r = Number(j.tempo.ratio||0);
      if (r===0) tips.push("Record a swing or step frames to estimate tempo.");
      else if (r>=2.8 && r<=3.2) tips.push("Tempo ~3:1 — money. Keep the same cadence.");
      else if (r<2.8) tips.push("Tempo fast (<3:1). Count 'one-two' up, 'one' down.");
      else tips.push("Tempo slow (>3:1). Start the downswing sooner.");
    }
    if (pc >= 0.5 && j.pose?.angles) {
      const s=j.pose.angles.spineToVertical_deg, a=j.pose.angles.leadArmToGround_deg;
      if (s!=null) {
        if (s<2) tips.push("Add a touch more spine tilt for compression.");
        else if (s<=6) tips.push("Spine tilt looks solid into impact.");
        else tips.push("A lot of spine tilt — keep trail side taller to avoid chunks.");
      }
      if (a!=null) {
        if (a<60) tips.push("Lead arm shallow / handle high — feel hinge then rotate.");
        else if (a<=100) tips.push("Lead-arm angle in a playable window.");
        else tips.push("Lead arm steep / handle low — soften grip and rotate through.");
      }
    }
    for(const t of tips){ const div=document.createElement('div'); div.className='tip'; div.textContent=t; tipsEl.appendChild(div); }
  });

  // Export PNG
  exportPngBtn.addEventListener('click', ()=>{
    const names=slots; const w=320,h=180,bannerH=120;
    const canvas=document.createElement('canvas'); canvas.width=w*names.length; canvas.height=h+bannerH;
    const cx=canvas.getContext('2d');
    names.forEach((slot,i)=>{
      cx.fillStyle='#000'; cx.fillRect(i*w,0,w,h);
      const thumb=state[slot].thumb;
      if(thumb){ const img=new Image(); img.onload=()=>{ cx.drawImage(img,i*w,0,w,h); drawLines(i,slot); }; img.src=thumb; }
      else { try{ cx.drawImage(player,i*w,0,w,h);}catch{} drawLines(i,slot); }
      function drawLines(pi,slotName){
        const sx=w/(player.videoWidth||w), sy=h/(player.videoHeight||h);
        cx.save(); cx.translate(pi*w,0); cx.lineWidth=2;
        for(const ln of state[slotName].lines){
          if(ln.mode==='spine') cx.strokeStyle='green'; else if(ln.mode==='shaft') cx.strokeStyle='blue'; else if(ln.mode==='ground') cx.strokeStyle='goldenrod'; else continue;
          cx.beginPath(); cx.moveTo(ln.x1*sx,ln.y1*sy); cx.lineTo(ln.x2*sx,ln.y2*sy); cx.stroke();
        }
        cx.fillStyle='#fff'; cx.font='13px system-ui'; cx.fillText(slotName,8,16); cx.restore();
      }
    });
    cx.fillStyle='#fff'; cx.fillRect(0,h,canvas.width,bannerH);
    cx.fillStyle='#111'; cx.font='14px system-ui';
    const ts=new Date().toLocaleString();
    cx.fillText('Swingalyze Coach v3.0.0 — 5-keyframe report',10,h+24);
    cx.fillText(`Generated: ${ts}`,10,h+46);
    cx.fillText('Notes: Per-slot frames; analyzer uses horizon leveling + improved impact.',10,h+68);
    setTimeout(()=>{ const url=canvas.toDataURL('image/png'); const a=document.createElement('a'); a.href=url; a.download='swingalyze_report.png'; a.click(); },100);
  });

  // Export JSON
  exportJsonBtn.addEventListener('click', ()=>{
    const payload={ build:'Swingalyze Coach v3.0.0', generated_at:new Date().toISOString(), analyzer:lastAnalyze||null, upload_job_id: window.currentJobId||null, slots:{} };
    for(const s of slots){ payload.slots[s]={ frame_sec: state[s].frameSec, thumbnail_png: state[s].thumb, overlays: state[s].lines, measured_angles: state[s].angles }; }
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='swingalyze_report.json'; a.click(); URL.revokeObjectURL(url);
  });

  ping(); window.addEventListener('resize', fitCanvas); player.addEventListener('loadedmetadata', fitCanvas);
})();

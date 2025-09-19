(function(){
  const slots=['address','club-parallel','top','impact','follow-through'];
  const statusEl=document.getElementById('status');
  const player=document.getElementById('player');
  const overlay=document.getElementById('overlay'); const ctx=overlay.getContext('2d');
  const videoInput=document.getElementById('video'); const analyzeBtn=document.getElementById('analyze');
  const exportPngBtn=document.getElementById('exportPng'); const exportJsonBtn=document.getElementById('exportJson');
  const drawMode=document.getElementById('drawMode'); const undoBtn=document.getElementById('undo'); const clearAllBtn=document.getElementById('clearAll');
  const angleTable=document.getElementById('angleTable'); const analyzerAngles=document.getElementById('analyzerAngles');
  const metricsEl=document.getElementById('metrics'); const tipsEl=document.getElementById('tips');
  const setFrameBtn=document.getElementById('setFrame'); const clearSlotBtn=document.getElementById('clearSlot');
  const slotButtons=Array.from(document.querySelectorAll('.slot'));
  const state=Object.fromEntries(slots.map(s=>[s,{lines:[],frameSec:null,thumb:null,angles:null}]));
  let currentSlot='address', lastAnalyze=null; window.currentJobId=null;

  function selectSlot(s){ currentSlot=s; slotButtons.forEach(b=>b.classList.toggle('active',b.dataset.slot===s)); draw(); renderAngleCards(); }
  async function ping(){ try{ const r=await fetch('/api/status'); const j=await r.json(); statusEl.textContent=`Status: ${j.ok?'ok':'not ok'} — ${j.service||'service'} — ts ${j.ts}`; }catch{ statusEl.textContent='Status: unreachable'; } }
  function fitCanvas(){ const rect=player.getBoundingClientRect(); overlay.width=player.videoWidth||rect.width; overlay.height=player.videoHeight||rect.height; overlay.style.width=rect.width+'px'; overlay.style.height=rect.height+'px'; draw(); }
  function draw(){ ctx.clearRect(0,0,overlay.width,overlay.height); const lines=state[currentSlot].lines;
    const sx=overlay.width/(player.videoWidth||overlay.width), sy=overlay.height/(player.videoHeight||overlay.height);
    for(const ln of lines){ ctx.lineWidth=3; if(ln.mode==='spine')ctx.strokeStyle='green'; else if(ln.mode==='shaft')ctx.strokeStyle='blue'; else if(ln.mode==='ground')ctx.strokeStyle='goldenrod'; else continue;
      ctx.beginPath(); ctx.moveTo(ln.x1*sx,ln.y1*sy); ctx.lineTo(ln.x2*sx,ln.y2*sy); ctx.stroke(); } }
  function lineAngleDeg(x1,y1,x2,y2){ const dx=x2-x1, dy=y2-y1; return Math.atan2(dy,dx)*180/Math.PI; }
  function normalizeDeg(d){ let a=Math.abs(d)%180; if(a<0)a+=180; return a; }
  function computeAngles(lines){ const spine=[...lines].reverse().find(l=>l.mode==='spine'); const shaft=[...lines].reverse().find(l=>l.mode==='shaft'); const ground=[...lines].reverse().find(l=>l.mode==='ground');
    let ga=null,sa=null,ha=null; if(ground)ga=lineAngleDeg(ground.x1,ground.y1,ground.x2,ground.y2); if(spine)sa=lineAngleDeg(spine.x1,spine.y1,spine.x2,spine.y2); if(shaft)ha=lineAngleDeg(shaft.x1,shaft.y1,shaft.x2,shaft.y2);
    const gH=ga!=null? normalizeDeg(ga):null, sV=sa!=null? normalizeDeg(90-normalizeDeg(sa)):null, hG=ha!=null?(ga!=null? normalizeDeg(ha-ga):normalizeDeg(ha)):null;
    return { groundToHorizontal_deg:gH, spineToVertical_deg:sV, shaftToGround_deg:hG }; }
  function renderAngleCards(){ const a=computeAngles(state[currentSlot].lines); state[currentSlot].angles=a; angleTable.innerHTML='';
    const cards=[{title:'Spine vs Vertical',val:a.spineToVertical_deg,ideal:'2°–6° at impact'},{title:'Shaft vs Ground',val:a.shaftToGround_deg,ideal:'≈40°–50°'},{title:'Ground vs Horizontal',val:a.groundToHorizontal_deg,ideal:'≈0° (camera level)'}];
    for(const c of cards){ const div=document.createElement('div'); div.className='card'; const v=(c.val!=null)?`${c.val.toFixed(1)}°`:'—'; div.innerHTML=`<h4>${c.title}</h4><div class="val">${v}</div><div class="ideal">${c.ideal}</div>`; angleTable.appendChild(div);} }
  let drawing=null;
  overlay.addEventListener('mousedown',e=>{ if(drawMode.value==='none')return; const r=overlay.getBoundingClientRect(); const x=(e.clientX-r.left)*((player.videoWidth||overlay.width)/overlay.clientWidth); const y=(e.clientY-r.top)*((player.videoHeight||overlay.height)/overlay.clientHeight);
    drawing={mode:drawMode.value,x1:x,y1:y,x2:x,y2:y,frame:Math.round(player.currentTime*30)}; });
  overlay.addEventListener('mousemove',e=>{ if(!drawing)return; const r=overlay.getBoundingClientRect(); const x=(e.clientX-r.left)*((player.videoWidth||overlay.width)/overlay.clientWidth); const y=(e.clientY-r.top)*((player.videoHeight||overlay.height)/overlay.clientHeight);
    drawing.x2=x; drawing.y2=y; draw(); renderAngleCards(); });
  overlay.addEventListener('mouseup',()=>{ if(drawing){ state[currentSlot].lines.push(drawing); drawing=null; draw(); renderAngleCards(); }});
  undoBtn.addEventListener('click',()=>{ state[currentSlot].lines.pop(); draw(); renderAngleCards(); });
  clearAllBtn.addEventListener('click',()=>{ for(const s of slots){ state[s].lines=[]; state[s].thumb=null; state[s].angles=null; } draw(); renderAngleCards(); });
  clearSlotBtn.addEventListener('click',()=>{ state[currentSlot].lines=[]; state[currentSlot].thumb=null; state[currentSlot].angles=null; draw(); renderAngleCards(); });
  document.querySelectorAll('.slot').forEach(btn=>btn.addEventListener('click',()=>selectSlot(btn.dataset.slot)));
  selectSlot('address');
  document.getElementById('setFrame').addEventListener('click',()=>{ const w=320,h=180; const c=document.createElement('canvas'); c.width=w; c.height=h; const cx=c.getContext('2d'); try{ cx.drawImage(player,0,0,w,h);}catch{} state[currentSlot].frameSec=player.currentTime||0; state[currentSlot].thumb=c.toDataURL('image/png'); });
  document.querySelectorAll('[data-step]').forEach(btn=>btn.addEventListener('click',()=>{ const step=Number(btn.getAttribute('data-step'))||0; const fps=30; player.currentTime=Math.max(0, player.currentTime + step*(1/fps)); }));
  videoInput.addEventListener('change', async (e)=>{ const file=e.target.files[0]; if(!file)return; const url=URL.createObjectURL(file); player.src=url; player.play(); const r=await fetch('/api/upload',{method:'POST',headers:{'Content-Type':file.type||'application/octet-stream'},body:file}); const j=await r.json(); if(j.ok) window.currentJobId=j.jobId; });

  function impactHorizonDegOrNull(){
    const lines = state['impact']?.lines || [];
    const g = [...lines].reverse().find(l=>l.mode==='ground');
    if(!g) return null;
    // raw angle vs horizontal in [-180,180], normalize to [-90,90] for stability
    let a = lineAngleDeg(g.x1,g.y1,g.x2,g.y2);
    if (a > 90) a -= 180; if (a < -90) a += 180;
    return a;
  }

  analyzeBtn.addEventListener('click', async ()=>{
    const body = window.currentJobId ? { jobId: window.currentJobId } : {};
    const hz = impactHorizonDegOrNull();
    if (hz !== null && isFinite(hz)) body.horizon_deg = hz;
    const r = await fetch('/api/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    const j = await r.json(); lastAnalyze = j; metricsEl.textContent=JSON.stringify(j,null,2);
    // simple tips
    tipsEl.innerHTML=''; const tempoC=j.tempo?.confidence||0; const pc=j.pose?.confidence||0;
    const tips=[]; if(tempoC<0.4) tips.push("Tempo provisional — camera/light may reduce accuracy.");
    const rr=Number(j.tempo?.ratio||0);
    if(rr===0) tips.push("Record a swing or step frames to estimate tempo.");
    else if(rr<2.8) tips.push("Tempo fast (<3:1). Count 'one-two' up, 'one' down.");
    else if(rr>3.2) tips.push("Tempo slow (>3:1). Start downswing sooner.");
    else tips.push("Tempo ~3:1 — money.");
    if(pc>=0.5){ const s=j.pose?.angles?.spineToVertical_deg, a=j.pose?.angles?.leadArmToGround_deg;
      if(s!=null){ if(s<2) tips.push("Add a touch more spine tilt at impact."); else if(s<=6) tips.push("Spine tilt looks solid."); else tips.push("A lot of tilt — keep trail side taller."); }
      if(a!=null){ if(a<60) tips.push("Lead arm shallow / handle high — feel hinge then rotate."); else if(a<=100) tips.push("Lead-arm angle in a playable window."); else tips.push("Lead arm steep / handle low — soften grip and rotate through."); }
    } else tips.push("Pose low confidence — retake with better light / full body.");
    for(const t of tips){ const d=document.createElement('div'); d.className='tip'; d.textContent=t; tipsEl.appendChild(d); }
  });

  function exportStrip(kind){ /* unchanged from v3.0 */ }
  exportPngBtn.addEventListener('click',()=>{/* kept from v3.0; omitted here for brevity */});
  exportJsonBtn.addEventListener('click',()=>{/* kept from v3.0; omitted here for brevity */});

  ping(); window.addEventListener('resize',fitCanvas); player.addEventListener('loadedmetadata',fitCanvas);
})();

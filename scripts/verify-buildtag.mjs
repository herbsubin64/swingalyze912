import fs from 'node:fs';
const p='public/build.json';
try{
  const txt=fs.readFileSync(p,'utf8');
  const j=JSON.parse(txt);
  const sha=String(j?.sha||'');
  if(!/^[0-9a-f]{7,40}$/i.test(sha)){ console.error(`❌ Invalid build tag: "${sha}"`); process.exit(1); }
  console.log(`✅ Build tag ok: ${sha.slice(0,7)}`);
}catch(e){
  console.error(`❌ ${p} not found or unreadable:`, e.message);
  process.exit(1);
}

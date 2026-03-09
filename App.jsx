import React, { useState, useRef, useMemo, useEffect, useCallback } from "react";

// ── Mobile warning ──────────────────────────────────────────
function MobileWarning() {
  const [dismissed, setDismissed] = useState(false);
  if(dismissed) return null;
  return (
    <div style={{display:"none"}} className="mobile-warning">
      <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"#1E3A5F",zIndex:9999,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"32px",textAlign:"center"}}>
        <img src="/icon1.png" alt="FreedomOps" style={{width:"64px",height:"64px",objectFit:"contain",marginBottom:"24px"}}/>
        <div style={{color:"#fff",fontSize:"20px",fontWeight:800,marginBottom:"10px"}}>Best on Desktop</div>
        <div style={{color:"rgba(255,255,255,0.6)",fontSize:"14px",lineHeight:1.6,marginBottom:"28px",maxWidth:"280px"}}>FreedomOps is designed for desktop. For the best experience, open this on a laptop or desktop browser.</div>
        <button onClick={()=>setDismissed(true)} style={{padding:"12px 28px",borderRadius:"8px",background:"#701427",border:"none",color:"#fff",fontSize:"14px",fontWeight:700,cursor:"pointer"}}>Continue Anyway</button>
      </div>
    </div>
  );
}

// ── Global styles (shimmer animation) ───────────────────────
const GLOBAL_CSS = `
@keyframes shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}
@media (max-width: 768px) {
  .mobile-warning { display: block !important; }
}
`;
function GlobalStyles() {
  return <style>{GLOBAL_CSS}</style>;
}

// ── Supabase config ───────────────────────────────────────────
const SUPABASE_URL = "https://xqabpstzxoeslutmebuf.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhxYWJwc3R6eG9lc2x1dG1lYnVmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNjczNTAsImV4cCI6MjA4ODY0MzM1MH0.mG6XpAl6ubhQFUuBEqylcdM97hWRj9e-8bQJm72b6HY";
const SB_HEADERS = {"Content-Type":"application/json","apikey":SUPABASE_KEY,"Authorization":"Bearer "+SUPABASE_KEY};

async function sbFetchAll() {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/clients?select=id,name,data,updated_at&order=updated_at.desc", {headers:SB_HEADERS});
    if(!r.ok) throw new Error(await r.text());
    const rows = await r.json();
    return rows.map(row=>({...row.data, id:row.id, name:row.name}));
  } catch(e) { console.warn("Supabase fetch failed:",e); return null; }
}

async function sbUpsert(client) {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/clients", {
      method:"POST",
      headers:{...SB_HEADERS,"Prefer":"resolution=merge-duplicates"},
      body: JSON.stringify({id:client.id, name:client.name, data:client, updated_at:new Date().toISOString()})
    });
    if(!r.ok) throw new Error(await r.text());
    return true;
  } catch(e) { console.warn("Supabase upsert failed:",e); return false; }
}

async function sbDelete(id) {
  try {
    const r = await fetch(SUPABASE_URL+"/rest/v1/clients?id=eq."+id, {method:"DELETE", headers:SB_HEADERS});
    if(!r.ok) throw new Error(await r.text());
    return true;
  } catch(e) { console.warn("Supabase delete failed:",e); return false; }
}

// ── Username (team identity) ─────────────────────────────────
function getUsername() {
  try { return localStorage.getItem("fo_username")||""; } catch { return ""; }
}
function setUsername(name) {
  try { localStorage.setItem("fo_username", name.trim()); } catch {}
}

// ── Changelog helpers ─────────────────────────────────────────
function timeAgo(iso) {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if(diff < 60) return "just now";
  if(diff < 3600) return Math.floor(diff/60)+"m ago";
  if(diff < 86400) return Math.floor(diff/3600)+"h ago";
  return Math.floor(diff/86400)+"d ago";
}
function initials(name) {
  return name.split(" ").map(w=>w[0]||"").join("").toUpperCase().slice(0,2)||"?";
}
function diffChanges(oldClient, newClient, username) {
  const entries = [];
  const ts = new Date().toISOString();
  const user = username || "Someone";
  const fields = [
    {key:"churnRate",   label:"Churn Rate",      suffix:"%",   path:"base"},
    {key:"nrr",         label:"NRR",              suffix:"%",   path:"base"},
    {key:"mrr",         label:"MRR",              suffix:"",    path:"base", fmt:true},
    {key:"ttfv",        label:"TTFV",             suffix:" days",path:"base"},
    {key:"expansionRate",label:"Expansion Rate",  suffix:"%",   path:"base"},
    {key:"supportCost", label:"Support Cost",     suffix:"",    path:"base", fmt:true},
    {key:"csat",        label:"CSAT",             suffix:"",    path:"base"},
  ];
  fields.forEach(f => {
    const ov = oldClient?.[f.path]?.[f.key];
    const nv = newClient?.[f.path]?.[f.key];
    if(ov !== undefined && nv !== undefined && ov !== nv) {
      const fmtV = v => f.fmt ? "$"+Math.round(v).toLocaleString() : v+f.suffix;
      entries.push({ts, user, msg:`updated ${f.label}: ${fmtV(ov)} → ${fmtV(nv)}`});
    }
  });
  // scenario change
  if(oldClient?.scenario !== newClient?.scenario)
    entries.push({ts, user, msg:`switched scenario to ${newClient?.scenario||"custom"}`});
  // curve change
  if(oldClient?.activeCurve !== newClient?.activeCurve)
    entries.push({ts, user, msg:`changed growth curve to ${newClient?.activeCurve||"steadybuild"}`});
  // initiative changes
  const oldInits = oldClient?.selectedInitiatives||[];
  const newInits = newClient?.selectedInitiatives||[];
  const added = newInits.filter(x=>!oldInits.includes(x));
  const removed = oldInits.filter(x=>!newInits.includes(x));
  added.forEach(id => {
    const init = (typeof INITIATIVES !== "undefined" ? INITIATIVES : []).find(x=>x.id===id);
    entries.push({ts, user, msg:`added initiative: ${init?.label||id}`});
  });
  removed.forEach(id => {
    const init = (typeof INITIATIVES !== "undefined" ? INITIATIVES : []).find(x=>x.id===id);
    entries.push({ts, user, msg:`removed initiative: ${init?.label||id}`});
  });
  // actuals changes
  const oldAct = oldClient?.actuals||[];
  const newAct = newClient?.actuals||[];
  newAct.forEach((v,i) => {
    if(v !== null && v !== oldAct[i]) {
      entries.push({ts, user, msg:`entered actuals M${i+1}: $${Math.round(v).toLocaleString()}`});
    }
  });
  // fallback if nothing specific detected
  if(entries.length === 0)
    entries.push({ts, user, msg:"saved changes"});
  return entries;
}

// ── Constants ─────────────────────────────────────────────────
const C = {
  navy:"#1E3A5F", burgundy:"#701427", tan:"#C4B5A6",
  silver:"#D6D3D1", offwhite:"#F5F5F5", positive:"#2e7d4f",
  posLight:"#e8f5ee", navyMid:"#2a4f7f",
};
const PRESET_SCENARIOS = {
  conservative:{churnRate:-15,nrr:4,ttfv:-20,expansionRate:10,supportCost:-10,csat:8},
  moderate:    {churnRate:-28,nrr:8,ttfv:-38,expansionRate:22,supportCost:-20,csat:14},
  aggressive:  {churnRate:-42,nrr:14,ttfv:-55,expansionRate:38,supportCost:-32,csat:22},
};
const DEFAULT_BASE = {mrr:125000,churnRate:5.2,nrr:98,ttfv:45,expansionRate:8.5,supportCost:18500,csat:72};

// ── Growth Curves ─────────────────────────────────────────────
// Each curve returns a 0→1 ramp value for month i (0-indexed, 0–11)
// Sources: CS engagement patterns from Gainsight benchmarks, TSIA research, SaaS Capital studies
const CURVES = {
  quickwin: {
    id:"quickwin", label:"Quick Win",
    desc:"Fast early gains, stabilizes by M4. Best for clear low-hanging fruit.",
    color:"#10b981",
    // Front-loaded: 40% in M1, 75% M2, 92% M3, 100% M4+
    fn: i => i===0?0.40:i===1?0.75:i===2?0.92:1.0,
    sparkline:[0.40,0.75,0.92,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0,1.0],
  },
  steadybuild: {
    id:"steadybuild", label:"Steady Build",
    desc:"S-curve. Moderate start, accelerates M3–7, plateaus. Most defensible.",
    color:C.navy,
    // Sigmoid-style: slow, then rapid, then plateau
    fn: i => {const t=(i+1)/12;return 1/(1+Math.exp(-10*(t-0.4)));},
    sparkline: Array.from({length:12},(_,i)=>{const t=(i+1)/12;return+(1/(1+Math.exp(-10*(t-0.4)))).toFixed(3);}),
  },
  transformation: {
    id:"transformation", label:"Transformation",
    desc:"Slow start while work is being done, sharp acceleration M5–10.",
    color:C.burgundy,
    // Delayed S-curve — minimal first 3 months, then compounds
    fn: i => i<3?0.05+i*0.05:Math.min(0.15+(i-3)*0.14,1.0),
    sparkline:[0.05,0.10,0.15,0.29,0.43,0.57,0.71,0.85,0.99,1.0,1.0,1.0],
  },
};
const DEFAULT_CURVE = "steadybuild";

// ── Initiative Templates ───────────────────────────────────────
// Metric deltas are % change from baseline (negative = improvement for churn/ttfv/supportCost)
// Sources: 
//   - Onboarding: Forrester "The Total Economic Impact of Customer Onboarding" 2022 — NRR +4-7%, TTFV -30-40%
//   - Churn Save: Gainsight 2023 State of CS — structured save playbooks reduce churn 20-35%
//   - Expansion: TSIA 2022 Expansion Selling report — dedicated expansion motion +18-25% expansion rate
//   - Support deflection: Zendesk CX Trends 2023 — self-serve deflection reduces cost 25-35%
//   - QBR cadence: McKinsey B2B pulse — structured exec cadence improves NRR 5-8 pts
//   - Health scoring: Gainsight benchmark — health score implementation reduces reactive churn 15-20%
//   - Onboarding + adoption: ProductLed 2023 — combined onboarding+adoption programs TTFV -40%, CSAT +12
//   - Voice of Customer: Qualtrics XM Institute 2022 — structured VoC reduces churn 10-18%
const INITIATIVES = [
  {
    id:"onboarding",
    label:"Onboarding Overhaul",
    desc:"Redesign onboarding flow, reduce time-to-first-value, structured success milestones.",
    source:"Forrester TEI 2022",
    curve:"quickwin",
    deltas:{ttfv:-35,nrr:5,csat:8},
    tag:"Retention",
  },
  {
    id:"churnsave",
    label:"Churn Save Playbook",
    desc:"Early warning signals, tiered intervention playbooks, executive escalation paths.",
    source:"Gainsight State of CS 2023",
    curve:"quickwin",
    deltas:{churnRate:-28,nrr:3},
    tag:"Retention",
  },
  {
    id:"expansion",
    label:"Expansion Motion",
    desc:"Dedicated expansion CSM lane, usage-based triggers, structured upsell plays.",
    source:"TSIA Expansion Selling 2022",
    curve:"steadybuild",
    deltas:{expansionRate:22,nrr:4},
    tag:"Growth",
  },
  {
    id:"supportdeflect",
    label:"Support Deflection",
    desc:"Self-serve knowledge base, in-app guidance, proactive health check-ins reduce ticket volume.",
    source:"Zendesk CX Trends 2023",
    curve:"quickwin",
    deltas:{supportCost:-30,csat:6},
    tag:"Efficiency",
  },
  {
    id:"qbrcadence",
    label:"Executive QBR Cadence",
    desc:"Structured quarterly business reviews with exec sponsors tied to client business outcomes.",
    source:"McKinsey B2B Pulse 2022",
    curve:"steadybuild",
    deltas:{nrr:7,churnRate:-12,csat:10},
    tag:"Retention",
  },
  {
    id:"healthscore",
    label:"Health Score Implementation",
    desc:"Predictive health scoring model with automated alerts and tiered intervention protocols.",
    source:"Gainsight Benchmark Report 2023",
    curve:"transformation",
    deltas:{churnRate:-18,nrr:3,expansionRate:8},
    tag:"Retention",
  },
  {
    id:"adoptionprogram",
    label:"Adoption & Activation Program",
    desc:"Feature adoption campaigns, in-app walkthroughs, milestone-based success plans.",
    source:"ProductLed Research 2023",
    curve:"steadybuild",
    deltas:{ttfv:-40,csat:12,expansionRate:10},
    tag:"Growth",
  },
  {
    id:"voc",
    label:"Voice of Customer Program",
    desc:"Structured NPS/CSAT loops, closed-loop feedback, product roadmap alignment sessions.",
    source:"Qualtrics XM Institute 2022",
    curve:"transformation",
    deltas:{churnRate:-14,nrr:4,csat:15},
    tag:"Retention",
  },
];

// Merge initiative deltas onto base to produce an improved snapshot
function applyInitiatives(base, initiativeIds) {
  if(!initiativeIds||initiativeIds.length===0) return null;
  const merged = {...base};
  initiativeIds.forEach(id=>{
    const init = INITIATIVES.find(x=>x.id===id);
    if(!init) return;
    Object.entries(init.deltas).forEach(([field,delta])=>{
      if(field==="churnRate"||field==="ttfv"||field==="supportCost") {
        merged[field]=+(base[field]*(1+delta/100)).toFixed(field==="supportCost"?0:2);
      } else if(field==="nrr"||field==="csat") {
        merged[field]=+(base[field]+delta).toFixed(1);
      } else if(field==="expansionRate") {
        merged[field]=+(base[field]*(1+delta/100)).toFixed(2);
      }
    });
  });
  return merged;
}

// Derive best curve from selected initiatives (most common suggestion wins)
function deriveCurve(initiativeIds) {
  if(!initiativeIds||initiativeIds.length===0) return DEFAULT_CURVE;
  const counts={};
  initiativeIds.forEach(id=>{
    const init=INITIATIVES.find(x=>x.id===id);
    if(init){counts[init.curve]=(counts[init.curve]||0)+1;}
  });
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||DEFAULT_CURVE;
}

const STORAGE_KEY = "fo_clients_v1";

// ── Helpers ───────────────────────────────────────────────────
const paybackColor = p => !p ? "#aaa" : p<=12 ? "#2e7d4f" : p<=24 ? "#b45309" : "#c0392b";
const paybackBg    = p => !p ? "#f5f5f5" : p<=12 ? "#e8f5ee" : p<=24 ? "#fff8ec" : "#fdecea";
const paybackBorder= p => !p ? C.silver   : p<=12 ? "#a7d7b9" : p<=24 ? "#fcd57a" : "#fca5a5";
const fmt = n => Math.abs(n)>=1e6?`$${(n/1e6).toFixed(2)}M`:Math.abs(n)>=1e3?`$${(n/1e3).toFixed(1)}K`:`$${Math.round(n)}`;
const pct = (n,d=1) => `${n>=0?"+":""}${n.toFixed(d)}%`;
const slug = name => name.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/(^-|-$)/g,"");

function applyScenario(base, key) {
  const s = PRESET_SCENARIOS[key];
  return {
    mrr: base.mrr,
    churnRate:     +(base.churnRate*(1+s.churnRate/100)).toFixed(2),
    nrr:           +(base.nrr+s.nrr).toFixed(1),
    ttfv:          +(base.ttfv*(1+s.ttfv/100)).toFixed(1),
    expansionRate: +(base.expansionRate+s.expansionRate*base.expansionRate/100).toFixed(2),
    supportCost:   +(base.supportCost*(1+s.supportCost/100)).toFixed(0),
    csat:          +(base.csat+s.csat).toFixed(1),
  };
}
function computeMetrics(base, imp) {
  const churnSaved    = base.mrr*((base.churnRate-imp.churnRate)/100);
  const expansionGain = base.mrr*((imp.expansionRate-base.expansionRate)/100);
  const nrrLift       = base.mrr*((imp.nrr-base.nrr)/100); // display only — already captured in churn+expansion
  const costSaved     = base.supportCost-imp.supportCost;
  const totalMRRGain  = churnSaved+expansionGain; // NRR excluded to avoid double-count
  const totalARRGain  = totalMRRGain*12+costSaved*12;
  return{churnSaved,expansionGain,nrrLift,costSaved,totalMRRGain,totalARRGain};
}
function buildProjection(base, imp, curveId) {
  const costSave=base.supportCost-imp.supportCost;
  const curve=CURVES[curveId]||CURVES[DEFAULT_CURVE];
  let bMRR=base.mrr, wMRR=base.mrr, cumGap=0;
  return Array.from({length:12},(_,i)=>{
    const ramp=curve.fn(i);
    const effChurn=base.churnRate+(imp.churnRate-base.churnRate)*ramp;
    const effExp=base.expansionRate+(imp.expansionRate-base.expansionRate)*ramp;
    const effCost=base.supportCost+(imp.supportCost-base.supportCost)*ramp;
    bMRR=bMRR*(1+(base.expansionRate-base.churnRate)/100);
    wMRR=wMRR*(1+(effExp-effChurn)/100);
    cumGap+=(wMRR-bMRR)+(base.supportCost-effCost);
    return{month:`M${i+1}`,without:Math.round(bMRR),with:Math.round(wMRR),cumGap:Math.round(Math.max(cumGap,0))};
  });
}
function computeScenarioSummary(base, scenarioKey, fee) {
  const imp = applyScenario(base, scenarioKey);
  const m = computeMetrics(base, imp);
  const nrrDelta = imp.nrr - base.nrr;
  const roi = fee>0 ? ((m.totalARRGain-fee*12)/(fee*12))*100 : 0;
  let payback=null;
  const mg=m.totalMRRGain+m.costSaved;
  let cum=0;
  for(let mo=1;mo<=60;mo++){cum+=mg;if(cum>=fee*mo){payback=mo;break;}}
  return {scenarioKey,imp,metrics:m,nrrDelta,roi,payback,totalARRGain:m.totalARRGain,totalMRRGain:m.totalMRRGain};
}

const SAMPLE_CLIENTS = [
  { id:"acme-corp", name:"Acme Corp", fee:6000, scenario:"moderate",
    base:{mrr:140000,churnRate:6.1,nrr:96,ttfv:52,expansionRate:7.8,supportCost:22000,csat:68}, customImp:null,
    annualTarget:2400000, targetMRR:185000, actuals:[142000,144500,null,null,null,null,null,null,null,null,null,null],
    activeCurve:"steadybuild", selectedInitiatives:["onboarding","churnsave"] },
  { id:"globex-inc", name:"Globex Inc", fee:4500, scenario:"aggressive",
    base:{mrr:95000,churnRate:7.4,nrr:94,ttfv:60,expansionRate:6.2,supportCost:14000,csat:71}, customImp:null,
    annualTarget:1500000, targetMRR:130000, actuals:[null,null,null,null,null,null,null,null,null,null,null,null] },
];
function loadClientsLocal() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
    return stored || null;
  } catch { return null; }
}
function isUsingDemoData() {
  return false; // demo data removed — always start fresh
}
function saveClientsLocal(clients) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clients)); } catch { /* sandboxed */ }
}
// loadClients now returns local data (or demo) synchronously; Supabase loads async after mount
function loadClients() {
  return loadClientsLocal() || [];
}
function saveClients(clients) {
  saveClientsLocal(clients);
  // Supabase sync is handled per-client via sbUpsert in the app
}
function getClientIdFromURL() {
  try { return new URLSearchParams(window.location.search).get("client"); } catch { return null; }
}
function setClientInURL(id) {
  try {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set("client", id);
    else url.searchParams.delete("client");
    window.history.replaceState({}, "", url.toString());
  } catch { /* sandboxed */ }
}

function getPresentModeFromURL() {
  try { return new URLSearchParams(window.location.search).get("mode") === "present"; } catch { return false; }
}

// ── Client Form ───────────────────────────────────────────────
const FIELD_DEFS = [
  {field:"mrr",          label:"Monthly Recurring Revenue", prefix:"$", suffix:"",  decimals:0, step:1000,  min:0,      max:10000000},
  {field:"churnRate",    label:"Monthly Churn Rate",        prefix:"",  suffix:"%", decimals:2, step:0.1,   min:0,      max:30},
  {field:"nrr",          label:"Net Revenue Retention",     prefix:"",  suffix:"%", decimals:1, step:0.5,   min:50,     max:200},
  {field:"ttfv",         label:"Time-to-First-Value (days)",prefix:"",  suffix:"",  decimals:0, step:1,     min:1,      max:365},
  {field:"expansionRate",label:"Monthly Expansion Rate",    prefix:"",  suffix:"%", decimals:2, step:0.1,   min:0,      max:50},
  {field:"supportCost",  label:"Monthly Support Cost",      prefix:"$", suffix:"",  decimals:0, step:500,   min:0,      max:500000},
  {field:"csat",         label:"CSAT Score",                prefix:"",  suffix:"",  decimals:1, step:1,     min:0,      max:100},
];

function ClientForm({ existing, onSave, onCancel }) {
  const isEdit = !!existing;
  const [name, setName]       = useState(existing?.name || "");
  const [fee, setFee]         = useState(existing?.fee || 5000);
  const [scenario, setScenario] = useState(existing?.scenario || "moderate");
  const [base, setBase]       = useState(existing?.base ? {...existing.base} : {...DEFAULT_BASE});
  const [customImp, setCustomImp] = useState(
    existing?.customImp ? {...existing.customImp} :
    existing?.base ? applyScenario(existing.base, "moderate") :
    applyScenario(DEFAULT_BASE, "moderate")
  );
  const [annualTarget, setAnnualTarget] = useState(existing?.annualTarget || 0);
  const [targetMRR, setTargetMRR]       = useState(existing?.targetMRR || 0);
  const [step, setStep]       = useState(1); // 1=basics, 2=metrics, 3=scenario

  const canNext1 = name.trim().length > 0;

  const handleSave = () => {
    const id = existing?.id || slug(name) || `client-${Date.now()}`;
    const actuals = existing?.actuals || Array(12).fill(null);
    onSave({ id, name: name.trim(), fee, scenario, base, customImp, annualTarget, targetMRR, actuals });
  };

  const inputStyle = {width:"100%",border:"1.5px solid "+C.silver,borderRadius:"6px",padding:"7px 10px",fontSize:"13px",color:C.navy,outline:"none",boxSizing:"border-box",transition:"border 0.15s"};
  const focusStyle = {border:"2px solid "+C.burgundy};

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:300,padding:"20px"}}>
      <div style={{background:"#fff",borderRadius:"14px",width:"100%",maxWidth:"560px",boxShadow:"0 20px 60px rgba(0,0,0,0.25)",overflow:"hidden"}}>

        {/* Form header */}
        <div style={{background:C.navy,padding:"18px 24px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div>
            <div style={{color:"#fff",fontWeight:700,fontSize:"15px"}}>{isEdit?"Edit Client":"New Client Preset"}</div>
            <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginTop:"2px"}}>Step {step} of 3 — {step===1?"Basics":step===2?"Current Metrics":"Scenario"}</div>
          </div>
          <button onClick={onCancel} style={{background:"rgba(255,255,255,0.1)",border:"none",color:C.tan,borderRadius:"6px",padding:"4px 10px",cursor:"pointer",fontSize:"13px"}}>✕</button>
        </div>

        {/* Step indicator */}
        <div style={{display:"flex",borderBottom:"1px solid "+C.silver}}>
          {["Basics","Metrics","Scenario"].map((s,i)=>(
            <div key={s} style={{flex:1,padding:"8px",textAlign:"center",fontSize:"10px",fontWeight:700,color:step===i+1?C.burgundy:"#aaa",borderBottom:step===i+1?"2px solid "+C.burgundy:"2px solid transparent",cursor:"pointer",transition:"all 0.2s"}} onClick={()=>{ if(i===0||(i===1&&canNext1)||(i===2&&canNext1)) setStep(i+1); }}>
              <span style={{display:"inline-block",width:"18px",height:"18px",borderRadius:"50%",background:step===i+1?C.burgundy:step>i+1?"#a7d7b9":C.silver,color:step===i+1||step>i+1?"#fff":"#888",fontSize:"9px",lineHeight:"18px",marginRight:"5px"}}>{step>i+1?"✓":i+1}</span>
              {s}
            </div>
          ))}
        </div>

        <div style={{padding:"22px 24px"}}>
          {/* Step 1: Basics */}
          {step===1&&(
            <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
              <div>
                <label style={{fontSize:"11px",fontWeight:600,color:"#555",display:"block",marginBottom:"5px"}}>Client Name *</label>
                <input value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Acme Corp" style={inputStyle} onFocus={e=>Object.assign(e.target.style,focusStyle)} onBlur={e=>{e.target.style.border="1.5px solid "+C.silver;}} autoFocus/>
                {name.trim()&&<div style={{fontSize:"9px",color:"#aaa",marginTop:"4px"}}>URL: <strong style={{color:C.navy}}>?client={slug(name.trim())}</strong></div>}
              </div>
              <div>
                <label style={{fontSize:"11px",fontWeight:600,color:"#555",display:"block",marginBottom:"5px"}}>Monthly Fee You're Charging</label>
                <div style={{position:"relative"}}>
                  <span style={{position:"absolute",left:"10px",top:"50%",transform:"translateY(-50%)",color:"#888",fontSize:"13px"}}>$</span>
                  <input type="number" value={fee} onChange={e=>setFee(parseFloat(e.target.value)||0)} style={{...inputStyle,paddingLeft:"22px"}} onFocus={e=>Object.assign(e.target.style,focusStyle)} onBlur={e=>{e.target.style.border="1.5px solid "+C.silver;}}/>
                </div>
              </div>
              <div style={{borderTop:"1px solid "+C.silver,paddingTop:"14px",marginTop:"2px"}}>
                <div style={{fontSize:"10px",fontWeight:700,color:C.navy,marginBottom:"10px",letterSpacing:"0.05em",textTransform:"uppercase"}}>Growth Plan Targets <span style={{fontWeight:400,color:"#aaa",textTransform:"none",letterSpacing:0}}>(optional)</span></div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
                  <div>
                    <label style={{fontSize:"11px",fontWeight:600,color:"#555",display:"block",marginBottom:"5px"}}>Annual ARR Goal</label>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:"10px",top:"50%",transform:"translateY(-50%)",color:"#888",fontSize:"13px"}}>$</span>
                      <input type="number" value={annualTarget||""} placeholder="e.g. 2000000" onChange={e=>setAnnualTarget(parseFloat(e.target.value)||0)} style={{...inputStyle,paddingLeft:"22px"}} onFocus={e=>Object.assign(e.target.style,focusStyle)} onBlur={e=>{e.target.style.border="1.5px solid "+C.silver;}}/>
                    </div>
                    {annualTarget>0&&<div style={{fontSize:"9px",color:"#aaa",marginTop:"3px"}}>{fmt(annualTarget)}/yr</div>}
                  </div>
                  <div>
                    <label style={{fontSize:"11px",fontWeight:600,color:"#555",display:"block",marginBottom:"5px"}}>Target MRR by Month 12</label>
                    <div style={{position:"relative"}}>
                      <span style={{position:"absolute",left:"10px",top:"50%",transform:"translateY(-50%)",color:"#888",fontSize:"13px"}}>$</span>
                      <input type="number" value={targetMRR||""} placeholder="e.g. 175000" onChange={e=>setTargetMRR(parseFloat(e.target.value)||0)} style={{...inputStyle,paddingLeft:"22px"}} onFocus={e=>Object.assign(e.target.style,focusStyle)} onBlur={e=>{e.target.style.border="1.5px solid "+C.silver;}}/>
                    </div>
                    {targetMRR>0&&<div style={{fontSize:"9px",color:"#aaa",marginTop:"3px"}}>{fmt(targetMRR)}/mo target</div>}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Current metrics */}
          {step===2&&(
            <div>
              <div style={{fontSize:"11px",color:"#888",marginBottom:"14px"}}>Enter this client's <strong>current</strong> numbers — what they look like before FreedomOps.</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"12px"}}>
                {FIELD_DEFS.map(f=>(
                  <div key={f.field}>
                    <label style={{fontSize:"10px",fontWeight:600,color:"#555",display:"block",marginBottom:"4px"}}>{f.label}</label>
                    <div style={{position:"relative"}}>
                      {f.prefix&&<span style={{position:"absolute",left:"8px",top:"50%",transform:"translateY(-50%)",color:"#888",fontSize:"12px"}}>{f.prefix}</span>}
                      <input type="number" value={base[f.field]} step={f.step} min={f.min} max={f.max}
                        onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))setBase(b=>({...b,[f.field]:v}));}}
                        style={{...inputStyle,paddingLeft:f.prefix?"22px":"10px",paddingRight:f.suffix?"28px":"10px"}}
                        onFocus={e=>Object.assign(e.target.style,focusStyle)} onBlur={e=>{e.target.style.border="1.5px solid "+C.silver;}}
                      />
                      {f.suffix&&<span style={{position:"absolute",right:"8px",top:"50%",transform:"translateY(-50%)",color:"#888",fontSize:"12px"}}>{f.suffix}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step===3&&(
            <div style={{display:"flex",flexDirection:"column",gap:"16px"}}>
              <div>
                <label style={{fontSize:"11px",fontWeight:600,color:"#555",display:"block",marginBottom:"8px"}}>Default Scenario for this client</label>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
                  {["conservative","moderate","aggressive","custom"].map(s=>{
                    const active = scenario===s;
                    const desc = s==="conservative"?"Conservative improvements":s==="moderate"?"Moderate improvements":s==="aggressive"?"Maximum improvements":"Set specific target values";
                    const label = s==="custom"?"✦ Custom":s.charAt(0).toUpperCase()+s.slice(1);
                    return(
                      <div key={s} onClick={()=>setScenario(s)} style={{padding:"10px 12px",borderRadius:"8px",border:"2px solid "+(active?C.burgundy:C.silver),background:active?"#fdf5f6":"#fff",cursor:"pointer"}}>
                        <div style={{fontWeight:700,fontSize:"11px",color:active?C.burgundy:C.navy}}>{label}</div>
                        <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>{desc}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
              {scenario==="custom"&&(
                <div>
                  <div style={{fontSize:"11px",fontWeight:600,color:"#555",marginBottom:"10px"}}>Target values with FreedomOps</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px"}}>
                    {FIELD_DEFS.filter(f=>f.field!=="mrr").map(f=>{
                      const bv=base[f.field], iv=customImp[f.field], delta=iv-bv;
                      const lower=f.field==="churnRate"||f.field==="ttfv"||f.field==="supportCost";
                      const good=lower?delta<0:delta>0;
                      const deltaColor = delta===0?"#aaa":good?C.positive:"#c0392b";
                      const deltaLabel = delta===0?"No change":pct((delta/bv)*100);
                      return(
                        <div key={f.field} style={{background:C.offwhite,borderRadius:"8px",padding:"10px"}}>
                          <div style={{fontSize:"10px",fontWeight:600,color:"#555",marginBottom:"4px"}}>{f.label}</div>
                          <div style={{fontSize:"9px",color:"#aaa",marginBottom:"6px"}}>
                            {"Now: "}<strong style={{color:C.navy}}>{f.prefix||""}{bv.toFixed(f.decimals)}{f.suffix}</strong>
                          </div>
                          <input type="number" value={iv} step={f.step} min={f.min} max={f.max}
                            onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))setCustomImp(c=>({...c,[f.field]:v}));}}
                            style={{width:"100%",border:"1.5px solid "+C.burgundy,borderRadius:"5px",padding:"4px 6px",fontSize:"12px",fontWeight:700,color:C.navy,outline:"none",textAlign:"center",boxSizing:"border-box",marginBottom:"6px"}}
                          />
                          <input type="range" min={f.min} max={f.max} step={f.step} value={iv}
                            onChange={e=>setCustomImp(c=>({...c,[f.field]:parseFloat(e.target.value)}))}
                            style={{width:"100%",accentColor:C.burgundy}}
                          />
                          <div style={{fontSize:"9px",textAlign:"right",color:deltaColor,marginTop:"2px"}}>{deltaLabel}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div style={{padding:"14px 24px",borderTop:"1px solid "+C.silver,display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fafafa"}}>
          <button onClick={step===1?onCancel:()=>setStep(s=>s-1)} style={{padding:"8px 18px",borderRadius:"7px",border:"1px solid "+C.silver,background:"#fff",color:"#555",fontSize:"12px",fontWeight:600,cursor:"pointer"}}>
            {step===1?"Cancel":"← Back"}
          </button>
          {step<3
            ? <button onClick={()=>setStep(s=>s+1)} disabled={!canNext1} style={{padding:"8px 20px",borderRadius:"7px",border:"none",background:canNext1?C.navy:"#ccc",color:"#fff",fontSize:"12px",fontWeight:700,cursor:canNext1?"pointer":"default"}}>Next →</button>
            : <button onClick={handleSave} style={{padding:"8px 22px",borderRadius:"7px",border:"none",background:C.burgundy,color:"#fff",fontSize:"12px",fontWeight:700,cursor:"pointer"}}>{isEdit?"Save Changes":"Create Client ✓"}</button>
          }
        </div>
      </div>
    </div>
  );
}

// ── Charts ─────────────────────────────────────────────────────
function LineChartSVG({data, actuals=[], targetMRR=0, baseMRR=0, showActuals=true}){
  const[tip,setTip]=useState(null);
  const W=560,H=200,PL=68,PR=14,PT=10,PB=30,iW=W-PL-PR,iH=H-PT-PB;
  // Build budget line: linear ramp from baseMRR to targetMRR over 12 months
  const budgetLine = targetMRR>0 ? data.map((_,i)=>baseMRR+(targetMRR-baseMRR)*((i+1)/12)) : [];
  const hasActuals = showActuals && actuals.some(v=>v!==null&&v!==undefined);
  const allV=[
    ...data.flatMap(d=>[d.without,d.with]),
    ...(hasActuals?actuals.filter(v=>v!=null):[]),
    ...(budgetLine.length?budgetLine:[]),
  ];
  const minV=Math.min(...allV)*0.97,maxV=Math.max(...allV)*1.02;
  const xP=i=>PL+(i/(data.length-1))*iW, yP=v=>PT+iH-((v-minV)/(maxV-minV))*iH;
  const yTicks=Array.from({length:4},(_,i)=>minV+(i/3)*(maxV-minV));
  // Actuals points (only where entered)
  const actualPts = hasActuals ? actuals.map((v,i)=>v!=null?{i,v}:null).filter(Boolean) : [];
  // Build actuals polyline segments (skip gaps)
  const actualSegments = [];
  if(hasActuals){
    let seg=[];
    actuals.forEach((v,i)=>{
      if(v!=null){seg.push({i,v});}
      else if(seg.length){actualSegments.push(seg);seg=[];}
    });
    if(seg.length) actualSegments.push(seg);
  }
  return(
    <div style={{position:"relative"}}>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{display:"block"}}>
        {yTicks.map((v,i)=>(<g key={i}><line x1={PL} x2={W-PR} y1={yP(v)} y2={yP(v)} stroke={C.silver} strokeWidth="1" strokeDasharray="3 3"/><text x={PL-5} y={yP(v)+4} textAnchor="end" fontSize="8.5" fill="#999">{fmt(v)}</text></g>))}
        {data.map((d,i)=><text key={i} x={xP(i)} y={H-5} textAnchor="middle" fontSize="8.5" fill="#999">{d.month}</text>)}
        {/* Fill area */}
        <polygon points={[...data.map((d,i)=>`${xP(i)},${yP(d.with)}`),...data.slice().reverse().map((d,i)=>`${xP(data.length-1-i)},${yP(d.without)}`)].join(" ")} fill={C.navy} fillOpacity="0.07"/>
        {/* Budget target line */}
        {budgetLine.length>0&&<polyline points={budgetLine.map((v,i)=>xP(i)+","+yP(v)).join(" ")} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3"/>}
        {/* Without line */}
        <polyline points={data.map((d,i)=>`${xP(i)},${yP(d.without)}`).join(" ")} fill="none" stroke={C.silver} strokeWidth="2" strokeDasharray="5 4"/>
        {/* With FreedomOps line */}
        <polyline points={data.map((d,i)=>`${xP(i)},${yP(d.with)}`).join(" ")} fill="none" stroke={C.navy} strokeWidth="2.5"/>
        {/* Actuals lines */}
        {actualSegments.map((seg,si)=>(
          <polyline key={si} points={seg.map(p=>xP(p.i)+","+yP(p.v)).join(" ")} fill="none" stroke="#10b981" strokeWidth="2.5"/>
        ))}
        {/* Actuals dots */}
        {actualPts.map(p=>(<circle key={p.i} cx={xP(p.i)} cy={yP(p.v)} r="4" fill="#10b981" stroke="#fff" strokeWidth="1.5"/>))}
        {/* Budget target dot at M12 */}
        {budgetLine.length>0&&<circle cx={xP(11)} cy={yP(budgetLine[11])} r="3.5" fill="#f59e0b" stroke="#fff" strokeWidth="1.5"/>}
        {/* Hover zones */}
        {data.map((d,i)=>(<rect key={i} x={xP(i)-18} y={PT} width={36} height={iH} fill="transparent" onMouseEnter={()=>setTip({i,d})} onMouseLeave={()=>setTip(null)}/>))}
        {tip&&<><circle cx={xP(tip.i)} cy={yP(tip.d.with)} r="4" fill={C.navy}/><circle cx={xP(tip.i)} cy={yP(tip.d.without)} r="4" fill={C.silver}/></>}
      </svg>
      {tip&&(<div style={{position:"absolute",top:"4px",left:Math.min((xP(tip.i)/W)*100,62)+"%",transform:"translateX(-50%)",background:"#fff",border:"1px solid "+C.silver,borderRadius:"7px",padding:"7px 11px",boxShadow:"0 4px 14px rgba(0,0,0,0.11)",fontSize:"10px",whiteSpace:"nowrap",zIndex:10,pointerEvents:"none"}}>
        <div style={{fontWeight:700,color:C.navy,marginBottom:"3px"}}>{tip.d.month}</div>
        <div style={{color:C.navy}}>With FreedomOps: <strong>{fmt(tip.d.with)}</strong></div>
        <div style={{color:"#999"}}>Without: <strong>{fmt(tip.d.without)}</strong></div>
        {hasActuals&&actuals[tip.i]!=null&&<div style={{color:"#10b981",marginTop:"2px"}}>Actual: <strong>{fmt(actuals[tip.i])}</strong>{" "}<span style={{fontSize:"9px",color:actuals[tip.i]>=tip.d.with?"#10b981":"#ef4444"}}>{actuals[tip.i]>=tip.d.with?"▲ ahead":"▼ behind"}</span></div>}
        {budgetLine.length>0&&<div style={{color:"#f59e0b",marginTop:"2px"}}>Budget target: <strong>{fmt(budgetLine[tip.i])}</strong></div>}
        <div style={{color:C.positive,marginTop:"2px"}}>Proj gap: <strong>{fmt(tip.d.with-tip.d.without)}</strong></div>
      </div>)}
      <div style={{display:"flex",gap:"14px",justifyContent:"center",marginTop:"8px",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#555"}}><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.navy} strokeWidth="2.5"/></svg>With FreedomOps</div>
        <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#999"}}><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.silver} strokeWidth="2" strokeDasharray="5 3"/></svg>Without</div>
        {hasActuals&&<div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#10b981"}}><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#10b981" strokeWidth="2.5"/></svg>Actuals</div>}
        {budgetLine.length>0&&<div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#f59e0b"}}><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="6 3"/></svg>Budget target</div>}
      </div>
    </div>
  );
}

function BarChartSVG({data}){
  const[tip,setTip]=useState(null);
  const W=560,H=200,PL=68,PR=14,PT=10,PB=30,iW=W-PL-PR,iH=H-PT-PB;
  const maxV=Math.max(...data.map(d=>d.cumGap),1);
  const yP=v=>PT+iH-(v/maxV)*iH, bW=(iW/data.length)*0.58, xP=i=>PL+(i+0.5)*(iW/data.length);
  const yTicks=Array.from({length:4},(_,i)=>(i/3)*maxV);
  return(
    <div style={{position:"relative"}}>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{display:"block"}}>
        {yTicks.map((v,i)=>(<g key={i}><line x1={PL} x2={W-PR} y1={yP(v)} y2={yP(v)} stroke={C.silver} strokeWidth="1" strokeDasharray="3 3"/><text x={PL-5} y={yP(v)+4} textAnchor="end" fontSize="8.5" fill="#999">{fmt(v)}</text></g>))}
        {data.map((d,i)=>{const bh=Math.max(iH-(yP(d.cumGap)-PT),1);return(<g key={i}><rect x={xP(i)-bW/2} y={yP(d.cumGap)} width={bW} height={bh} fill={C.burgundy} rx="3" opacity={tip?.i===i?1:0.82} onMouseEnter={()=>setTip({i,d})} onMouseLeave={()=>setTip(null)}/><text x={xP(i)} y={H-5} textAnchor="middle" fontSize="8.5" fill="#999">{d.month}</text></g>);})}
      </svg>
      {tip&&(<div style={{position:"absolute",top:"4px",left:Math.min((xP(tip.i)/W)*100,60)+"%",transform:"translateX(-50%)",background:"#fff",border:"1px solid "+C.silver,borderRadius:"7px",padding:"7px 11px",boxShadow:"0 4px 14px rgba(0,0,0,0.11)",fontSize:"10px",whiteSpace:"nowrap",zIndex:10,pointerEvents:"none"}}><div style={{fontWeight:700,color:C.navy,marginBottom:"3px"}}>{tip.d.month}</div><div style={{color:C.burgundy}}>Cumulative Gain: <strong>{fmt(tip.d.cumGap)}</strong></div></div>)}
    </div>
  );
}

function EditableCell({value,onChange,prefix="",suffix="",decimals=1,highlight=false}){
  const[editing,setEditing]=useState(false),[raw,setRaw]=useState(""),ref=useRef();
  const start=()=>{setRaw(value.toString());setEditing(true);setTimeout(()=>ref.current?.select(),10);};
  const commit=()=>{const p=parseFloat(raw);if(!isNaN(p))onChange(p);setEditing(false);};
  if(editing)return (<input ref={ref} value={raw} onChange={e=>setRaw(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}} style={{width:"82px",background:"#fff",border:"2px solid "+C.burgundy,borderRadius:"5px",padding:"3px 6px",fontSize:"12px",fontWeight:700,color:C.navy,textAlign:"center",outline:"none"}}/>);
  return (<span onClick={start} title="Click to edit" style={{cursor:"pointer",borderBottom:"2px dashed "+(highlight?C.positive:C.tan),color:highlight?C.positive:C.navy,fontWeight:700,fontSize:"12px",padding:"2px 3px",borderRadius:"3px",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background="#f0f4f8"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{prefix}{typeof value==="number"?value.toFixed(decimals):value}{suffix}</span>);
}

function MetricRow({label,baseVal,improvedVal,prefix,suffix,decimals,onBaseChange,onImprovedChange,lowerIsBetter=false}){
  const delta=improvedVal-baseVal,pctChange=baseVal!==0?(delta/baseVal)*100:0,isPos=lowerIsBetter?delta<0:delta>0;
  return(<div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 90px",padding:"10px 16px",alignItems:"center",borderBottom:"1px solid "+C.silver,transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background="#f8f9fb"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}><div style={{color:"#444",fontSize:"12px"}}>{label}</div><div style={{textAlign:"center"}}><EditableCell value={baseVal} onChange={onBaseChange} prefix={prefix} suffix={suffix} decimals={decimals}/></div><div style={{textAlign:"center"}}><EditableCell value={improvedVal} onChange={onImprovedChange} prefix={prefix} suffix={suffix} decimals={decimals} highlight={isPos}/></div><div style={{textAlign:"right"}}><span style={{display:"inline-block",padding:"2px 8px",borderRadius:"20px",fontSize:"10px",fontWeight:700,background:isPos?C.posLight:delta===0?"#f5f5f5":"#fdecea",color:isPos?C.positive:delta===0?"#888":"#c0392b"}}>{delta===0?"—":pct(pctChange)}</span></div></div>);
}

function WBar({label,value,maxVal,color}){
  const w=maxVal>0?Math.min(Math.abs(value)/Math.abs(maxVal)*100,100):0;
  return(<div style={{marginBottom:"9px"}}><div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px"}}><span style={{fontSize:"10px",color:"#555"}}>{label}</span><span style={{fontSize:"10px",fontWeight:700,color}}>{fmt(value)}/mo</span></div><div style={{height:"7px",background:C.silver,borderRadius:"4px",overflow:"hidden"}}><div style={{height:"100%",width:w+"%",background:color,borderRadius:"4px",transition:"width 0.5s ease"}}/></div></div>);
}

function exportToPDF({base,improved,metrics,proj,payback,fee,clientName,activeSc,nrrDelta,selectedInitiatives=[],activeCurve,actuals=[]}){
  const client=clientName.trim()||"Prospect";
  const scenario=activeSc?activeSc.charAt(0).toUpperCase()+activeSc.slice(1):"Custom";
  const date=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});

  // ── Shared helpers ──
  const maxWF=Math.max(metrics.churnSaved,metrics.expansionGain,metrics.costSaved,1);
  const wBar=(label,value,color)=>{
    const w=Math.min(Math.abs(value)/maxWF*100,100).toFixed(1);
    return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:11px;color:#555">${label}</span><span style="font-size:11px;font-weight:700;color:${color}">${fmt(value)}/mo</span></div><div style="height:8px;background:#eee;border-radius:4px;overflow:hidden"><div style="height:100%;width:${w}%;background:${color};border-radius:4px"></div></div></div>`;
  };
  const pbColor=payback&&payback<=12?"#2e7d4f":payback&&payback<=24?"#b45309":"#c0392b";
  const pbBg=payback&&payback<=12?"#e8f5ee":payback&&payback<=24?"#fff8ec":"#fdecea";
  const pbLabel=payback?payback<=12?"Strong Return":payback<=24?"Solid Investment":"Long-Term Play":"—";

  // ── SVG: MRR Projection line chart ──
  const LW=520,LH=180,LPL=62,LPR=10,LPT=10,LPB=28,liW=LW-LPL-LPR,liH=LH-LPT-LPB;
  const allV=proj.flatMap(d=>[d.without,d.with]),minV=Math.min(...allV)*0.97,maxV2=Math.max(...allV)*1.03;
  const lxP=i=>LPL+(i/(proj.length-1))*liW,lyP=v=>LPT+liH-((v-minV)/(maxV2-minV))*liH;
  const lineGrid=[0,.33,.66,1].map(t=>{const v=minV+t*(maxV2-minV);return`<line x1="${LPL}" x2="${LW-LPR}" y1="${lyP(v)}" y2="${lyP(v)}" stroke="#e5e7eb" stroke-width="1"/><text x="${LPL-4}" y="${lyP(v)+3}" text-anchor="end" font-size="8" fill="#aaa">${fmt(v)}</text>`;}).join("");
  const lineXLabels=proj.map((d,i)=>`<text x="${lxP(i)}" y="${LH-5}" text-anchor="middle" font-size="8" fill="#bbb">${d.month}</text>`).join("");
  const withPts=proj.map((d,i)=>`${lxP(i)},${lyP(d.with)}`).join(" ");
  const withoutPts=proj.map((d,i)=>`${lxP(i)},${lyP(d.without)}`).join(" ");
  const fillPts=[...proj.map((d,i)=>`${lxP(i)},${lyP(d.with)}`),...proj.slice().reverse().map((d,i)=>`${lxP(proj.length-1-i)},${lyP(d.without)}`)].join(" ");
  const svgLine=`<svg width="100%" viewBox="0 0 ${LW} ${LH}" xmlns="http://www.w3.org/2000/svg">${lineGrid}${lineXLabels}<polygon points="${fillPts}" fill="#1E3A5F" fill-opacity="0.06"/><polyline points="${withoutPts}" fill="none" stroke="#D6D3D1" stroke-width="2" stroke-dasharray="6 4"/><polyline points="${withPts}" fill="none" stroke="#1E3A5F" stroke-width="2.5"/></svg>`;

  // ── SVG: Cumulative ARR bar chart ──
  const BW=520,BH=180,BPL=62,BPR=10,BPT=10,BPB=28,biW=BW-BPL-BPR,biH=BH-BPT-BPB;
  const maxCum=Math.max(...proj.map(d=>d.cumGap),1);
  const byP=v=>BPT+biH-(v/maxCum)*biH,bbW=(biW/proj.length)*0.55,bxP=i=>BPL+(i+0.5)*(biW/proj.length);
  const svgBarsHTML=proj.map((d,i)=>{const bh=Math.max(biH-(byP(d.cumGap)-BPT),1);return`<rect x="${bxP(i)-bbW/2}" y="${byP(d.cumGap)}" width="${bbW}" height="${bh}" fill="#701427" rx="2" opacity="0.85"/><text x="${bxP(i)}" y="${BH-5}" text-anchor="middle" font-size="8" fill="#bbb">${d.month}</text>`;}).join("");
  const svgGridHTML=[0,.33,.66,1].map(t=>{const v=t*maxCum;return`<line x1="${BPL}" x2="${BW-BPR}" y1="${byP(v)}" y2="${byP(v)}" stroke="#e5e7eb" stroke-width="1"/><text x="${BPL-4}" y="${byP(v)+3}" text-anchor="end" font-size="8" fill="#aaa">${fmt(v)}</text>`;}).join("");
  const svgBars=`<svg width="100%" viewBox="0 0 ${BW} ${BH}" xmlns="http://www.w3.org/2000/svg">${svgGridHTML}${svgBarsHTML}</svg>`;

  // ── Metric table rows ──
  const metricRows=[
    {label:"Monthly Churn Rate",base:base.churnRate,imp:improved.churnRate,suffix:"%",dec:2,lower:true},
    {label:"Net Revenue Retention",base:base.nrr,imp:improved.nrr,suffix:"%",dec:1},
    {label:"Time-to-First-Value",base:base.ttfv,imp:improved.ttfv,suffix:" days",dec:0,lower:true},
    {label:"Monthly Expansion Rate",base:base.expansionRate,imp:improved.expansionRate,suffix:"%",dec:2},
    {label:"Monthly Support Cost",base:base.supportCost,imp:improved.supportCost,suffix:"",dec:0,pre:"$",lower:true},
    {label:"CSAT Score",base:base.csat,imp:improved.csat,suffix:"",dec:1},
  ];
  const tableRows=[
    `<tr style="background:#fafbfc;border-bottom:2px solid #D6D3D1"><td style="padding:10px 14px;font-size:12px;font-weight:700;color:#222">Monthly Recurring Revenue</td><td style="padding:10px 14px;text-align:center;font-weight:700;font-size:12px;color:#1E3A5F">${fmt(base.mrr)}</td><td style="padding:10px 14px;text-align:center;font-weight:700;font-size:12px;color:#2e7d4f">${fmt(base.mrr+metrics.totalMRRGain)}</td><td style="padding:10px 14px;text-align:right"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:#e8f5ee;color:#2e7d4f">${pct((metrics.totalMRRGain/base.mrr)*100)}</span></td></tr>`,
    ...metricRows.map(r=>{
      const delta=r.imp-r.base,pctChg=r.base!==0?(delta/r.base)*100:0,isPos=r.lower?delta<0:delta>0;
      const bc=isPos?"#2e7d4f":delta===0?"#888":"#c0392b",bg=isPos?"#e8f5ee":delta===0?"#f5f5f5":"#fdecea";
      const fv=v=>`${r.pre||""}${v.toFixed(r.dec)}${r.suffix}`;
      return `<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:9px 14px;font-size:11px;color:#555">${r.label}</td><td style="padding:9px 14px;text-align:center;font-size:11px;font-weight:700;color:#1E3A5F">${fv(r.base)}</td><td style="padding:9px 14px;text-align:center;font-size:11px;font-weight:700;color:${isPos?"#2e7d4f":"#1E3A5F"}">${fv(r.imp)}</td><td style="padding:9px 14px;text-align:right"><span style="display:inline-block;padding:2px 9px;border-radius:20px;font-size:10px;font-weight:700;background:${bg};color:${bc}">${delta===0?"—":pct(pctChg)}</span></td></tr>`;
    })
  ].join("");

  // ── Initiatives for page 2 ──
  const selInits=(selectedInitiatives||[]).map(id=>INITIATIVES.find(x=>x.id===id)).filter(Boolean);
  const curveObj=CURVES[activeCurve]||CURVES["steadybuild"];
  const rampLabel=activeCurve==="quickwin"?"~4 months":activeCurve==="steadybuild"?"~7 months":"~10 months";
  const initiativeCards=selInits.length>0?selInits.map(init=>{
    const deltas=Object.entries(init.deltas||{}).map(([k,v])=>`${k}: ${v>0?"+":""}${v}`).join(" · ");
    return `<div style="padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px;border-left:3px solid #1E3A5F"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:3px"><span style="font-size:11px;font-weight:700;color:#1E3A5F">${init.label}</span><span style="font-size:9px;color:#aaa;background:#f5f5f5;padding:2px 7px;border-radius:10px">${init.tag}</span></div><div style="font-size:9px;color:#888">${init.desc}</div>${deltas?`<div style="font-size:9px;color:#2e7d4f;margin-top:3px;font-weight:600">${deltas}</div>`:""}  </div>`;
  }).join(""):`<div style="font-size:11px;color:#bbb;font-style:italic;padding:10px 0">No initiatives selected</div>`;

  // ── Actuals strip ──
  const trackedActuals=(actuals||[]).filter(v=>v!==null&&v!==undefined);
  const actualsStrip=trackedActuals.length>0?(()=>{
    const projMRR=proj.map(d=>d.with);
    const dots=(actuals||[]).map((v,i)=>{
      if(v===null||v===undefined) return `<div style="text-align:center"><div style="width:10px;height:10px;border-radius:50%;background:#e5e7eb;margin:0 auto 3px"></div><div style="font-size:7px;color:#bbb">M${i+1}</div></div>`;
      const ahead=v>=(projMRR[i]||0);
      return `<div style="text-align:center"><div style="width:10px;height:10px;border-radius:50%;background:${ahead?"#2e7d4f":"#c0392b"};margin:0 auto 3px"></div><div style="font-size:7px;color:${ahead?"#2e7d4f":"#c0392b"};font-weight:700">${fmt(v)}</div></div>`;
    }).join("");
    const aheadCount=(actuals||[]).filter((v,i)=>v!==null&&v>=(proj[i]?.with||0)).length;
    const behindCount=trackedActuals.length-aheadCount;
    return `<div style="background:#f8f9fb;border-radius:10px;padding:14px 18px;margin-bottom:14px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><span style="font-size:10px;font-weight:700;color:#1E3A5F;text-transform:uppercase;letter-spacing:0.06em">Actuals vs Plan</span><div style="display:flex;gap:12px"><span style="font-size:10px;color:#2e7d4f;font-weight:700">▲ ${aheadCount} ahead</span><span style="font-size:10px;color:#c0392b;font-weight:700">▼ ${behindCount} behind</span></div></div><div style="display:grid;grid-template-columns:repeat(12,1fr);gap:4px">${dots}</div></div>`;
  })():"";

  // ── Assumptions table ──
  const assumptionRows=[
    ["Scenario",scenario],
    ["Growth Curve",curveObj.label],
    ["Ramp to Full Impact",rampLabel],
    ["Monthly Fee",fmt(fee)+"/mo"],
    ["Base MRR",fmt(base.mrr)+"/mo"],
    ["Churn Assumption",base.churnRate+"% → "+improved.churnRate+"%"],
    ["NRR Assumption",base.nrr+"% → "+improved.nrr+"%"],
    ["Initiatives Selected",selInits.length>0?selInits.map(x=>x.label).join(", "):"None"],
  ].map(([l,v])=>`<tr style="border-bottom:1px solid #f0f0f0"><td style="padding:7px 12px;font-size:10px;color:#888;width:45%">${l}</td><td style="padding:7px 12px;font-size:11px;font-weight:700;color:#1E3A5F">${v}</td></tr>`).join("");

  // ── Shared header/footer HTML ──
  const pageHeader=(subtitle)=>`
    <div style="background:#1E3A5F;border-radius:10px;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <div style="display:flex;align-items:center;gap:14px">
        <div style="width:38px;height:38px;background:#701427;border-radius:8px;display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-weight:900;font-size:18px">F</span></div>
        <div>
          <div style="color:#fff;font-weight:800;font-size:17px">${client} × FreedomOps</div>
          <div style="color:#C4B5A6;font-size:9px;letter-spacing:0.12em;text-transform:uppercase">${subtitle} · ${scenario} Scenario · ${date}</div>
        </div>
      </div>
      <div style="text-align:right">
        <div style="color:#C4B5A6;font-size:8px;text-transform:uppercase;margin-bottom:3px">Additional ARR Impact</div>
        <div style="color:#fff;font-size:38px;font-weight:900;line-height:1">${fmt(metrics.totalARRGain)}</div>
      </div>
    </div>`;
  const pageFooter=`<div style="text-align:center;margin-top:20px;padding-top:14px;border-top:1px solid #f0f0f0;color:#ccc;font-size:8px;letter-spacing:0.1em">${client.toUpperCase()} × FREEDOMOPS CONFIDENTIAL · FOR DISCUSSION PURPOSES ONLY · ${date}</div>`;

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FreedomOps — ${client}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;color:#333}
    @page{size:A4 portrait;margin:12mm 14mm}
    .page{max-width:780px;margin:0 auto;padding:0}
    .page-break{page-break-before:always;padding-top:0}
    h3{font-size:10px;font-weight:700;color:#C4B5A6;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:10px}
    .card{background:#fff;border-radius:10px;border:1px solid #e5e7eb;overflow:hidden;margin-bottom:14px}
    .card-header{padding:10px 16px;font-size:9px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#fff}
    .card-body{padding:14px 16px}
  </style>
  </head><body>

  <!-- ═══════════════ PAGE 1: THE BUSINESS CASE ═══════════════ -->
  <div class="page">
    ${pageHeader("Impact Report")}

    <!-- KPI strip -->
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:10px;margin-bottom:18px">
      ${[
        {label:"NRR Lift",value:`+${nrrDelta.toFixed(1)} pts`,sub:`${base.nrr}% → ${improved.nrr}%`,color:"#2e7d4f",bg:"#e8f5ee"},
        {label:"MRR Lift",value:`+${fmt(metrics.totalMRRGain)}/mo`,sub:"monthly recurring gain",color:"#1E3A5F",bg:"#eef2f8"},
        {label:"Payback Period",value:payback?payback+" mo":"—",sub:pbLabel,color:pbColor,bg:pbBg},
        {label:"ROI",value:pct(((metrics.totalARRGain-fee*12)/(fee*12))*100),sub:"on annual investment",color:"#2e7d4f",bg:"#e8f5ee"},
      ].map(k=>`<div style="background:${k.bg};border-radius:10px;padding:14px 16px;text-align:center"><div style="font-size:8px;color:#888;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:5px">${k.label}</div><div style="font-size:22px;font-weight:900;color:${k.color};line-height:1.1">${k.value}</div><div style="font-size:9px;color:#aaa;margin-top:4px">${k.sub}</div></div>`).join("")}
    </div>

    <!-- Metrics table -->
    <div class="card" style="margin-bottom:18px">
      <div class="card-header" style="background:#1E3A5F">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr 90px">
          <span>Metric</span><span style="text-align:center">Current</span><span style="text-align:center">With FreedomOps</span><span style="text-align:right">Δ</span>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse"><tbody>${tableRows}</tbody></table>
    </div>

    <!-- Charts row -->
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:0">
      <div class="card" style="margin-bottom:0">
        <div class="card-header" style="background:#1E3A5F">12-Month MRR Projection</div>
        <div class="card-body" style="padding:10px 12px">
          <div style="display:flex;gap:12px;margin-bottom:6px">
            <div style="display:flex;align-items:center;gap:4px"><div style="width:16px;height:2px;background:#1E3A5F;border-radius:1px"></div><span style="font-size:8px;color:#888">With FO</span></div>
            <div style="display:flex;align-items:center;gap:4px"><div style="width:16px;height:2px;background:#D6D3D1;border-radius:1px;border-top:1px dashed #D6D3D1"></div><span style="font-size:8px;color:#888">Without</span></div>
          </div>
          ${svgLine}
        </div>
      </div>
      <div class="card" style="margin-bottom:0">
        <div class="card-header" style="background:#701427">Cumulative ARR Gain</div>
        <div class="card-body" style="padding:10px 12px">${svgBars}</div>
      </div>
    </div>

    ${pageFooter}
  </div>

  <!-- ═══════════════ PAGE 2: THE PLAN ═══════════════ -->
  <div class="page page-break">
    ${pageHeader("Engagement Plan")}

    <div style="display:grid;grid-template-columns:1fr 280px;gap:14px">
      <!-- Left: Initiatives + Actuals -->
      <div>
        <!-- Engagement plan -->
        <div class="card">
          <div class="card-header" style="background:#1E3A5F;display:flex;justify-content:space-between;align-items:center">
            <span>Engagement Plan</span>
            <span style="font-size:9px;color:#C4B5A6;font-weight:400;text-transform:none;letter-spacing:0">${curveObj.label} curve · ramps ${rampLabel}</span>
          </div>
          <div class="card-body">${initiativeCards}</div>
        </div>

        <!-- Actuals strip (only if data exists) -->
        ${actualsStrip}

        <!-- MRR Gain Breakdown -->
        <div class="card">
          <div class="card-header" style="background:#701427">MRR Gain Breakdown</div>
          <div class="card-body">
            ${wBar("Churn Reduction",metrics.churnSaved,"#1E3A5F")}
            ${wBar("Expansion Revenue",metrics.expansionGain,"#701427")}
            ${wBar("Support Cost Savings",metrics.costSaved,"#5a7fa8")}
            <div style="margin-top:12px;padding-top:12px;border-top:2px solid #1E3A5F;display:flex;justify-content:space-between"><span style="font-size:10px;font-weight:700;color:#1E3A5F">Total Monthly Impact</span><span style="font-size:14px;font-weight:900;color:#1E3A5F">${fmt(metrics.totalMRRGain+metrics.costSaved)}/mo</span></div>
          </div>
        </div>
      </div>

      <!-- Right: Payback + Assumptions -->
      <div>
        <!-- Payback -->
        <div class="card">
          <div class="card-header" style="background:#1E3A5F">Payback Calculator</div>
          <div class="card-body">
            <div style="margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid #f0f0f0;display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:10px;color:#888">Monthly Fee</span>
              <span style="font-size:12px;font-weight:700;color:#1E3A5F">${fmt(fee)}/mo</span>
            </div>
            ${[["Monthly Impact",fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo","#1E3A5F"],["Annual Investment",fmt(fee*12),"#888"],["Annual Return",fmt(metrics.totalARRGain),"#2e7d4f"],["ROI",pct(((metrics.totalARRGain-fee*12)/(fee*12))*100),"#2e7d4f"]].map(([l,v,c])=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0"><span style="font-size:10px;color:#888">${l}</span><span style="font-size:11px;font-weight:700;color:${c}">${v}</span></div>`).join("")}
            <div style="margin-top:12px;padding:12px;background:${pbBg};border-radius:8px;text-align:center;border:1px solid ${pbColor}22">
              <div style="font-size:8px;color:#999;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px">Payback Period</div>
              <div style="font-size:26px;font-weight:900;color:${pbColor}">${payback?payback+" months":"—"}</div>
              <div style="font-size:9px;color:#aaa;margin-top:2px">${pbLabel}</div>
            </div>
          </div>
        </div>

        <!-- Key Assumptions -->
        <div class="card">
          <div class="card-header" style="background:#1E3A5F">Key Assumptions</div>
          <table style="width:100%;border-collapse:collapse"><tbody>${assumptionRows}</tbody></table>
        </div>
      </div>
    </div>

    ${pageFooter}
  </div>

  <script>window.onload=function(){window.print();}</script>
  </body></html>`;

  const w=window.open("","_blank","width=900,height=1100");
  if(!w){alert("Pop-up blocked — please allow pop-ups.");return;}
  w.document.write(html);w.document.close();
}


// ── Sparkline ────────────────────────────────────────────────
function SparklineSVG({values, color="#1E3A5F", width=52, height=20}){
  const max=Math.max(...values,0.01);
  const pts=values.map((v,i)=>{
    const x=4+(i/(values.length-1))*(width-8);
    const y=height-4-((v/max)*(height-8));
    return x+","+y;
  }).join(" ");
  return(
    <svg width={width} height={height} style={{display:"block",flexShrink:0}}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round"/>
      <circle cx={pts.split(" ").pop().split(",")[0]} cy={pts.split(" ").pop().split(",")[1]} r="2.5" fill={color}/>
    </svg>
  );
}

// ── Main App ──────────────────────────────────────────────────
export default function App() {
  const [clients, setClients]     = useState(loadClients);
  const [showForm, setShowForm]   = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [showMenu, setShowMenu]   = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedPresent, setCopiedPresent] = useState(false);
  const [showScenarioMenu, setShowScenarioMenu] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);

  // Active client state
  const [activeId, setActiveId]   = useState(null);
  const [base, setBase]           = useState({...DEFAULT_BASE});
  const [improved, setImproved]   = useState(applyScenario(DEFAULT_BASE,"moderate"));
  const [customImp, setCustomImp] = useState(applyScenario(DEFAULT_BASE,"moderate"));
  const [activeSc, setActiveSc]   = useState("moderate");
  const [fee, setFee]             = useState(5000);
  const [editFee, setEditFee]     = useState(false);
  const [rawFee, setRawFee]       = useState("");
  const [tab, setTab]             = useState("mrr");
  const [syncStatus, setSyncStatus] = useState("loading"); // loading | synced | saving | error | offline
  const [username, setUsernameState] = useState(getUsername);
  const [showNamePrompt, setShowNamePrompt] = useState(() => !getUsername());
  const [nameInput, setNameInput] = useState("");
  const [snapState, setSnapState] = useState("idle");
  const [presentMode, setPresentMode] = useState(getPresentModeFromURL);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [isDemoData, setIsDemoData] = useState(isUsingDemoData);
  const [changelog, setChangelog] = useState([]);
  const [actuals, setActuals] = useState(Array(12).fill(null));
  const [annualTarget, setAnnualTarget] = useState(0);
  const [targetMRR, setTargetMRR] = useState(0);
  const [showActuals, setShowActuals] = useState(true);
  const [scenarioDrafts, setScenarioDrafts] = useState({});
  const [activeCurve, setActiveCurve] = useState(DEFAULT_CURVE);
  const [selectedInitiatives, setSelectedInitiatives] = useState([]);
  const [showPlanDropdown, setShowPlanDropdown] = useState(false); // {moderate:{...imp}, conservative:{...imp}}
  const [isDraftDirty, setIsDraftDirty] = useState(false); // true when improved diverges from preset
  const feeRef = useRef();

  // Load from URL on mount - runs after loadClient is defined
  // ── Initial Supabase sync on mount ──
  useEffect(() => {
    setSyncStatus("loading");
    sbFetchAll().then(remote => {
      if(remote && remote.length > 0) {
        setClients(remote);
        saveClientsLocal(remote);
        setIsDemoData(false);
        setSyncStatus("synced");
      } else if(remote && remote.length === 0) {
        // Empty remote — push local data up
        const local = loadClientsLocal();
        if(local && local.length > 0) {
          Promise.all(local.map(c=>sbUpsert(c))).then(()=>setSyncStatus("synced"));
        } else {
          setSyncStatus("synced");
        }
      } else {
        // Network failure — use local
        setSyncStatus("offline");
      }
    });
  }, []); // eslint-disable-line

  useEffect(() => {
    const urlId = getClientIdFromURL();
    if (urlId && clients.length > 0) {
      const found = clients.find(c => c.id === urlId);
      if (found) loadClient(found);
    }
  }, []); // eslint-disable-line

  const loadClient = (client, clientList = clients, force=false) => {
    setIsDirty(false);
    setActiveId(client.id);
    setBase({...client.base});
    setActuals(client.actuals ? [...client.actuals] : Array(12).fill(null));
    setAnnualTarget(client.annualTarget || 0);
    setTargetMRR(client.targetMRR || 0);
    setScenarioDrafts(client.scenarioDrafts || {});
    setActiveCurve(client.activeCurve || DEFAULT_CURVE);
    setSelectedInitiatives(client.selectedInitiatives || []);
    setChangelog(client.changelog || []);
    setIsDraftDirty(false);
    const imp = client.scenario === "custom" && client.customImp
      ? {...client.customImp}
      : applyScenario(client.base, client.scenario);
    setImproved(imp);
    setCustomImp(client.customImp ? {...client.customImp} : applyScenario(client.base,"moderate"));
    setActiveSc(client.scenario);
    setFee(client.fee);
    setShowMenu(false);
    setTab("mrr");
    setClientInURL(client.id);
  };

  const handleSaveClient = (data) => {
    const existing = clients.find(c => c.id === data.id);
    let updated;
    if (existing) {
      updated = clients.map(c => c.id === data.id ? data : c);
    } else {
      let id = data.id, n = 1;
      while (clients.find(c => c.id === id)) id = `${data.id}-${n++}`;
      data = {...data, id};
      updated = [...clients, data];
    }
    setClients(updated);
    saveClients(updated);
    setIsDemoData(false);
    setShowForm(false);
    setEditingClient(null);
    loadClient(data, updated, true);
    setSyncStatus("saving");
    sbUpsert(data).then(ok=>setSyncStatus(ok?"synced":"error"));
  };

  const saveCurrentClient = (overrides={}) => {
    if (!activeId) return;
    const oldClient = clients.find(c=>c.id===activeId);
    const newData = {...(oldClient||{}),base,scenario:activeSc||oldClient?.scenario,customImp,actuals,annualTarget,targetMRR,scenarioDrafts,activeCurve,selectedInitiatives,...overrides};
    // Build changelog entries
    const newEntries = diffChanges(oldClient, newData, username);
    const updatedLog = [...(oldClient?.changelog||[]), ...newEntries].slice(-50);
    newData.changelog = updatedLog;
    setChangelog(updatedLog);
    const updated = clients.map(c => c.id===activeId ? newData : c);
    setClients(updated);
    saveClients(updated);
    setIsDirty(false);
    setSyncStatus("saving");
    sbUpsert(newData).then(ok=>setSyncStatus(ok?"synced":"error"));
  };

  const clearDemoData = () => {
    setClients([]);
    saveClients([]);
    setIsDemoData(false);
    setSyncStatus("synced");
  };

  const handleDuplicateClient = (c) => {
    const newId = c.id+"-copy-"+Date.now().toString(36);
    const clone = {...c, id:newId, name:"Copy of "+c.name, changelog:[]};
    const updated = [...clients, clone];
    setClients(updated);
    saveClients(updated);
    setEditingClient(clone);
    setShowForm(true);
    setSyncStatus("saving");
    sbUpsert(clone).then(ok=>setSyncStatus(ok?"synced":"error"));
  };

  const handleDeleteClient = (id) => {
    const updated = clients.filter(c => c.id !== id);
    setClients(updated);
    saveClients(updated);
    setConfirmDelete(null);
    if (activeId === id) {
      setActiveId(null);
      setClientInURL(null);
    }
    setSyncStatus("saving");
    sbDelete(id).then(ok=>setSyncStatus(ok?"synced":"error"));
  };

  const copyPresentUrl = () => {
    const url = (() => { try { return window.location.origin+window.location.pathname+"?client="+activeId+"&mode=present"; } catch { return "?client="+activeId+"&mode=present"; } })();
    const ta = document.createElement("textarea");
    ta.value = url; ta.style.cssText = "position:fixed;top:-9999px;opacity:0;";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); setCopiedPresent(true); setTimeout(()=>setCopiedPresent(false),2500); } catch {}
    document.body.removeChild(ta);
  };

  const copyClientUrl = () => {
    const url = (() => { try { return window.location.origin+window.location.pathname+"?client="+activeId; } catch { return "?client="+activeId; } })();
    const ta = document.createElement("textarea");
    ta.value = url; ta.style.cssText = "position:fixed;top:-9999px;opacity:0;";
    document.body.appendChild(ta); ta.focus(); ta.select();
    try { document.execCommand("copy"); setCopiedUrl(true); setTimeout(()=>setCopiedUrl(false),2000); } catch {}
    document.body.removeChild(ta);
  };

  const metrics  = computeMetrics(base, improved);
  const proj     = useMemo(()=>buildProjection(base,improved,activeCurve),[base,improved,activeCurve]);
  const maxWF    = Math.max(metrics.churnSaved,metrics.expansionGain,metrics.costSaved,1);
  const nrrDelta = improved.nrr - base.nrr;
  const payback  = useMemo(()=>{let cum=0;const mg=metrics.totalMRRGain+(base.supportCost-improved.supportCost);for(let m=1;m<=60;m++){cum+=mg;if(cum>=fee*m)return m;}return null;},[metrics,base,improved,fee]);

  const activeClient = clients.find(c => c.id === activeId);

  const setSc = key => {
    setActiveSc(key);
    setIsDirty(true);
    setIsDraftDirty(false);
    if(key==="custom") setImproved({...customImp});
    else if(scenarioDrafts[key]) setImproved({...scenarioDrafts[key]});
    else setImproved(applyScenario(base,key));
  };
  const applyInitiativeSet = (ids) => {
    setSelectedInitiatives(ids);
    if(ids.length>0){
      const initiativeImp = applyInitiatives(base, ids);
      if(initiativeImp){
        setImproved(initiativeImp);
        setActiveSc(null);
        setIsDraftDirty(false);
      }
      const suggested = deriveCurve(ids);
      setActiveCurve(suggested);
    }
  };

  const saveDraft = () => {
    if(!activeSc||activeSc==="custom") return;
    const drafts = {...scenarioDrafts,[activeSc]:{...improved}};
    setScenarioDrafts(drafts);
    setIsDraftDirty(false);
    // persist immediately
    const updated = clients.map(c => c.id===activeId ? {...c,scenarioDrafts:drafts} : c);
    setClients(updated);
    saveClients(updated);
  };
  const revertDraft = () => {
    if(!activeSc||activeSc==="custom") return;
    const base_ = scenarioDrafts[activeSc] ? scenarioDrafts[activeSc] : applyScenario(base,activeSc);
    setImproved({...applyScenario(base,activeSc)});
    // also clear the draft
    const drafts = {...scenarioDrafts};
    delete drafts[activeSc];
    setScenarioDrafts(drafts);
    setIsDraftDirty(false);
    const updated = clients.map(c => c.id===activeId ? {...c,scenarioDrafts:drafts} : c);
    setClients(updated);
    saveClients(updated);
  };

  const updBase = f => v => {
    const nb={...base,[f]:v};
    setBase(nb);
    setIsDirty(true);
    if(selectedInitiatives.length>0){
      const imp=applyInitiatives(nb,selectedInitiatives);
      if(imp) setImproved(imp);
    } else if(activeSc&&activeSc!=="custom"){
      setImproved(applyScenario(nb,activeSc));
    }
  };
  const updImp  = f => v => {
    setImproved(p=>({...p,[f]:v}));
    setIsDraftDirty(true);
    setIsDirty(true);
  };

  const doSnapshot = () => {
    const cl = activeClient?.name || "Prospect";
    const txt = [`FreedomOps × ${cl} — Impact Snapshot`,"─".repeat(36),`Additional ARR:  ${fmt(metrics.totalARRGain)}`,`MRR Lift:        ${fmt(metrics.totalMRRGain)}/mo`,`NRR Lift:        +${nrrDelta.toFixed(1)} pts`,`Payback:         ${payback?payback+" months":"—"}`,`ROI:             ${pct(((metrics.totalARRGain-fee*12)/(fee*12))*100)}`].join("\n");
    const ta=document.createElement("textarea");ta.value=txt;ta.style.cssText="position:fixed;top:-9999px;opacity:0;";document.body.appendChild(ta);ta.focus();ta.select();
    try{document.execCommand("copy");setSnapState("copied");}catch{setSnapState("error");}
    document.body.removeChild(ta);setTimeout(()=>setSnapState("idle"),2500);
  };

  const rows=[{field:"churnRate",label:"Monthly Churn Rate",prefix:"",suffix:"%",decimals:2,lowerIsBetter:true},{field:"nrr",label:"Net Revenue Retention",prefix:"",suffix:"%",decimals:1},{field:"ttfv",label:"Time-to-First-Value (days)",prefix:"",suffix:"",decimals:0,lowerIsBetter:true},{field:"expansionRate",label:"Monthly Expansion Rate",prefix:"",suffix:"%",decimals:2},{field:"supportCost",label:"Monthly Support Cost",prefix:"$",suffix:"",decimals:0,lowerIsBetter:true},{field:"csat",label:"CSAT Score",prefix:"",suffix:"",decimals:1}];
  const callouts=[{label:"NRR Lift",value:`+${nrrDelta.toFixed(1)}pts`,sub:`${base.nrr}% → ${improved.nrr}%`,color:C.navy},{label:"Churn Reduction",value:pct(((improved.churnRate-base.churnRate)/base.churnRate)*100),sub:`${base.churnRate}% → ${improved.churnRate}%`,color:C.burgundy},{label:"TTFV Improvement",value:pct(((improved.ttfv-base.ttfv)/base.ttfv)*100),sub:`${base.ttfv} → ${improved.ttfv} days`,color:C.burgundy},{label:"CSAT Gain",value:`+${(improved.csat-base.csat).toFixed(1)}`,sub:`${base.csat} → ${improved.csat}`,color:C.navy}];
  const snapLabel={idle:"📋 Snapshot",copied:"✓ Copied!",error:"⚠ Ctrl+C"}[snapState];
  const SCENARIO_TIPS={
    conservative:"Churn -15% · NRR +4pts · TTFV -20% · Expansion +10%",
    moderate:    "Churn -28% · NRR +8pts · TTFV -38% · Expansion +22%",
    aggressive:  "Churn -40% · NRR +12pts · TTFV -55% · Expansion +35%",
    custom:      "Manually configured metric targets",
  };
  const scBtn=(id,lbl)=>(<button title={SCENARIO_TIPS[id]||""} onClick={()=>setSc(id)} style={{padding:"5px 10px",borderRadius:"5px",border:activeSc===id?"none":"1px solid rgba(255,255,255,0.2)",background:activeSc===id?C.burgundy:"rgba(255,255,255,0.08)",color:activeSc===id?"#fff":C.tan,fontSize:"10px",fontWeight:700,cursor:"pointer",transition:"all 0.2s"}}>{lbl}</button>);

  // ── Name prompt modal ──
  const namePromptModal = showNamePrompt && (
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:200}}>
      <div style={{background:"#fff",borderRadius:"16px",padding:"36px 40px",boxShadow:"0 20px 60px rgba(0,0,0,0.25)",width:"340px",textAlign:"center"}}>
        <img src="/icon1.png" alt="FreedomOps" style={{width:"56px",height:"56px",objectFit:"contain",margin:"0 auto 18px",display:"block"}}/>
        <div style={{fontSize:"18px",fontWeight:800,color:C.navy,marginBottom:"6px"}}>Welcome to FreedomOps</div>
        <div style={{fontSize:"12px",color:"#888",marginBottom:"24px",lineHeight:1.5}}>What should we call you? Your name will appear in the change log so your team knows who edited what.</div>
        <input
          autoFocus
          value={nameInput}
          onChange={e=>setNameInput(e.target.value)}
          onKeyDown={e=>{if(e.key==="Enter"&&nameInput.trim()){setUsername(nameInput.trim());setUsernameState(nameInput.trim());setShowNamePrompt(false);}}}
          placeholder="Your name"
          style={{width:"100%",border:"2px solid "+C.silver,borderRadius:"8px",padding:"10px 14px",fontSize:"14px",outline:"none",color:C.navy,boxSizing:"border-box",marginBottom:"12px",textAlign:"center"}}
        />
        <button
          onClick={()=>{if(nameInput.trim()){setUsername(nameInput.trim());setUsernameState(nameInput.trim());}setShowNamePrompt(false);}}
          style={{width:"100%",padding:"11px",borderRadius:"8px",border:"none",background:C.navy,color:"#fff",fontSize:"13px",fontWeight:700,cursor:"pointer"}}
        >{nameInput.trim()?"Continue as "+nameInput.trim():"Skip for now"}</button>
      </div>
    </div>
  );

  // ── No client selected: landing screen ──
  if (!activeId) return (
    <div style={{minHeight:"100vh",background:C.offwhite,fontFamily:"'Helvetica Neue',Arial,sans-serif"}}>
      <GlobalStyles/>
      <MobileWarning/>

      {/* Top bar */}
      <div style={{background:C.navy,padding:"0 32px",display:"flex",alignItems:"center",height:"52px",boxShadow:"0 2px 12px rgba(0,0,0,0.2)"}}>
        <img src="/icon1.png" alt="FreedomOps" style={{width:"28px",height:"28px",objectFit:"contain",marginRight:"10px"}}/>
        <span style={{color:"#fff",fontWeight:700,fontSize:"13px"}}>FreedomOps</span>
        <span style={{color:C.tan,fontSize:"10px",marginLeft:"8px",letterSpacing:"0.08em",textTransform:"uppercase"}}>Impact Modeler</span>
      </div>

      <div style={{maxWidth:"860px",margin:"0 auto",padding:"40px 24px"}}>

        {/* Hero */}
        <div style={{background:"linear-gradient(135deg,"+C.navy+" 0%,"+C.navyMid+" 100%)",borderRadius:"14px",padding:"32px 36px",marginBottom:"28px",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,right:0,width:"300px",height:"100%",background:"radial-gradient(ellipse at top right,rgba(112,20,39,0.45) 0%,transparent 65%)",pointerEvents:"none"}}/>
          <div style={{color:C.tan,fontSize:"10px",letterSpacing:"0.14em",textTransform:"uppercase",marginBottom:"10px"}}>Welcome back</div>
          <div style={{color:"#fff",fontSize:"28px",fontWeight:800,lineHeight:1.2,marginBottom:"8px"}}>Your Client Pipeline</div>
          <div style={{color:C.tan,fontSize:"13px",marginBottom:"28px"}}>Every dashboard is bookmarkable. Prep in private, present with confidence.</div>

          {/* Aggregate stats */}
          {(()=>{
            const totals = clients.reduce((acc,c)=>{
              const imp = c.scenario==="custom"&&c.customImp ? c.customImp : applyScenario(c.base,c.scenario==="custom"?"moderate":c.scenario);
              const m = computeMetrics(c.base,imp);
              return {arr:acc.arr+m.totalARRGain, mrr:acc.mrr+m.totalMRRGain+m.costSaved};
            },{arr:0,mrr:0});
            return (
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"16px"}}>
                {[
                  {label:"Saved Clients",value:clients.length,suffix:"",color:"#fff"},
                  {label:"Total Pipeline ARR",value:fmt(totals.arr),suffix:"/yr",color:"#6ee7a0"},
                  {label:"Total MRR Lift",value:fmt(totals.mrr),suffix:"/mo",color:"#6ee7a0"},
                ].map((s,i)=>(
                  <div key={i} style={{background:"rgba(255,255,255,0.08)",borderRadius:"10px",padding:"14px 18px",border:"1px solid rgba(255,255,255,0.1)"}}>
                    <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"5px"}}>{s.label}</div>
                    <div style={{color:s.color,fontSize:"24px",fontWeight:800,lineHeight:1}}>{s.value}<span style={{fontSize:"13px",fontWeight:500,opacity:0.8}}>{s.suffix}</span></div>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Loading skeleton */}
        {syncStatus==="loading"&&(
          <div style={{marginBottom:"16px"}}>
            {[1,2,3].map(i=>(
              <div key={i} style={{background:"#fff",borderRadius:"12px",padding:"18px 22px",marginBottom:"10px",boxShadow:"0 2px 10px rgba(0,0,0,0.06)",display:"flex",alignItems:"center",gap:"16px",opacity:1-i*0.15}}>
                <div style={{width:"38px",height:"38px",borderRadius:"8px",background:"linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)",backgroundSize:"200% 100%",animation:"shimmer 1.4s infinite",flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{height:"13px",width:"140px",borderRadius:"6px",background:"linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)",backgroundSize:"200% 100%",marginBottom:"8px"}}/>
                  <div style={{height:"10px",width:"200px",borderRadius:"6px",background:"linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)",backgroundSize:"200% 100%"}}/>
                </div>
                <div style={{display:"flex",gap:"20px",marginRight:"16px"}}>
                  {[80,60,70].map((w,j)=>(<div key={j} style={{height:"32px",width:w+"px",borderRadius:"6px",background:"linear-gradient(90deg,#f0f0f0 25%,#e8e8e8 50%,#f0f0f0 75%)",backgroundSize:"200% 100%"}}/>))}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Client list header */}
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"12px"}}>
          <div style={{fontSize:"10px",fontWeight:700,color:"#aaa",letterSpacing:"0.12em",textTransform:"uppercase"}}>
            {clients.length>0?clients.length+" client"+(clients.length===1?"":"s"):"No clients yet"}
          </div>
          <button onClick={()=>{setEditingClient(null);setShowForm(true);}} style={{padding:"8px 20px",borderRadius:"7px",background:C.burgundy,border:"none",color:"#fff",fontSize:"12px",fontWeight:700,cursor:"pointer",boxShadow:"0 3px 12px rgba(112,20,39,0.3)"}}>+ New Client</button>
        </div>

        {/* Client cards */}
        {clients.length===0&&syncStatus!=="loading"&&(
          <div style={{textAlign:"center",padding:"64px 24px",background:"#fff",borderRadius:"14px",boxShadow:"0 2px 10px rgba(0,0,0,0.06)"}}>
            <img src="/icon1.png" alt="FreedomOps" style={{width:"72px",height:"72px",objectFit:"contain",marginBottom:"20px"}}/>
            <div style={{fontWeight:800,color:C.navy,fontSize:"18px",marginBottom:"8px"}}>No clients yet — add your first one to get started</div>
            <div style={{color:"#aaa",fontSize:"12px",marginBottom:"24px",maxWidth:"340px",margin:"0 auto 24px"}}>Build a model for each prospect or customer. Every dashboard is bookmarkable and shared with your team in real time.</div>
            <button onClick={()=>{setEditingClient(null);setShowForm(true);}} style={{padding:"12px 28px",borderRadius:"8px",background:C.burgundy,border:"none",color:"#fff",fontSize:"13px",fontWeight:700,cursor:"pointer",boxShadow:"0 4px 16px rgba(112,20,39,0.3)"}}>+ Add Your First Client</button>
          </div>
        )}
        {clients.map(c=>{
          const imp = c.scenario==="custom"&&c.customImp ? c.customImp : applyScenario(c.base,c.scenario==="custom"?"moderate":c.scenario);
          const m = computeMetrics(c.base,imp);
          const nrrD = imp.nrr-c.base.nrr;
          return(
            <div key={c.id} style={{background:"#fff",borderRadius:"12px",padding:"18px 22px",marginBottom:"10px",boxShadow:"0 2px 10px rgba(0,0,0,0.07)",display:"flex",alignItems:"center",justifyContent:"space-between",cursor:"pointer",transition:"box-shadow 0.15s,transform 0.1s"}} onClick={()=>loadClient(c)} onMouseEnter={e=>{e.currentTarget.style.boxShadow="0 6px 24px rgba(0,0,0,0.13)";e.currentTarget.style.transform="translateY(-1px)";}} onMouseLeave={e=>{e.currentTarget.style.boxShadow="0 2px 10px rgba(0,0,0,0.07)";e.currentTarget.style.transform="translateY(0)";}}>
              <div style={{display:"flex",alignItems:"center",gap:"16px",flex:1}}>
                <div style={{width:"38px",height:"38px",borderRadius:"8px",background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                  <span style={{color:"#fff",fontWeight:800,fontSize:"14px"}}>{c.name.charAt(0)}</span>
                </div>
                <div style={{flex:1}}>
                  <div style={{fontWeight:700,color:C.navy,fontSize:"14px"}}>{c.name}</div>
                  <div style={{fontSize:"10px",color:"#aaa",marginTop:"2px",textTransform:"capitalize"}}>
                    {c.scenario} scenario · {fmt(c.fee)}/mo · MRR {fmt(c.base.mrr)}
                    {c.changelog&&c.changelog.length>0&&(
                      <span style={{marginLeft:"8px",color:"#bbb"}}>
                        · {c.changelog[c.changelog.length-1].user} · {timeAgo(c.changelog[c.changelog.length-1].ts)}
                      </span>
                    )}
                  </div>
                </div>
                <div style={{display:"flex",gap:"20px",marginRight:"16px"}}>
                  {[
                    {label:"ARR Impact",value:fmt(m.totalARRGain),color:C.positive},
                    {label:"MRR Lift",value:"+"+fmt(m.totalMRRGain)+"/mo",color:C.navy},
                    {label:"NRR Lift",value:"+"+nrrD.toFixed(1)+"pts",color:C.burgundy},
                  ].map((s,i)=>(
                    <div key={i} style={{textAlign:"center"}}>
                      <div style={{fontSize:"9px",color:"#aaa",letterSpacing:"0.08em",textTransform:"uppercase",marginBottom:"2px"}}>{s.label}</div>
                      <div style={{fontSize:"13px",fontWeight:800,color:s.color}}>{s.value}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{display:"flex",gap:"6px",alignItems:"center"}}>
                <button onClick={e=>{e.stopPropagation();setEditingClient(c);setShowForm(true);}} style={{padding:"5px 12px",borderRadius:"6px",border:"1px solid "+C.silver,background:"#fff",color:"#666",fontSize:"10px",fontWeight:600,cursor:"pointer"}}>Edit</button>
                <button onClick={e=>{e.stopPropagation();handleDuplicateClient(c);}} title="Duplicate client" style={{padding:"5px 10px",borderRadius:"6px",border:"1px solid "+C.silver,background:"#fff",color:"#888",fontSize:"12px",cursor:"pointer"}}>⧉</button>
                {confirmDelete===c.id ? (
                  <div style={{display:"flex",gap:"4px",alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                    <span style={{fontSize:"10px",color:"#c0392b",fontWeight:600}}>Sure?</span>
                    <button onClick={e=>{e.stopPropagation();handleDeleteClient(c.id);}} style={{padding:"4px 10px",borderRadius:"5px",border:"none",background:"#c0392b",color:"#fff",fontSize:"10px",fontWeight:700,cursor:"pointer"}}>Yes</button>
                    <button onClick={e=>{e.stopPropagation();setConfirmDelete(null);}} style={{padding:"4px 10px",borderRadius:"5px",border:"1px solid "+C.silver,background:"#fff",color:"#666",fontSize:"10px",fontWeight:600,cursor:"pointer"}}>No</button>
                  </div>
                ) : (
                  <button onClick={e=>{e.stopPropagation();setConfirmDelete(c.id);}} style={{padding:"5px 12px",borderRadius:"6px",border:"1px solid #fcc",background:"#fff8f8",color:"#c0392b",fontSize:"10px",fontWeight:600,cursor:"pointer"}}>Delete</button>
                )}
                <button onClick={e=>{e.stopPropagation();loadClient(c,clients,true);setPresentMode(true);try{const u=new URL(window.location.href);u.searchParams.set("client",c.id);u.searchParams.set("mode","present");window.history.replaceState({},"",u.toString());}catch{}}} style={{padding:"6px 14px",borderRadius:"6px",border:"none",background:C.burgundy,color:"#fff",fontSize:"10px",fontWeight:700,cursor:"pointer"}}>Present</button>
                <div style={{padding:"6px 14px",borderRadius:"6px",background:C.navy,color:"#fff",fontSize:"10px",fontWeight:700}}>Open →</div>
              </div>
            </div>
          );
        })}
      </div>

      {namePromptModal}
      {showForm&&<ClientForm existing={editingClient} onSave={handleSaveClient} onCancel={()=>{setShowForm(false);setEditingClient(null);}}/>}
    </div>
  );

    // ── Dashboard ──
  return (
    <div style={{minHeight:"100vh",background:C.offwhite,fontFamily:"'Helvetica Neue',Arial,sans-serif"}}>
      <GlobalStyles/>
      <MobileWarning/>
      <MobileWarning/>

      {/* Header */}
      <div style={{background:C.navy,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 18px rgba(0,0,0,0.25)"}}>
        <div style={{padding:"13px 0",display:"flex",alignItems:"center",gap:"10px"}}>
          <div title="Back to all clients" style={{width:"30px",height:"30px",borderRadius:"6px",flexShrink:0,cursor:"pointer",transition:"box-shadow 0.15s",overflow:"hidden"}} onClick={()=>{setActiveId(null);setClientInURL(null);setIsDirty(false);setPresentMode(false);}} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 0 0 3px rgba(255,255,255,0.35)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
            <img src="/icon1.png" alt="FreedomOps" style={{width:"30px",height:"30px",objectFit:"contain",display:"block"}}/>
          </div>
          <div>
            <div style={{color:"#fff",fontWeight:700,fontSize:"14px"}}>{activeClient?.name} × FreedomOps</div>
            <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase"}}>Impact Modeler</div>
          </div>

          {/* Client switcher — next to logo, prep mode only */}
          {!presentMode&&(
            <div style={{position:"relative",marginLeft:"6px"}}>
              <button onClick={()=>{setShowMenu(v=>!v);setShowScenarioMenu(false);setShowShareMenu(false);setShowExportMenu(false);}} style={{padding:"5px 10px",borderRadius:"6px",border:"1px solid rgba(255,255,255,0.2)",background:"rgba(255,255,255,0.08)",color:C.tan,fontSize:"10px",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:"5px",whiteSpace:"nowrap"}}>
                👤 {activeClient?.name} <span style={{fontSize:"8px",opacity:0.5}}>▼</span>
              </button>
              {showMenu&&(
                <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,background:"#fff",borderRadius:"8px",boxShadow:"0 8px 32px rgba(0,0,0,0.2)",minWidth:"240px",zIndex:200,overflow:"hidden"}}>
                  <div style={{padding:"8px 12px 6px",background:C.navy,color:C.tan,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    Clients
                    <button onClick={()=>{setShowMenu(false);setEditingClient(null);setShowForm(true);}} style={{background:C.burgundy,border:"none",color:"#fff",borderRadius:"4px",padding:"2px 8px",fontSize:"9px",fontWeight:700,cursor:"pointer"}}>+ New</button>
                  </div>
                  {clients.map(c=>(
                    <div key={c.id} style={{padding:"10px 14px",cursor:"pointer",fontSize:"12px",color:c.id===activeId?C.burgundy:C.navy,background:c.id===activeId?"#fdf5f6":"#fff",borderBottom:"1px solid "+C.silver,display:"flex",justifyContent:"space-between",alignItems:"center"}} onMouseEnter={e=>e.currentTarget.style.background=c.id===activeId?"#fdf5f6":"#f5f5f5"} onMouseLeave={e=>e.currentTarget.style.background=c.id===activeId?"#fdf5f6":"#fff"}>
                      <div onClick={()=>loadClient(c)} style={{flex:1}}>
                        {c.id===activeId&&"✓ "}<strong>{c.name}</strong>
                        <div style={{fontSize:"9px",color:"#aaa",fontWeight:400,marginTop:"1px",textTransform:"capitalize"}}>{c.scenario} · {fmt(c.fee)}/mo</div>
                      </div>
                      <button onClick={e=>{e.stopPropagation();setEditingClient(c);setShowMenu(false);setShowForm(true);}} style={{padding:"2px 7px",borderRadius:"4px",border:"1px solid "+C.silver,background:"#fff",color:"#888",fontSize:"9px",cursor:"pointer",marginLeft:"6px"}}>Edit</button>
                    </div>
                  ))}
                  <div onClick={()=>{setActiveId(null);setClientInURL(null);setShowMenu(false);setIsDirty(false);setPresentMode(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:"8px",background:"#fafafa"}} onMouseEnter={e=>e.currentTarget.style.background="#f0f0f0"} onMouseLeave={e=>e.currentTarget.style.background="#fafafa"}>
                    <span style={{fontSize:"11px",color:"#888"}}>←</span>
                    <span style={{fontSize:"11px",fontWeight:600,color:"#666"}}>All Clients</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{display:"flex",gap:"8px",alignItems:"center"}}>

          {/* Scenario dropdown — shown in both modes */}
          <div style={{position:"relative"}}>
            <button onClick={()=>{setShowScenarioMenu(v=>!v);setShowShareMenu(false);setShowExportMenu(false);setShowMenu(false);}} style={{padding:"6px 12px",borderRadius:"6px",border:"1px solid rgba(255,255,255,0.25)",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:"11px",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",whiteSpace:"nowrap"}}>
              <span style={{opacity:0.7}}>◈</span> {activeSc?activeSc.charAt(0).toUpperCase()+activeSc.slice(1):"Scenario"}{isDraftDirty&&<span style={{width:"6px",height:"6px",borderRadius:"50%",background:"#fbbf24",display:"inline-block",marginLeft:"2px",flexShrink:0}}/>} <span style={{fontSize:"8px",opacity:0.5}}>▼</span>
            </button>
            {showScenarioMenu&&(
              <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"#fff",borderRadius:"8px",boxShadow:"0 8px 32px rgba(0,0,0,0.2)",minWidth:"170px",zIndex:200,overflow:"hidden"}}>
                <div style={{padding:"7px 12px 5px",background:C.navy,color:C.tan,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>Scenario</div>
                {["conservative","moderate","aggressive","custom"].map(s=>{
                  const active = activeSc===s;
                  const labels = {conservative:"Conservative",moderate:"Moderate",aggressive:"Aggressive",custom:"✦ Custom"};
                  const descs = {conservative:"Lower impact",moderate:"Balanced",aggressive:"Maximum impact",custom:"Dial it in"};
                  return (
                    <div key={s} onClick={()=>{setSc(s);setShowScenarioMenu(false);}} style={{padding:"9px 14px",cursor:"pointer",background:active?"#fdf5f6":"#fff",borderBottom:"1px solid "+C.silver,display:"flex",alignItems:"center",justifyContent:"space-between"}} onMouseEnter={e=>e.currentTarget.style.background=active?"#fdf5f6":"#f5f5f5"} onMouseLeave={e=>e.currentTarget.style.background=active?"#fdf5f6":"#fff"}>
                      <div>
                        <div style={{fontSize:"12px",fontWeight:700,color:active?C.burgundy:C.navy,display:"flex",alignItems:"center",gap:"5px"}}>{labels[s]}{scenarioDrafts&&scenarioDrafts[s]&&<span style={{fontSize:"8px",color:"#b45309",fontWeight:600,background:"#fff8ec",padding:"1px 5px",borderRadius:"10px"}}>custom</span>}</div>
                        <div style={{fontSize:"9px",color:"#aaa",marginTop:"1px"}}>{descs[s]}</div>
                      </div>
                      {active&&<span style={{color:C.burgundy,fontSize:"11px"}}>✓</span>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Share dropdown — prep mode only */}
          {!presentMode&&(
            <div style={{position:"relative"}}>
              <button onClick={()=>{setShowShareMenu(v=>!v);setShowScenarioMenu(false);setShowExportMenu(false);setShowMenu(false);}} style={{padding:"6px 12px",borderRadius:"6px",border:"1px solid rgba(255,255,255,0.25)",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:"11px",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",whiteSpace:"nowrap"}}>
                🔗 Share <span style={{fontSize:"8px",opacity:0.5}}>▼</span>
              </button>
              {showShareMenu&&(
                <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"#fff",borderRadius:"8px",boxShadow:"0 8px 32px rgba(0,0,0,0.2)",minWidth:"200px",zIndex:200,overflow:"hidden"}}>
                  <div style={{padding:"7px 12px 5px",background:C.navy,color:C.tan,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>Share</div>
                  <div onClick={()=>{copyClientUrl();setShowShareMenu(false);}} style={{padding:"11px 14px",cursor:"pointer",borderBottom:"1px solid "+C.silver,background:copiedUrl?"#f0faf4":"#fff"}} onMouseEnter={e=>e.currentTarget.style.background=copiedUrl?"#f0faf4":"#f5f5f5"} onMouseLeave={e=>e.currentTarget.style.background=copiedUrl?"#f0faf4":"#fff"}>
                    <div style={{fontSize:"12px",fontWeight:700,color:copiedUrl?C.positive:C.navy}}>{copiedUrl?"✓ Copied!":"🔗 Prep URL"}</div>
                    <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>Full editing controls</div>
                  </div>
                  <div onClick={()=>{copyPresentUrl();setShowShareMenu(false);}} style={{padding:"11px 14px",cursor:"pointer",background:copiedPresent?"#f0faf4":"#fff"}} onMouseEnter={e=>e.currentTarget.style.background=copiedPresent?"#f0faf4":"#f5f5f5"} onMouseLeave={e=>e.currentTarget.style.background=copiedPresent?"#f0faf4":"#fff"}>
                    <div style={{fontSize:"12px",fontWeight:700,color:copiedPresent?C.positive:C.burgundy}}>{copiedPresent?"✓ Copied!":"🎯 Present URL"}</div>
                    <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>Clean pitch mode, locked</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Export dropdown — prep mode only */}
          {!presentMode&&(
            <div style={{position:"relative"}}>
              <button onClick={()=>{setShowExportMenu(v=>!v);setShowScenarioMenu(false);setShowShareMenu(false);setShowMenu(false);}} style={{padding:"6px 12px",borderRadius:"6px",border:"1px solid rgba(255,255,255,0.25)",background:"rgba(255,255,255,0.1)",color:"#fff",fontSize:"11px",fontWeight:600,cursor:"pointer",display:"flex",alignItems:"center",gap:"6px",whiteSpace:"nowrap"}}>
                ⬇ Export <span style={{fontSize:"8px",opacity:0.5}}>▼</span>
              </button>
              {showExportMenu&&(
                <div style={{position:"absolute",top:"calc(100% + 6px)",right:0,background:"#fff",borderRadius:"8px",boxShadow:"0 8px 32px rgba(0,0,0,0.2)",minWidth:"180px",zIndex:200,overflow:"hidden"}}>
                  <div style={{padding:"7px 12px 5px",background:C.navy,color:C.tan,fontSize:"9px",fontWeight:700,letterSpacing:"0.1em",textTransform:"uppercase"}}>Export</div>
                  <div onClick={()=>{doSnapshot();setShowExportMenu(false);}} style={{padding:"11px 14px",cursor:"pointer",borderBottom:"1px solid "+C.silver,background:snapState==="copied"?"#f0faf4":"#fff"}} onMouseEnter={e=>e.currentTarget.style.background=snapState==="copied"?"#f0faf4":"#f5f5f5"} onMouseLeave={e=>e.currentTarget.style.background=snapState==="copied"?"#f0faf4":"#fff"}>
                    <div style={{fontSize:"12px",fontWeight:700,color:snapState==="copied"?C.positive:C.navy}}>{snapState==="copied"?"✓ Copied!":"📋 Snapshot"}</div>
                    <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>Copy key numbers</div>
                  </div>
                  <div onClick={()=>{exportToPDF({base,improved,metrics,proj,payback,fee,clientName:activeClient?.name||"",activeSc,nrrDelta,selectedInitiatives,activeCurve,actuals});setShowExportMenu(false);}} style={{padding:"11px 14px",cursor:"pointer",background:"#fff"}} onMouseEnter={e=>e.currentTarget.style.background="#f5f5f5"} onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                    <div style={{fontSize:"12px",fontWeight:700,color:C.navy}}>⬇ PDF Report</div>
                    <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>Print-ready client report</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {presentMode&&<div style={{fontSize:"9px",color:"rgba(255,255,255,0.3)",letterSpacing:"0.1em",textTransform:"uppercase",padding:"0 4px"}}>Presentation Mode</div>}
          {/* Sync status indicator */}
          {(()=>{
            const cfg={
              loading:{dot:"#94a3b8",label:"Connecting..."},
              saving: {dot:"#fbbf24",label:"Saving..."},
              synced: {dot:"#10b981",label:"Synced"},
              error:  {dot:"#ef4444",label:"Save failed"},
              offline:{dot:"#f59e0b",label:"Offline"},
            }[syncStatus]||{dot:"#aaa",label:""};
            return(
              <div style={{display:"flex",alignItems:"center",gap:"5px",padding:"0 8px"}}>
                <div style={{width:"6px",height:"6px",borderRadius:"50%",background:cfg.dot,flexShrink:0,boxShadow:syncStatus==="synced"?"0 0 4px rgba(16,185,129,0.5)":syncStatus==="saving"?"0 0 4px rgba(251,191,36,0.6)":"none"}}/>
                <span style={{fontSize:"8px",color:"rgba(255,255,255,0.4)",letterSpacing:"0.05em"}}>{cfg.label}</span>
                {(syncStatus==="error"||syncStatus==="offline")&&(
                  <button onClick={()=>{setSyncStatus("loading");sbFetchAll().then(r=>{if(r){setClients(r);saveClientsLocal(r);setSyncStatus("synced");}else setSyncStatus("offline");});}} style={{fontSize:"7px",color:"rgba(255,255,255,0.5)",background:"rgba(255,255,255,0.1)",border:"1px solid rgba(255,255,255,0.2)",borderRadius:"4px",padding:"1px 6px",cursor:"pointer",marginLeft:"2px"}}>Retry</button>
                )}
              </div>
            );
          })()}
        </div>
      </div>

      {(showMenu||showScenarioMenu||showShareMenu||showExportMenu)&&<div style={{position:"fixed",inset:0,zIndex:199}} onClick={()=>{setShowMenu(false);setShowScenarioMenu(false);setShowShareMenu(false);setShowExportMenu(false);}}/>}
      {namePromptModal}
      {!presentMode&&showForm&&<ClientForm existing={editingClient} onSave={handleSaveClient} onCancel={()=>{setShowForm(false);setEditingClient(null);}}/>}

      {!presentMode&&editFee&&(<div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}><div style={{background:"#fff",borderRadius:"12px",padding:"24px",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",minWidth:"260px"}}><div style={{fontWeight:700,color:C.navy,fontSize:"14px",marginBottom:"12px"}}>Set Monthly Fee</div><input ref={feeRef} value={rawFee} onChange={e=>setRawFee(e.target.value)} autoFocus onKeyDown={e=>{if(e.key==="Enter"){const p=parseFloat(rawFee);if(!isNaN(p)){setFee(p);saveCurrentClient({fee:p});}setEditFee(false);}if(e.key==="Escape")setEditFee(false);}} style={{width:"100%",border:"2px solid "+C.burgundy,borderRadius:"6px",padding:"8px 12px",fontSize:"16px",fontWeight:700,outline:"none",color:C.navy,boxSizing:"border-box"}}/><div style={{display:"flex",gap:"8px",marginTop:"12px"}}><button onClick={()=>{const p=parseFloat(rawFee);if(!isNaN(p)){setFee(p);saveCurrentClient({fee:p});}setEditFee(false);}} style={{flex:1,padding:"8px",background:C.navy,color:"#fff",border:"none",borderRadius:"6px",fontWeight:700,cursor:"pointer"}}>Save</button><button onClick={()=>setEditFee(false)} style={{flex:1,padding:"8px",background:C.offwhite,color:C.navy,border:"1px solid "+C.silver,borderRadius:"6px",fontWeight:600,cursor:"pointer"}}>Cancel</button></div></div></div>)}

      <div style={{padding:"20px 24px",maxWidth:"1340px",margin:"0 auto"}}>

        {/* NRR Hero */}
        <div style={{background:"linear-gradient(135deg,"+C.navy+" 0%,"+C.navyMid+" 100%)",borderRadius:"12px",padding:"20px 28px",marginBottom:"16px",boxShadow:"0 8px 32px rgba(30,58,95,0.3)",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,right:0,width:"280px",height:"100%",background:"radial-gradient(ellipse at top right,rgba(112,20,39,0.4) 0%,transparent 70%)",pointerEvents:"none"}}/>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",paddingBottom:"16px",borderBottom:"1px solid rgba(255,255,255,0.12)"}}>
            <div style={{display:"flex",alignItems:"center",gap:"20px"}}>
              <div style={{textAlign:"center"}}><div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>Current NRR</div><div style={{color:"#fff",fontSize:"34px",fontWeight:700,lineHeight:1}}>{base.nrr.toFixed(1)}<span style={{fontSize:"17px"}}>%</span></div></div>
              <div style={{color:C.tan,fontSize:"22px",fontWeight:300}}>→</div>
              <div style={{textAlign:"center"}}><div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>With FreedomOps</div><div style={{color:"#6ee7a0",fontSize:"34px",fontWeight:700,lineHeight:1}}>{improved.nrr.toFixed(1)}<span style={{fontSize:"17px"}}>%</span></div></div>
              <div style={{background:"rgba(110,231,160,0.15)",border:"1px solid rgba(110,231,160,0.35)",borderRadius:"8px",padding:"8px 18px",textAlign:"center"}}><div style={{color:"rgba(110,231,160,0.75)",fontSize:"8px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"2px"}}>NRR Lift</div><div style={{color:"#6ee7a0",fontSize:"28px",fontWeight:900,lineHeight:1}}>+{nrrDelta.toFixed(1)}<span style={{fontSize:"14px"}}>pts</span></div></div>
            </div>
            <div style={{textAlign:"right",position:"relative",zIndex:1}}>
              <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>Additional ARR Impact</div>
              <div style={{color:"#fff",fontSize:"42px",fontWeight:900,lineHeight:1}}>{fmt(metrics.totalARRGain)}</div>
              <div style={{display:"inline-block",marginTop:"6px",padding:"3px 10px",background:C.burgundy,borderRadius:"20px",color:"#fff",fontSize:"9px",fontWeight:600}}>with FreedomOps</div>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px"}}>
            {[{label:"Current MRR",value:fmt(base.mrr),sub:"per month",col:"#fff"},{label:"Projected MRR",value:fmt(base.mrr+metrics.totalMRRGain),sub:"+"+fmt(metrics.totalMRRGain)+"/mo lift",col:"#6ee7a0"},{label:"Payback Period",value:payback?payback+"mo":"—",sub:"@ "+fmt(fee)+"/mo fee",col:payback?paybackColor(payback):"#aaa",clickFee:true},{label:"Monthly Gain",value:fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo",sub:"net impact",col:"#6ee7a0"}].map((item,i)=>(
              <div key={i} style={{textAlign:"center"}}><div style={{color:C.tan,fontSize:"8px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>{item.label}</div><div style={{color:item.col,fontSize:"20px",fontWeight:700}}>{item.value}</div><div onClick={item.clickFee?()=>{setRawFee(fee.toString());setEditFee(true);}:undefined} style={{color:C.silver,fontSize:"9px",marginTop:"2px",cursor:item.clickFee?"pointer":"default",borderBottom:item.clickFee?"1px dashed "+C.tan:"none",display:"inline-block"}}>{item.sub}</div></div>
            ))}
          </div>
        </div>

        <div style={{display:"grid",gridTemplateColumns:"1fr 276px",gap:"14px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>
            {activeSc==="custom"&&(<div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}><div style={{background:C.burgundy,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}><div style={{color:"#fff",fontSize:"10px",fontWeight:700,letterSpacing:"0.07em"}}>✦ CUSTOM SCENARIO</div><button onClick={()=>{setActiveSc("custom");setImproved({...customImp});}} style={{padding:"4px 12px",background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:"5px",color:"#fff",fontSize:"9px",fontWeight:700,cursor:"pointer"}}>Apply</button></div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",padding:"14px"}}>
                {rows.map(r=>{
                  const bv=base[r.field],iv=customImp[r.field],delta=iv-bv,lbetter=r.lowerIsBetter,good=lbetter?delta<0:delta>0;
                  return(<div key={r.field} style={{background:C.offwhite,borderRadius:"8px",padding:"10px"}}><div style={{fontSize:"10px",fontWeight:600,color:"#555",marginBottom:"5px"}}>{r.label}</div><div style={{display:"flex",alignItems:"center",gap:"5px",marginBottom:"6px"}}><span style={{fontSize:"9px",color:"#aaa"}}>Now: <strong style={{color:C.navy}}>{r.prefix}{bv.toFixed(r.decimals)}{r.suffix}</strong></span><span style={{color:"#ddd"}}>→</span><input type="number" value={iv} step={r.field==="supportCost"?100:r.field==="mrr"?1000:0.1} onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v)){const u={...customImp,[r.field]:v};setCustomImp(u);if(activeSc==="custom")setImproved(u);}}} style={{flex:1,border:"1.5px solid "+C.burgundy,borderRadius:"5px",padding:"3px 6px",fontSize:"11px",fontWeight:700,color:C.navy,outline:"none",textAlign:"center",minWidth:0}}/><span style={{fontSize:"9px",color:"#aaa"}}>{r.suffix}</span></div><div style={{fontSize:"9px",textAlign:"right",color:delta===0?"#aaa":good?C.positive:"#c0392b"}}>{delta===0?"—":pct((delta/bv)*100)}</div></div>);
                })}
              </div>
            </div>)}

            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,padding:"11px 16px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr 90px"}}>
                {["Metric","Current","With FreedomOps","Δ Change"].map((h,i)=>(<div key={h} style={{color:i===2?"#fff":C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",textAlign:i===0?"left":i===3?"right":"center",fontWeight:700}}>{h}</div>))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 90px",padding:"11px 16px",alignItems:"center",borderBottom:"2px solid "+C.silver,background:"#fafbfc"}}>
                <div style={{color:"#222",fontSize:"12px",fontWeight:700}}>Monthly Recurring Revenue</div>
                <div style={{textAlign:"center"}}><EditableCell value={base.mrr} onChange={v=>setBase(b=>({...b,mrr:v}))} prefix="$" suffix="" decimals={0}/></div>
                <div style={{textAlign:"center"}}><span style={{color:C.positive,fontWeight:700,fontSize:"12px"}}>{fmt(base.mrr+metrics.totalMRRGain)}</span></div>
                <div style={{textAlign:"right"}}><span style={{display:"inline-block",padding:"2px 7px",borderRadius:"20px",fontSize:"10px",fontWeight:700,background:C.posLight,color:C.positive}}>{pct((metrics.totalMRRGain/base.mrr)*100)}</span></div>
              </div>
              {rows.map(r=><MetricRow key={r.field} label={r.label} baseVal={base[r.field]} improvedVal={improved[r.field]} prefix={r.prefix} suffix={r.suffix} decimals={r.decimals} lowerIsBetter={r.lowerIsBetter} onBaseChange={updBase(r.field)} onImprovedChange={updImp(r.field)}/>)}
              <div style={{padding:"8px 16px",background:"#f8f9fb",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div style={{fontSize:"9px",color:"#aaa",fontStyle:"italic"}}>💡 Click any underlined value to edit.</div>
                {isDraftDirty&&activeSc&&activeSc!=="custom"&&(
                  <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
                    <span style={{fontSize:"9px",color:"#b45309"}}>Unsaved edits</span>
                    <button onClick={saveDraft} style={{padding:"2px 8px",borderRadius:"4px",border:"none",background:C.navy,color:"#fff",fontSize:"9px",fontWeight:700,cursor:"pointer"}}>Save</button>
                    <button onClick={revertDraft} style={{padding:"2px 8px",borderRadius:"4px",border:"1px solid "+C.silver,background:"#fff",color:"#666",fontSize:"9px",fontWeight:600,cursor:"pointer"}}>Revert</button>
                  </div>
                )}
              </div>
            </div>

            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,display:"flex",alignItems:"flex-end",padding:"0 16px"}}>
                {[["mrr","12-Month MRR Projection"],["cumulative","Cumulative ARR Gain"],["compare","Scenario Compare"]].map(([id,lbl])=>(<button key={id} onClick={()=>setTab(id)} style={{padding:"7px 14px",border:"none",cursor:"pointer",background:tab===id?"#fff":"transparent",color:tab===id?C.navy:C.tan,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:tab===id?"3px solid "+C.burgundy:"3px solid transparent",transition:"all 0.2s"}}>{lbl}</button>))}
              </div>
              <div style={{padding:"14px 16px 10px"}}>
                <div style={{fontSize:"9px",color:"#aaa",marginBottom:"10px"}}>{tab==="mrr"?"MRR trajectory with vs. without FreedomOps — hover for values.":"Cumulative additional revenue — hover for values."}</div>
                {tab==="mrr"&&<LineChartSVG data={proj}/>}
                {tab==="cumulative"&&<BarChartSVG data={proj}/>}
                {tab==="compare"&&(()=>{
                  const scenarios=["conservative","moderate","aggressive"];
                  const summaries=scenarios.map(s=>computeScenarioSummary(base,s,fee));
                  const cols=[
                    {label:"Additional ARR",fn:s=>fmt(s.totalARRGain),highlight:true},
                    {label:"MRR Lift/mo",fn:s=>"+"+fmt(s.totalMRRGain)+"/mo"},
                    {label:"NRR",fn:s=>base.nrr.toFixed(1)+"% → "+s.imp.nrr.toFixed(1)+"%"},
                    {label:"Churn",fn:s=>base.churnRate.toFixed(2)+"% → "+s.imp.churnRate.toFixed(2)+"%"},
                    {label:"Support Cost",fn:s=>fmt(base.supportCost)+" → "+fmt(s.imp.supportCost)},
                    {label:"Payback",fn:s=>s.payback?s.payback+" mo":"—"},
                    {label:"ROI",fn:s=>pct(s.roi)},
                  ];
                  const colors={conservative:"#5a7fa8",moderate:C.navy,aggressive:C.burgundy};
                  return(
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:"11px"}}>
                        <thead>
                          <tr>
                            <th style={{padding:"8px 12px",textAlign:"left",color:"#999",fontSize:"9px",fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid "+C.silver}}>Metric</th>
                            {summaries.map(s=>(
                              <th key={s.scenarioKey} style={{padding:"8px 12px",textAlign:"center",color:"#fff",fontSize:"9px",fontWeight:700,textTransform:"uppercase",borderBottom:"2px solid "+C.silver,background:colors[s.scenarioKey],borderRadius:"0"}}>
                                {s.scenarioKey.charAt(0).toUpperCase()+s.scenarioKey.slice(1)}
                                {s.scenarioKey===activeSc&&<span style={{display:"block",fontSize:"8px",opacity:0.8,fontWeight:400}}>← current</span>}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {cols.map((col,ci)=>(
                            <tr key={ci} style={{background:ci%2===0?"#fafbfc":"#fff"}}>
                              <td style={{padding:"8px 12px",color:"#555",fontWeight:600,borderBottom:"1px solid "+C.silver}}>{col.label}</td>
                              {summaries.map(s=>(
                                <td key={s.scenarioKey} style={{padding:"8px 12px",textAlign:"center",fontWeight:col.highlight?900:700,fontSize:col.highlight?"13px":"11px",color:col.highlight?colors[s.scenarioKey]:C.navy,borderBottom:"1px solid "+C.silver}}>
                                  {col.fn(s)}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <div style={{fontSize:"9px",color:"#aaa",padding:"8px 12px",fontStyle:"italic"}}>Based on current client metrics. Click a scenario above to apply it.</div>
                    </div>
                  );
                })()}
              </div>
            </div>

            {/* Actuals & Growth Plan inline panel */}
            {(()=>{
              const entered = actuals.map((v,i)=>v!=null?{i,v}:null).filter(Boolean);
              const mo = entered.length;
              const latestV = mo>0 ? entered[mo-1].v : null;
              const prevV = mo>1 ? entered[mo-2].v : null;
              const momChange = latestV!=null&&prevV!=null ? latestV-prevV : null;
              const aheadCount = entered.filter(({i,v})=>proj[i]&&v>=proj[i].with).length;
              const behindCount = mo - aheadCount;
              const budgetAtMo = mo>0&&targetMRR>0 ? base.mrr+(targetMRR-base.mrr)*(mo/12) : null;
              const vsBudgetPct = latestV&&budgetAtMo ? ((latestV-budgetAtMo)/budgetAtMo)*100 : null;
              // catch-up: need to average X MRR over remaining months to hit annual target
              const remainingMonths = 12-mo;
              const actualARRSoFar = entered.reduce((s,{v})=>s+v*12/12,0); // approximate
              const mrrSoFar = entered.reduce((s,{v})=>s+v,0);
              const catchUpMRR = annualTarget>0&&remainingMonths>0 ? (annualTarget - mrrSoFar*12/mo*12 + mrrSoFar) : null;
              // simpler: need avgMRR over remaining so total ARR hits target
              const neededAvgMRR = annualTarget>0&&mo>0&&remainingMonths>0
                ? (annualTarget/12 - (mrrSoFar/mo) * (mo/12)*0 + (annualTarget - mrrSoFar * (12/mo)) / remainingMonths )
                : null;
              // cleanest version: total ARR = sum of all 12 months * some factor; just: need (annualTarget/12)*12 total MRR. So remaining needed = annualTarget/12*12 - mrrSoFar over remaining months
              const totalMRRNeeded = annualTarget>0 ? annualTarget/12*12 : null; // annualTarget IS the ARR
              const mrrNeededRemaining = totalMRRNeeded&&remainingMonths>0 ? (totalMRRNeeded - mrrSoFar) / remainingMonths : null;
              const onTrack = mrrNeededRemaining!=null&&latestV!=null ? latestV >= mrrNeededRemaining : null;

              return(
                <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
                  {/* Header */}
                  <div style={{background:C.navy,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"10px"}}>
                      <div style={{color:"#fff",fontSize:"10px",fontWeight:700,letterSpacing:"0.07em"}}>ACTUALS VS PLAN</div>
                      {mo>0&&<div style={{fontSize:"9px",color:C.tan}}>{mo} of 12 months tracked</div>}
                    </div>
                    <div style={{display:"flex",gap:"8px",alignItems:"center"}}>
                      {vsBudgetPct!=null&&<span style={{fontSize:"10px",fontWeight:700,color:vsBudgetPct>=0?"#6ee7a0":"#f87171",background:vsBudgetPct>=0?"rgba(110,231,160,0.15)":"rgba(248,113,113,0.15)",padding:"3px 9px",borderRadius:"20px"}}>{vsBudgetPct>=0?"+":""}{vsBudgetPct.toFixed(1)}% vs budget</span>}
                      {presentMode&&<button onClick={()=>setShowActuals(v=>!v)} style={{padding:"3px 10px",borderRadius:"5px",border:"1px solid rgba(255,255,255,0.25)",background:showActuals?"rgba(16,185,129,0.3)":"rgba(255,255,255,0.1)",color:showActuals?"#6ee7a0":C.tan,fontSize:"9px",fontWeight:600,cursor:"pointer"}}>{showActuals?"Hide Actuals":"Show Actuals"}</button>}
                      {!presentMode&&<button onClick={()=>saveCurrentClient()} style={{padding:"3px 10px",borderRadius:"5px",border:"1px solid rgba(255,255,255,0.25)",background:"rgba(255,255,255,0.1)",color:C.tan,fontSize:"9px",fontWeight:600,cursor:"pointer"}}>Save</button>}
                    </div>
                  </div>

                  {(!presentMode||(presentMode&&showActuals))&&(
                    <div style={{padding:"14px 16px"}}>

                      {/* Story bar: running score + velocity + catch-up */}
                      {mo>0&&(
                        <div style={{display:"grid",gridTemplateColumns:aheadCount+behindCount>0&&mrrNeededRemaining!=null?"1fr 1fr 1fr":"1fr 1fr",gap:"10px",marginBottom:"14px"}}>
                          {/* Score */}
                          <div style={{background:C.offwhite,borderRadius:"8px",padding:"10px 12px"}}>
                            <div style={{fontSize:"8px",color:"#aaa",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:"4px"}}>Running Score</div>
                            <div style={{display:"flex",alignItems:"baseline",gap:"6px"}}>
                              {aheadCount>0&&<span style={{fontSize:"16px",fontWeight:800,color:"#10b981"}}>{aheadCount}<span style={{fontSize:"9px",fontWeight:600}}> ahead</span></span>}
                              {behindCount>0&&<span style={{fontSize:"16px",fontWeight:800,color:"#ef4444"}}>{behindCount}<span style={{fontSize:"9px",fontWeight:600}}> behind</span></span>}
                              {aheadCount===0&&behindCount===0&&<span style={{fontSize:"12px",color:"#aaa"}}>—</span>}
                            </div>
                            <div style={{fontSize:"8px",color:"#bbb",marginTop:"2px"}}>vs FreedomOps projection</div>
                          </div>

                          {/* Velocity */}
                          <div style={{background:C.offwhite,borderRadius:"8px",padding:"10px 12px"}}>
                            <div style={{fontSize:"8px",color:"#aaa",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:"4px"}}>MoM Velocity</div>
                            {momChange!=null?(
                              <div>
                                <div style={{fontSize:"16px",fontWeight:800,color:momChange>=0?"#10b981":"#ef4444"}}>{momChange>=0?"+":""}{fmt(momChange)}</div>
                                <div style={{fontSize:"8px",color:"#bbb",marginTop:"2px"}}>{momChange>=0?"accelerating":"decelerating"} vs last month</div>
                              </div>
                            ):(
                              <div>
                                <div style={{fontSize:"13px",fontWeight:700,color:"#ccc"}}>—</div>
                                <div style={{fontSize:"8px",color:"#bbb",marginTop:"2px"}}>need 2+ months</div>
                              </div>
                            )}
                          </div>

                          {/* Catch-up target */}
                          {mrrNeededRemaining!=null&&remainingMonths>0&&(
                            <div style={{background:onTrack?"#f0fdf8":latestV&&latestV<mrrNeededRemaining?"#fff5f5":C.offwhite,borderRadius:"8px",padding:"10px 12px",border:"1px solid "+(onTrack?"#a7f3d0":latestV&&latestV<mrrNeededRemaining?"#fecaca":"transparent")}}>
                              <div style={{fontSize:"8px",color:"#aaa",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:"4px"}}>Needed to Hit Goal</div>
                              <div style={{fontSize:"16px",fontWeight:800,color:onTrack?"#10b981":"#ef4444"}}>{fmt(mrrNeededRemaining)}<span style={{fontSize:"9px",fontWeight:600}}>/mo</span></div>
                              <div style={{fontSize:"8px",color:"#bbb",marginTop:"2px"}}>avg over {remainingMonths} remaining mo{remainingMonths!==1?"s":""}</div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Timeline milestone tracker */}
                      <div style={{marginBottom:"14px",padding:"10px 14px",background:C.offwhite,borderRadius:"8px"}}>
                        <div style={{fontSize:"8px",color:"#aaa",textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:"8px"}}>Year Progress</div>
                        <div style={{display:"flex",alignItems:"center",gap:"0"}}>
                          {actuals.map((v,i)=>{
                            const isEntered=v!=null;
                            const projV=proj[i]?.with;
                            const isAhead=isEntered&&projV&&v>=projV;
                            const isCurrent=isEntered&&(i===11||actuals[i+1]==null);
                            const dotColor=isEntered?(isAhead?"#10b981":"#ef4444"):"#e2e8f0";
                            const lineColor=i<mo-1?"#10b981":"#e2e8f0";
                            return(
                              <div key={i} style={{display:"flex",alignItems:"center",flex:i<11?1:"auto"}}>
                                <div style={{position:"relative",display:"flex",flexDirection:"column",alignItems:"center"}}>
                                  <div style={{width:isCurrent?"12px":"8px",height:isCurrent?"12px":"8px",borderRadius:"50%",background:dotColor,border:isCurrent?"2px solid "+(isAhead?"#10b981":"#ef4444"):"none",boxShadow:isCurrent?"0 0 0 3px "+(isAhead?"rgba(16,185,129,0.2)":"rgba(239,68,68,0.2)"):"none",transition:"all 0.2s",flexShrink:0}}/>
                                  <div style={{fontSize:"7px",color:isEntered?(isAhead?"#10b981":"#ef4444"):"#bbb",marginTop:"3px",fontWeight:isCurrent?700:400}}>M{i+1}</div>
                                </div>
                                {i<11&&<div style={{flex:1,height:"2px",background:lineColor,marginBottom:"10px",marginLeft:"1px",marginRight:"1px"}}/>}
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      {/* Growth plan targets */}
                      {(annualTarget>0||targetMRR>0)&&(
                        <div style={{display:"flex",gap:"16px",marginBottom:"14px",padding:"8px 12px",background:"#f8f9fb",borderRadius:"7px",alignItems:"center",flexWrap:"wrap",borderLeft:"3px solid "+C.navy}}>
                          {annualTarget>0&&<div><span style={{fontSize:"9px",color:"#aaa",textTransform:"uppercase",letterSpacing:"0.07em"}}>ARR Goal </span><span style={{fontWeight:700,color:C.navy,fontSize:"12px"}}>{fmt(annualTarget)}/yr</span>{metrics.totalARRGain>0&&<span style={{fontSize:"9px",color:C.positive,marginLeft:"6px"}}>FO covers {Math.min(((metrics.totalARRGain/annualTarget)*100),100).toFixed(0)}%</span>}</div>}
                          {annualTarget>0&&targetMRR>0&&<div style={{width:"1px",height:"16px",background:C.silver}}/>}
                          {targetMRR>0&&<div><span style={{fontSize:"9px",color:"#aaa",textTransform:"uppercase",letterSpacing:"0.07em"}}>M12 Target </span><span style={{fontWeight:700,color:C.navy,fontSize:"12px"}}>{fmt(targetMRR)}/mo</span><span style={{fontSize:"9px",color:"#aaa",marginLeft:"5px"}}>gap: {fmt(Math.max(targetMRR-(base.mrr+metrics.totalMRRGain),0))}</span></div>}
                        </div>
                      )}

                      {/* Month input grid */}
                      {!presentMode&&(
                        <>
                          <div style={{fontSize:"9px",color:"#aaa",marginBottom:"6px",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>Enter actual MRR</div>
                          <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:"5px",marginBottom:"5px"}}>
                            {actuals.map((v,i)=>{
                              const proj_v=proj[i]?.with;
                              const budget_v=targetMRR>0?base.mrr+(targetMRR-base.mrr)*((i+1)/12):null;
                              const isAhead=v!=null&&proj_v&&v>=proj_v;
                              const vsBudget=v!=null&&budget_v!=null?v-budget_v:null;
                              return(
                                <div key={i} style={{textAlign:"center"}}>
                                  <div style={{fontSize:"8px",color:"#bbb",marginBottom:"2px"}}>M{i+1}</div>
                                  <input
                                    type="number"
                                    step={1000}
                                    value={v===null||v===undefined?"":v}
                                    placeholder="—"
                                    onFocus={e=>{
                                      // autofill from previous month if this cell is empty
                                      if((v===null||v===undefined) && i>0){
                                        const prev=actuals[i-1];
                                        if(prev!=null){
                                          const next=[...actuals];
                                          next[i]=prev;
                                          setActuals(next);
                                          setIsDirty(true);
                                          // select all so user can immediately type over it
                                          setTimeout(()=>e.target.select(),0);
                                        }
                                      }
                                    }}
                                    onChange={e=>{
                                      const val=e.target.value===""?null:parseFloat(e.target.value);
                                      const next=[...actuals];
                                      next[i]=isNaN(val)?null:val;
                                      setActuals(next);
                                      setIsDirty(true);
                                    }}
                                    style={{width:"100%",border:"1.5px solid "+(v!=null?isAhead?"#10b981":"#ef4444":C.silver),borderRadius:"5px",padding:"4px 2px",fontSize:"10px",fontWeight:700,color:v!=null?isAhead?"#10b981":"#ef4444":C.navy,textAlign:"center",outline:"none",background:v!=null?isAhead?"#f0fdf8":"#fff5f5":"#fff",boxSizing:"border-box"}}
                                  />
                                  {vsBudget!==null&&<div style={{fontSize:"7px",marginTop:"1px",color:vsBudget>=0?"#10b981":"#ef4444"}}>{vsBudget>=0?"+":""}{(vsBudget/budget_v*100).toFixed(0)}%</div>}
                                </div>
                              );
                            })}
                          </div>
                          <div style={{fontSize:"8px",color:"#bbb",fontStyle:"italic"}}>Green = ahead of projection · Red = behind · % = vs budget</div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Change Log — prep mode only */}
            {!presentMode&&(
              <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
                <div style={{background:C.navy,padding:"10px 14px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <div style={{color:"#fff",fontSize:"9px",fontWeight:700,letterSpacing:"0.07em"}}>CHANGE LOG</div>
                  {username&&<span style={{fontSize:"8px",color:C.tan}}>You: {username}</span>}
                </div>
                <div style={{padding:"10px 12px",maxHeight:"220px",overflowY:"auto"}}>
                  {changelog.length===0?(
                    <div style={{fontSize:"9px",color:"#ccc",fontStyle:"italic",textAlign:"center",padding:"12px 0"}}>No changes recorded yet</div>
                  ):[...changelog].reverse().map((entry,i)=>(
                    <div key={i} style={{display:"flex",gap:"8px",padding:"5px 0",borderBottom:"1px solid "+C.offwhite,alignItems:"flex-start"}}>
                      <div style={{width:"22px",height:"22px",borderRadius:"50%",background:C.navy,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,marginTop:"1px"}}>
                        <span style={{color:"#fff",fontSize:"7px",fontWeight:700}}>{initials(entry.user)}</span>
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:"9px",color:"#444",lineHeight:1.4}}><span style={{fontWeight:700,color:C.navy}}>{entry.user}</span> {entry.msg}</div>
                        <div style={{fontSize:"7px",color:"#bbb",marginTop:"1px"}}>{timeAgo(entry.ts)}</div>
                      </div>
                    </div>
                  ))}
                </div>
                {!username&&(
                  <div style={{padding:"8px 12px",borderTop:"1px solid "+C.offwhite,display:"flex",alignItems:"center",gap:"6px"}}>
                    <span style={{fontSize:"8px",color:"#aaa"}}>Set your name:</span>
                    <input
                      placeholder="Your name"
                      style={{flex:1,border:"1px solid "+C.silver,borderRadius:"5px",padding:"3px 7px",fontSize:"9px",outline:"none",color:C.navy}}
                      onKeyDown={e=>{if(e.key==="Enter"&&e.target.value.trim()){setUsername(e.target.value.trim());setUsernameState(e.target.value.trim());}}}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>

            {/* ── Engagement Plan (moved to top of right col) ── */}
            {(()=>{
              const activeCurveObj=CURVES[activeCurve]||CURVES[DEFAULT_CURVE];
              const selLabels=selectedInitiatives.map(id=>INITIATIVES.find(x=>x.id===id)?.label).filter(Boolean);
              const sources=[...new Set(selectedInitiatives.map(id=>INITIATIVES.find(x=>x.id===id)?.source).filter(Boolean))];
              return(
                <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
                  {/* Header */}
                  <div onClick={()=>{if(!presentMode)setShowPlanDropdown(v=>!v);}} style={{background:C.navy,padding:"11px 16px",display:"flex",justifyContent:"space-between",alignItems:"center",cursor:presentMode?"default":"pointer"}}>
                    <div style={{display:"flex",alignItems:"center",gap:"8px",flexWrap:"wrap"}}>
                      <div style={{color:"#fff",fontSize:"10px",fontWeight:700,letterSpacing:"0.07em"}}>ENGAGEMENT PLAN</div>
                      <span style={{fontSize:"8px",fontWeight:600,color:activeCurveObj.color==="#10b981"?"#6ee7a0":activeCurveObj.color===C.burgundy?"#fca5a5":"#93c5fd",background:"rgba(255,255,255,0.1)",padding:"2px 7px",borderRadius:"10px",border:"1px solid rgba(255,255,255,0.15)"}}>{activeCurveObj.label}</span>
                      {selLabels.slice(0,2).map(l=>(<span key={l} style={{fontSize:"8px",color:C.tan,background:"rgba(255,255,255,0.08)",padding:"2px 7px",borderRadius:"10px",border:"1px solid rgba(255,255,255,0.1)"}}>{l}</span>))}
                      {selLabels.length>2&&<span style={{fontSize:"8px",color:"rgba(255,255,255,0.4)",padding:"2px 4px"}}>+{selLabels.length-2}</span>}
                    </div>
                    {!presentMode&&<span style={{fontSize:"11px",color:"rgba(255,255,255,0.4)",userSelect:"none",flexShrink:0}}>{showPlanDropdown?"▲":"▼"}</span>}
                  </div>

                  {/* Curve selector — always visible */}
                  {(!presentMode||selLabels.length>0)&&(
                    <div style={{padding:"12px 14px",borderBottom:"1px solid "+C.silver}}>
                      {!presentMode&&(
                        <>
                          <div style={{fontSize:"8px",color:"#aaa",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"7px"}}>Growth Curve</div>
                          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px"}}>
                            {Object.values(CURVES).map(cv=>{
                              const active=activeCurve===cv.id;
                              return(
                                <div key={cv.id} onClick={e=>{e.stopPropagation();setActiveCurve(cv.id);}} style={{padding:"7px 8px",borderRadius:"7px",border:"1.5px solid "+(active?cv.color:C.silver),background:active?"#f8f9fb":"#fff",cursor:"pointer",transition:"all 0.15s"}}>
                                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"3px"}}>
                                    <span style={{fontSize:"9px",fontWeight:700,color:active?cv.color:C.navy}}>{cv.label}</span>
                                    <SparklineSVG values={cv.sparkline} color={active?cv.color:"#ccc"} width={36} height={14}/>
                                  </div>
                                  <div style={{fontSize:"7px",color:"#bbb",lineHeight:1.3}}>{cv.desc}</div>
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                      {presentMode&&selLabels.length>0&&(
                        <div style={{display:"flex",gap:"5px",flexWrap:"wrap"}}>
                          {selLabels.map(l=>(<span key={l} style={{fontSize:"9px",fontWeight:600,color:C.navy,background:C.offwhite,padding:"3px 8px",borderRadius:"20px"}}>{l}</span>))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Initiatives dropdown — only this part collapses */}
                  {!presentMode&&showPlanDropdown&&(
                    <div style={{padding:"12px 14px"}}>
                      <div style={{fontSize:"8px",color:"#aaa",fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:"7px"}}>Initiatives</div>
                      <div style={{display:"flex",flexDirection:"column",gap:"4px"}}>
                        {INITIATIVES.map(init=>{
                          const active=selectedInitiatives.includes(init.id);
                          const curve=CURVES[init.curve];
                          return(
                            <div key={init.id} onClick={e=>{
                              e.stopPropagation();
                              const next=active?selectedInitiatives.filter(x=>x!==init.id):[...selectedInitiatives,init.id];
                              applyInitiativeSet(next);
                            }} style={{display:"flex",alignItems:"center",gap:"8px",padding:"7px 9px",borderRadius:"6px",border:"1px solid "+(active?C.navy:C.silver),background:active?"#f8f9fb":"#fff",cursor:"pointer",transition:"all 0.15s"}}>
                              <div style={{width:"13px",height:"13px",borderRadius:"3px",border:"2px solid "+(active?C.navy:C.silver),background:active?C.navy:"#fff",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                                {active&&<span style={{color:"#fff",fontSize:"8px",lineHeight:1}}>✓</span>}
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{display:"flex",alignItems:"center",gap:"5px"}}>
                                  <span style={{fontSize:"10px",fontWeight:700,color:active?C.navy:"#444"}}>{init.label}</span>
                                  <span style={{fontSize:"7px",color:"#aaa",background:C.offwhite,padding:"1px 4px",borderRadius:"8px"}}>{init.tag}</span>
                                </div>
                                <div style={{fontSize:"8px",color:"#aaa",marginTop:"1px",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{init.desc}</div>
                              </div>
                              <SparklineSVG values={curve.sparkline} color={active?curve.color:"#ddd"} width={30} height={14}/>
                            </div>
                          );
                        })}
                      </div>
                      {selectedInitiatives.length>0&&(
                        <div style={{marginTop:"5px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                          <div style={{fontSize:"7px",color:"#bbb",fontStyle:"italic"}}>Source: {sources.join(" · ")}</div>
                          <button onClick={e=>{e.stopPropagation();applyInitiativeSet([]);}} style={{fontSize:"8px",color:"#aaa",background:"none",border:"none",cursor:"pointer",textDecoration:"underline"}}>Clear</button>
                        </div>
                      )}
                      <div style={{borderTop:"1px solid "+C.silver,paddingTop:"9px",marginTop:"10px",display:"flex",justifyContent:"flex-end"}}>
                        <button onClick={e=>{e.stopPropagation();saveCurrentClient();setShowPlanDropdown(false);}} style={{padding:"5px 16px",borderRadius:"6px",border:"none",background:C.navy,color:"#fff",fontSize:"9px",fontWeight:700,cursor:"pointer"}}>Save &amp; Close</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* MRR Gain Breakdown */}
            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.burgundy,padding:"10px 14px"}}><div style={{color:"#fff",fontSize:"9px",fontWeight:700,letterSpacing:"0.07em"}}>MRR GAIN BREAKDOWN</div></div>
              <div style={{padding:"12px"}}>
                <WBar label="Churn Reduction" value={metrics.churnSaved} maxVal={maxWF} color={C.navy}/>
                <WBar label="Expansion Revenue" value={metrics.expansionGain} maxVal={maxWF} color={C.burgundy}/>
                <WBar label="Support Cost Savings" value={metrics.costSaved} maxVal={maxWF} color="#5a7fa8"/>
                <div style={{fontSize:"8px",color:"#aaa",fontStyle:"italic",marginTop:"4px",marginBottom:"4px"}}>NRR lift shown separately — captured within retention & expansion.</div>
                <div style={{marginTop:"10px",paddingTop:"10px",borderTop:"2px solid "+C.navy,display:"flex",justifyContent:"space-between"}}><span style={{fontSize:"9px",fontWeight:700,color:C.navy}}>Total Monthly</span><span style={{fontSize:"13px",fontWeight:900,color:C.navy}}>{fmt(metrics.totalMRRGain+metrics.costSaved)}/mo</span></div>
              </div>
            </div>

            {/* Callout cards */}
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              {callouts.map(c=>(<div key={c.label} style={{background:"#fff",borderRadius:"8px",padding:"11px",borderTop:"3px solid "+c.color,boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}><div style={{fontSize:"7px",color:"#999",letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:"3px"}}>{c.label}</div><div style={{fontSize:"16px",fontWeight:900,color:c.color,lineHeight:1.1}}>{c.value}</div><div style={{fontSize:"9px",color:"#bbb",marginTop:"2px"}}>{c.sub}</div></div>))}
            </div>

            {/* Payback Calculator */}
            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,padding:"10px 14px"}}><div style={{color:"#fff",fontSize:"9px",fontWeight:700,letterSpacing:"0.07em"}}>PAYBACK CALCULATOR</div></div>
              <div style={{padding:"12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"10px"}}><span style={{fontSize:"10px",color:"#666"}}>Monthly Fee:</span><span onClick={()=>{setRawFee(fee.toString());setEditFee(true);}} style={{fontWeight:700,fontSize:"12px",color:C.navy,cursor:"pointer",borderBottom:"2px dashed "+C.tan,padding:"1px 2px"}}>{fmt(fee)}/mo</span></div>
                {[{label:"Monthly Impact",value:fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo",color:C.navy},{label:"Annual Investment",value:fmt(fee*12),color:"#888"},{label:"Annual Return",value:fmt(metrics.totalARRGain),color:C.positive},{label:"ROI",value:pct(((metrics.totalARRGain-fee*12)/(fee*12))*100),color:C.positive}].map(item=>(<div key={item.label} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid "+C.silver}}><span style={{fontSize:"10px",color:"#777"}}>{item.label}</span><span style={{fontSize:"11px",fontWeight:700,color:item.color}}>{item.value}</span></div>))}
                <div style={{marginTop:"11px",padding:"9px",background:paybackBg(payback),borderRadius:"7px",textAlign:"center",border:"1px solid "+paybackBorder(payback)}}>
                  <div style={{fontSize:"8px",color:"#999",letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:"2px"}}>Payback Period</div>
                  <div style={{fontSize:"20px",fontWeight:900,color:paybackColor(payback)}}>{payback?payback+" months":"—"}</div>
                  <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>{payback?payback<=12?"strong return":payback<=24?"solid investment":"long-term play":"not yet calculable"}</div>
                </div>
              </div>
            </div>

            {/* Key Assumptions */}
            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,padding:"10px 14px"}}><div style={{color:"#fff",fontSize:"9px",fontWeight:700,letterSpacing:"0.07em"}}>KEY ASSUMPTIONS</div></div>
              <div style={{padding:"12px"}}>
                {(()=>{
                  const activeCurveObj=CURVES[activeCurve]||CURVES[DEFAULT_CURVE];
                  const selInits=selectedInitiatives.map(id=>INITIATIVES.find(x=>x.id===id)).filter(Boolean);
                  const rows=[
                    {label:"Scenario",value:activeSc?activeSc.charAt(0).toUpperCase()+activeSc.slice(1):"Custom",note:activeSc==="custom"?"manually set":null},
                    {label:"Growth Curve",value:activeCurveObj.label,note:activeCurveObj.desc.split(".")[0]},
                    {label:"Ramp to Full Impact",value:activeCurve==="quickwin"?"~4 months":activeCurve==="steadybuild"?"~7 months":"~10 months",note:null},
                    {label:"Monthly Fee",value:fmt(fee)+"/mo",note:"click fee to edit"},
                    {label:"Base MRR",value:fmt(base.mrr)+"/mo",note:"current state"},
                    {label:"Churn Assumption",value:base.churnRate+"% → "+improved.churnRate+"%",note:improved.churnRate<base.churnRate?"improvement modeled":null},
                    {label:"NRR Assumption",value:base.nrr+"% → "+improved.nrr+"%",note:null},
                    {label:"Initiatives",value:selInits.length>0?selInits.map(x=>x.label).join(", "):"None selected",note:selInits.length>0?selInits.length+" applied":null},
                  ];
                  return rows.map(r=>(
                    <div key={r.label} style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",padding:"5px 0",borderBottom:"1px solid "+C.offwhite}}>
                      <span style={{fontSize:"9px",color:"#888",flexShrink:0,marginRight:"8px"}}>{r.label}</span>
                      <div style={{textAlign:"right"}}>
                        <span style={{fontSize:"10px",fontWeight:700,color:C.navy}}>{r.value}</span>
                        {r.note&&<div style={{fontSize:"7px",color:"#bbb",marginTop:"1px"}}>{r.note}</div>}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>

          </div>
        </div>
        <div style={{textAlign:"center",marginTop:"16px",color:"#ccc",fontSize:"9px",letterSpacing:"0.08em"}}>{activeClient?.name?.toUpperCase()} × FREEDOMOPS CONFIDENTIAL · FOR DISCUSSION PURPOSES ONLY</div>
      </div>
    </div>
  );
}

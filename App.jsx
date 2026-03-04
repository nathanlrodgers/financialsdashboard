import { useState, useRef, useMemo, useEffect } from "react";

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
const STORAGE_KEY = "fo_clients_v1";

// ── Helpers ───────────────────────────────────────────────────
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
function buildProjection(base, imp) {
  const costSave=base.supportCost-imp.supportCost;
  const RAMP_MONTHS=3; // improvements phase in linearly over 3 months
  let bMRR=base.mrr, wMRR=base.mrr, cumGap=0;
  return Array.from({length:12},(_,i)=>{
    const ramp=Math.min((i+1)/RAMP_MONTHS,1); // 0.33, 0.66, 1.0, 1.0...
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
    base:{mrr:140000,churnRate:6.1,nrr:96,ttfv:52,expansionRate:7.8,supportCost:22000,csat:68}, customImp:null },
  { id:"globex-inc", name:"Globex Inc", fee:4500, scenario:"aggressive",
    base:{mrr:95000,churnRate:7.4,nrr:94,ttfv:60,expansionRate:6.2,supportCost:14000,csat:71}, customImp:null },
];
function loadClients() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY)||"null");
    return stored || SAMPLE_CLIENTS;
  } catch { return SAMPLE_CLIENTS; }
}
function isUsingDemoData() {
  try { return !localStorage.getItem(STORAGE_KEY); } catch { return false; }
}
function saveClients(clients) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(clients)); } catch { /* sandboxed */ }
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
  const [step, setStep]       = useState(1); // 1=basics, 2=metrics, 3=scenario

  const canNext1 = name.trim().length > 0;

  const handleSave = () => {
    const id = existing?.id || slug(name) || `client-${Date.now()}`;
    onSave({ id, name: name.trim(), fee, scenario, base, customImp });
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
function LineChartSVG({data}){
  const[tip,setTip]=useState(null);
  const W=560,H=200,PL=68,PR=14,PT=10,PB=30,iW=W-PL-PR,iH=H-PT-PB;
  const allV=data.flatMap(d=>[d.without,d.with]);
  const minV=Math.min(...allV)*0.97,maxV=Math.max(...allV)*1.02;
  const xP=i=>PL+(i/(data.length-1))*iW, yP=v=>PT+iH-((v-minV)/(maxV-minV))*iH;
  const yTicks=Array.from({length:4},(_,i)=>minV+(i/3)*(maxV-minV));
  return(
    <div style={{position:"relative"}}>
      <svg width="100%" viewBox={"0 0 "+W+" "+H} style={{display:"block"}}>
        {yTicks.map((v,i)=>(<g key={i}><line x1={PL} x2={W-PR} y1={yP(v)} y2={yP(v)} stroke={C.silver} strokeWidth="1" strokeDasharray="3 3"/><text x={PL-5} y={yP(v)+4} textAnchor="end" fontSize="8.5" fill="#999">{fmt(v)}</text></g>))}
        {data.map((d,i)=><text key={i} x={xP(i)} y={H-5} textAnchor="middle" fontSize="8.5" fill="#999">{d.month}</text>)}
        <polygon points={[...data.map((d,i)=>`${xP(i)},${yP(d.with)}`),...data.slice().reverse().map((d,i)=>`${xP(data.length-1-i)},${yP(d.without)}`)].join(" ")} fill={C.navy} fillOpacity="0.07"/>
        <polyline points={data.map((d,i)=>`${xP(i)},${yP(d.without)}`).join(" ")} fill="none" stroke={C.silver} strokeWidth="2" strokeDasharray="5 4"/>
        <polyline points={data.map((d,i)=>`${xP(i)},${yP(d.with)}`).join(" ")} fill="none" stroke={C.navy} strokeWidth="2.5"/>
        {data.map((d,i)=>(<rect key={i} x={xP(i)-18} y={PT} width={36} height={iH} fill="transparent" onMouseEnter={()=>setTip({i,d})} onMouseLeave={()=>setTip(null)}/>))}
        {tip&&<><circle cx={xP(tip.i)} cy={yP(tip.d.with)} r="4" fill={C.navy}/><circle cx={xP(tip.i)} cy={yP(tip.d.without)} r="4" fill={C.silver}/></>}
      </svg>
      {tip&&(<div style={{position:"absolute",top:"4px",left:Math.min((xP(tip.i)/W)*100,60)+"%",transform:"translateX(-50%)",background:"#fff",border:"1px solid "+C.silver,borderRadius:"7px",padding:"7px 11px",boxShadow:"0 4px 14px rgba(0,0,0,0.11)",fontSize:"10px",whiteSpace:"nowrap",zIndex:10,pointerEvents:"none"}}><div style={{fontWeight:700,color:C.navy,marginBottom:"3px"}}>{tip.d.month}</div><div style={{color:C.navy}}>With FreedomOps: <strong>{fmt(tip.d.with)}</strong></div><div style={{color:"#999"}}>Without: <strong>{fmt(tip.d.without)}</strong></div><div style={{color:C.positive,marginTop:"2px"}}>Gap: <strong>{fmt(tip.d.with-tip.d.without)}</strong></div></div>)}
      <div style={{display:"flex",gap:"16px",justifyContent:"center",marginTop:"6px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#555"}}><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.navy} strokeWidth="2.5"/></svg>With FreedomOps</div>
        <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#999"}}><svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.silver} strokeWidth="2" strokeDasharray="5 3"/></svg>Without FreedomOps</div>
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

function exportToPDF({base,improved,metrics,proj,payback,fee,clientName,activeSc,nrrDelta}){
  const client=clientName.trim()||"Prospect",scenario=activeSc?activeSc.charAt(0).toUpperCase()+activeSc.slice(1):"Custom",date=new Date().toLocaleDateString("en-US",{year:"numeric",month:"long",day:"numeric"});
  const maxWF=Math.max(metrics.churnSaved,metrics.expansionGain,Math.abs(metrics.nrrLift),metrics.costSaved,1);
  const wBar=(label,value,color)=>{const w=Math.min(Math.abs(value)/maxWF*100,100).toFixed(1);return`<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px"><span style="color:#555">${label}</span><span style="font-weight:700;color:${color}">${fmt(value)}/mo</span></div><div style="height:7px;background:#D6D3D1;border-radius:4px;overflow:hidden"><div style="height:100%;width:${w}%;background:${color};border-radius:4px"></div></div></div>`;};
  const W=480,H=160,PL=60,PR=12,PT=8,PB=26,iW=W-PL-PR,iH=H-PT-PB,maxCum=Math.max(...proj.map(d=>d.cumGap),1);
  const yP=v=>PT+iH-(v/maxCum)*iH,bW=(iW/proj.length)*0.55,xP=i=>PL+(i+0.5)*(iW/proj.length);
  const svgBars=proj.map((d,i)=>{const bh=Math.max(iH-(yP(d.cumGap)-PT),1);return`<rect x="${xP(i)-bW/2}" y="${yP(d.cumGap)}" width="${bW}" height="${bh}" fill="#701427" rx="2" opacity="0.85"/><text x="${xP(i)}" y="${H-4}" text-anchor="middle" font-size="7.5" fill="#999">${d.month}</text>`;}).join("");
  const svgGrid=[0,0.33,0.66,1].map(t=>{const v=t*maxCum;return`<line x1="${PL}" x2="${W-PR}" y1="${yP(v)}" y2="${yP(v)}" stroke="#D6D3D1" stroke-width="1" stroke-dasharray="3 3"/><text x="${PL-4}" y="${yP(v)+3}" text-anchor="end" font-size="7.5" fill="#999">${fmt(v)}</text>`;}).join("");
  const LW=480,LH=160,LPL=60,LPR=12,LPT=8,LPB=26,liW=LW-LPL-LPR,liH=LH-LPT-LPB;
  const allV=proj.flatMap(d=>[d.without,d.with]),minV=Math.min(...allV)*0.97,maxV2=Math.max(...allV)*1.02;
  const lxP=i=>LPL+(i/(proj.length-1))*liW,lyP=v=>LPT+liH-((v-minV)/(maxV2-minV))*liH;
  const lineGrid=[0,0.33,0.66,1].map(t=>{const v=minV+t*(maxV2-minV);return`<line x1="${LPL}" x2="${LW-LPR}" y1="${lyP(v)}" y2="${lyP(v)}" stroke="#D6D3D1" stroke-width="1" stroke-dasharray="3 3"/><text x="${LPL-4}" y="${lyP(v)+3}" text-anchor="end" font-size="7.5" fill="#999">${fmt(v)}</text>`;}).join("");
  const withPts=proj.map((d,i)=>`${lxP(i)},${lyP(d.with)}`).join(" "),withoutPts=proj.map((d,i)=>`${lxP(i)},${lyP(d.without)}`).join(" ");
  const fillPts=[...proj.map((d,i)=>`${lxP(i)},${lyP(d.with)}`),...proj.slice().reverse().map((d,i)=>`${lxP(proj.length-1-i)},${lyP(d.without)}`)].join(" ");
  const lineXLabels=proj.map((d,i)=>`<text x="${lxP(i)}" y="${LH-4}" text-anchor="middle" font-size="7.5" fill="#999">${d.month}</text>`).join("");
  const rows=[{label:"Monthly Churn Rate",base:base.churnRate,imp:improved.churnRate,suffix:"%",decimals:2,lower:true},{label:"Net Revenue Retention",base:base.nrr,imp:improved.nrr,suffix:"%",decimals:1},{label:"Time-to-First-Value (days)",base:base.ttfv,imp:improved.ttfv,suffix:"",decimals:0,lower:true},{label:"Monthly Expansion Rate",base:base.expansionRate,imp:improved.expansionRate,suffix:"%",decimals:2},{label:"Monthly Support Cost",base:base.supportCost,imp:improved.supportCost,suffix:"",decimals:0,prefix:"$",lower:true},{label:"CSAT Score",base:base.csat,imp:improved.csat,suffix:"",decimals:1}];
  const tableRows=rows.map(r=>{const delta=r.imp-r.base,pctChg=r.base!==0?(delta/r.base)*100:0,isPos=r.lower?delta<0:delta>0,badge=delta===0?"—":pct(pctChg),bc=isPos?"#2e7d4f":delta===0?"#888":"#c0392b",bg=isPos?"#e8f5ee":delta===0?"#f5f5f5":"#fdecea";return`<tr><td style="padding:8px 12px;font-size:11px;color:#444;border-bottom:1px solid #D6D3D1">${r.label}</td><td style="padding:8px 12px;font-size:11px;text-align:center;font-weight:700;color:#1E3A5F;border-bottom:1px solid #D6D3D1">${r.prefix||""}${r.base.toFixed(r.decimals)}${r.suffix}</td><td style="padding:8px 12px;font-size:11px;text-align:center;font-weight:700;color:${isPos?"#2e7d4f":"#1E3A5F"};border-bottom:1px solid #D6D3D1">${r.prefix||""}${r.imp.toFixed(r.decimals)}${r.suffix}</td><td style="padding:8px 12px;text-align:right;border-bottom:1px solid #D6D3D1"><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${bg};color:${bc}">${badge}</span></td></tr>`;}).join("");
  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>FreedomOps — ${client}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}@page{size:A4 landscape;margin:10mm 12mm}.page{max-width:1050px;margin:0 auto;padding:20px}</style></head><body><div class="page"><div style="background:#1E3A5F;border-radius:10px;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px"><div style="display:flex;align-items:center;gap:12px"><div style="width:34px;height:34px;background:#701427;border-radius:6px;display:flex;align-items:center;justify-content:center"><span style="color:#fff;font-weight:900;font-size:16px">F</span></div><div><div style="color:#fff;font-weight:700;font-size:16px">${client} × FreedomOps</div><div style="color:#C4B5A6;font-size:9px;letter-spacing:0.12em;text-transform:uppercase">Impact Report · ${scenario} Scenario · ${date}</div></div></div><div style="text-align:right"><div style="color:#C4B5A6;font-size:9px;text-transform:uppercase;margin-bottom:3px">Additional ARR Impact</div><div style="color:#fff;font-size:36px;font-weight:900;line-height:1">${fmt(metrics.totalARRGain)}</div></div></div><div style="background:linear-gradient(135deg,#1E3A5F 0%,#2a4f7f 100%);border-radius:10px;padding:16px 24px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1px 1fr 1px 1fr 1px 1fr;align-items:center"><div style="text-align:center;padding:0 12px"><div style="color:#C4B5A6;font-size:8px;text-transform:uppercase;margin-bottom:4px">NRR: Current → Projected</div><div style="display:flex;align-items:center;justify-content:center;gap:10px"><span style="color:#fff;font-size:26px;font-weight:700">${base.nrr.toFixed(1)}%</span><span style="color:#C4B5A6">→</span><span style="color:#6ee7a0;font-size:26px;font-weight:700">${improved.nrr.toFixed(1)}%</span></div><div style="display:inline-block;margin-top:6px;padding:3px 10px;background:rgba(110,231,160,0.2);border:1px solid rgba(110,231,160,0.4);border-radius:20px;color:#6ee7a0;font-size:10px;font-weight:700">+${nrrDelta.toFixed(1)} pts</div></div><div style="width:1px;height:50px;background:rgba(255,255,255,0.15);margin:0 auto"></div><div style="text-align:center;padding:0 12px"><div style="color:#C4B5A6;font-size:8px;text-transform:uppercase;margin-bottom:4px">MRR Lift</div><div style="color:#6ee7a0;font-size:24px;font-weight:700">+${fmt(metrics.totalMRRGain)}/mo</div></div><div style="width:1px;height:50px;background:rgba(255,255,255,0.15);margin:0 auto"></div><div style="text-align:center;padding:0 12px"><div style="color:#C4B5A6;font-size:8px;text-transform:uppercase;margin-bottom:4px">Payback Period</div><div style="color:${payback&&payback<=6?"#6ee7a0":"#fbbf24"};font-size:28px;font-weight:900">${payback?payback+" mo":"—"}</div></div><div style="width:1px;height:50px;background:rgba(255,255,255,0.15);margin:0 auto"></div><div style="text-align:center;padding:0 12px"><div style="color:#C4B5A6;font-size:8px;text-transform:uppercase;margin-bottom:4px">ROI</div><div style="color:#6ee7a0;font-size:28px;font-weight:900">${pct(((metrics.totalARRGain-fee*12)/(fee*12))*100)}</div></div></div><div style="display:grid;grid-template-columns:1fr 230px;gap:14px"><div style="display:flex;flex-direction:column;gap:14px"><div style="background:#fff;border-radius:10px;border:1px solid #D6D3D1;overflow:hidden"><table style="width:100%;border-collapse:collapse"><thead><tr style="background:#1E3A5F"><th style="padding:10px 12px;text-align:left;color:#C4B5A6;font-size:9px;text-transform:uppercase;font-weight:700">Metric</th><th style="padding:10px 12px;text-align:center;color:#C4B5A6;font-size:9px;text-transform:uppercase;font-weight:700">Current</th><th style="padding:10px 12px;text-align:center;color:#fff;font-size:9px;text-transform:uppercase;font-weight:700">With FreedomOps</th><th style="padding:10px 12px;text-align:right;color:#C4B5A6;font-size:9px;text-transform:uppercase;font-weight:700">Δ</th></tr><tr style="background:#fafbfc"><td style="padding:9px 12px;font-size:12px;font-weight:700;color:#222;border-bottom:2px solid #D6D3D1">Monthly Recurring Revenue</td><td style="padding:9px 12px;text-align:center;font-weight:700;font-size:12px;color:#1E3A5F;border-bottom:2px solid #D6D3D1">${fmt(base.mrr)}</td><td style="padding:9px 12px;text-align:center;font-weight:700;font-size:12px;color:#2e7d4f;border-bottom:2px solid #D6D3D1">${fmt(base.mrr+metrics.totalMRRGain)}</td><td style="padding:9px 12px;text-align:right;border-bottom:2px solid #D6D3D1"><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#e8f5ee;color:#2e7d4f">${pct((metrics.totalMRRGain/base.mrr)*100)}</span></td></tr></thead><tbody>${tableRows}</tbody></table></div><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div style="border-radius:10px;border:1px solid #D6D3D1;overflow:hidden"><div style="background:#1E3A5F;padding:9px 14px;color:#fff;font-size:9px;font-weight:700">12-MONTH MRR PROJECTION</div><div style="padding:12px"><svg width="100%" viewBox="0 0 ${LW} ${LH}">${lineGrid}${lineXLabels}<polygon points="${fillPts}" fill="#1E3A5F" fill-opacity="0.07"/><polyline points="${withoutPts}" fill="none" stroke="#D6D3D1" stroke-width="1.5" stroke-dasharray="5 4"/><polyline points="${withPts}" fill="none" stroke="#1E3A5F" stroke-width="2"/></svg></div></div><div style="border-radius:10px;border:1px solid #D6D3D1;overflow:hidden"><div style="background:#701427;padding:9px 14px;color:#fff;font-size:9px;font-weight:700">CUMULATIVE ARR GAIN</div><div style="padding:12px"><svg width="100%" viewBox="0 0 ${W} ${H}">${svgGrid}${svgBars}</svg></div></div></div></div><div style="display:flex;flex-direction:column;gap:12px"><div style="border-radius:10px;border:1px solid #D6D3D1;overflow:hidden"><div style="background:#701427;padding:9px 14px;color:#fff;font-size:9px;font-weight:700">MRR GAIN BREAKDOWN</div><div style="padding:12px">${wBar("Churn Reduction",metrics.churnSaved,"#1E3A5F")}${wBar("Expansion Revenue",metrics.expansionGain,"#701427")}${wBar("NRR Improvement",metrics.nrrLift,"#C4B5A6")}${wBar("Support Cost Savings",metrics.costSaved,"#5a7fa8")}<div style="margin-top:10px;padding-top:10px;border-top:2px solid #1E3A5F;display:flex;justify-content:space-between"><span style="font-size:9px;font-weight:700;color:#1E3A5F">Total Monthly</span><span style="font-size:13px;font-weight:900;color:#1E3A5F">${fmt(metrics.totalMRRGain+metrics.costSaved)}/mo</span></div></div></div><div style="border-radius:10px;border:1px solid #D6D3D1;overflow:hidden"><div style="background:#1E3A5F;padding:9px 14px;color:#fff;font-size:9px;font-weight:700">PAYBACK CALCULATOR</div><div style="padding:12px">${[["Monthly Impact",fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo","#1E3A5F"],["Annual Investment",fmt(fee*12),"#888"],["Annual Return",fmt(metrics.totalARRGain),"#2e7d4f"],["ROI",pct(((metrics.totalARRGain-fee*12)/(fee*12))*100),"#2e7d4f"]].map(([l,v,col])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #D6D3D1"><span style="font-size:10px;color:#777">${l}</span><span style="font-size:11px;font-weight:700;color:${col}">${v}</span></div>`).join("")}<div style="margin-top:10px;padding:9px;background:${payback&&payback<=6?"#e8f5ee":"#fff8ec"};border-radius:7px;text-align:center"><div style="font-size:8px;color:#999;text-transform:uppercase;margin-bottom:2px">Payback Period</div><div style="font-size:22px;font-weight:900;color:${payback&&payback<=6?"#2e7d4f":"#b45309"}">${payback?payback+" months":"—"}</div></div></div></div></div></div><div style="text-align:center;margin-top:14px;color:#ccc;font-size:9px">${client.toUpperCase()} × FREEDOMOPS CONFIDENTIAL · ${date}</div></div><script>window.onload=function(){window.print();}</script></body></html>`;
  const w=window.open("","_blank","width=1100,height=800");
  if(!w){alert("Pop-up blocked — please allow pop-ups.");return;}
  w.document.write(html);w.document.close();
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
  const [snapState, setSnapState] = useState("idle");
  const [presentMode, setPresentMode] = useState(getPresentModeFromURL);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null); // holds client id pending delete
  const [isDemoData, setIsDemoData] = useState(isUsingDemoData);
  const feeRef = useRef();

  // Load from URL on mount - runs after loadClient is defined
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
      // ensure unique id
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
  };

  const saveCurrentClient = (overrides={}) => {
    if (!activeId) return;
    const updated = clients.map(c => c.id===activeId ? {...c,base,scenario:activeSc||c.scenario,customImp,...overrides} : c);
    setClients(updated);
    saveClients(updated);
    setIsDirty(false);
  };

  const clearDemoData = () => {
    setClients([]);
    saveClients([]);
    setIsDemoData(false);
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
  const proj     = useMemo(()=>buildProjection(base,improved),[base,improved]);
  const maxWF    = Math.max(metrics.churnSaved,metrics.expansionGain,metrics.costSaved,1);
  const nrrDelta = improved.nrr - base.nrr;
  const payback  = useMemo(()=>{let cum=0;const mg=metrics.totalMRRGain+(base.supportCost-improved.supportCost);for(let m=1;m<=60;m++){cum+=mg;if(cum>=fee*m)return m;}return null;},[metrics,base,improved,fee]);

  const activeClient = clients.find(c => c.id === activeId);

  const setSc = key => {
    setActiveSc(key);
    setIsDirty(true);
    if(key==="custom") setImproved({...customImp});
    else setImproved(applyScenario(base,key));
  };
  const updBase = f => v => {const nb={...base,[f]:v};setBase(nb);setIsDirty(true);if(activeSc&&activeSc!=="custom")setImproved(applyScenario(nb,activeSc));};
  const updImp  = f => v => {setActiveSc(null);setImproved(p=>({...p,[f]:v}));setIsDirty(true);};

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
  const scBtn=(id,lbl)=>(<button onClick={()=>setSc(id)} style={{padding:"5px 10px",borderRadius:"5px",border:activeSc===id?"none":"1px solid rgba(255,255,255,0.2)",background:activeSc===id?C.burgundy:"rgba(255,255,255,0.08)",color:activeSc===id?"#fff":C.tan,fontSize:"10px",fontWeight:700,cursor:"pointer",transition:"all 0.2s"}}>{lbl}</button>);

  // ── No client selected: landing screen ──
  if (!activeId) return (
    <div style={{minHeight:"100vh",background:C.offwhite,fontFamily:"'Helvetica Neue',Arial,sans-serif"}}>

      {/* Top bar */}
      <div style={{background:C.navy,padding:"0 32px",display:"flex",alignItems:"center",height:"52px",boxShadow:"0 2px 12px rgba(0,0,0,0.2)"}}>
        <div style={{width:"28px",height:"28px",background:C.burgundy,borderRadius:"6px",display:"flex",alignItems:"center",justifyContent:"center",marginRight:"10px"}}>
          <span style={{color:"#fff",fontWeight:900,fontSize:"12px"}}>F</span>
        </div>
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

        {/* Demo banner */}
        {isDemoData&&(
          <div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:"10px",padding:"12px 18px",marginBottom:"20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div>
              <div style={{fontWeight:700,color:"#92400e",fontSize:"12px"}}>You're viewing demo data</div>
              <div style={{color:"#b45309",fontSize:"10px",marginTop:"2px"}}>Acme Corp and Globex Inc are examples. Clear them when you're ready to add real clients.</div>
            </div>
            <button onClick={clearDemoData} style={{padding:"6px 14px",borderRadius:"6px",background:"#92400e",border:"none",color:"#fff",fontSize:"11px",fontWeight:700,cursor:"pointer",whiteSpace:"nowrap",marginLeft:"16px"}}>Clear Demo Data</button>
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
        {clients.length===0&&(
          <div style={{textAlign:"center",padding:"48px 24px",background:"#fff",borderRadius:"12px",boxShadow:"0 2px 10px rgba(0,0,0,0.06)"}}>
            <div style={{fontSize:"32px",marginBottom:"12px"}}>📊</div>
            <div style={{fontWeight:700,color:C.navy,fontSize:"15px",marginBottom:"6px"}}>No clients yet</div>
            <div style={{color:"#aaa",fontSize:"12px"}}>Create your first client preset to get started.</div>
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
                  <div style={{fontSize:"10px",color:"#aaa",marginTop:"2px",textTransform:"capitalize"}}>{c.scenario} scenario · {fmt(c.fee)}/mo · MRR {fmt(c.base.mrr)}</div>
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
                {confirmDelete===c.id ? (
                  <div style={{display:"flex",gap:"4px",alignItems:"center"}} onClick={e=>e.stopPropagation()}>
                    <span style={{fontSize:"10px",color:"#c0392b",fontWeight:600}}>Sure?</span>
                    <button onClick={e=>{e.stopPropagation();handleDeleteClient(c.id);}} style={{padding:"4px 10px",borderRadius:"5px",border:"none",background:"#c0392b",color:"#fff",fontSize:"10px",fontWeight:700,cursor:"pointer"}}>Yes</button>
                    <button onClick={e=>{e.stopPropagation();setConfirmDelete(null);}} style={{padding:"4px 10px",borderRadius:"5px",border:"1px solid "+C.silver,background:"#fff",color:"#666",fontSize:"10px",fontWeight:600,cursor:"pointer"}}>No</button>
                  </div>
                ) : (
                  <button onClick={e=>{e.stopPropagation();setConfirmDelete(c.id);}} style={{padding:"5px 12px",borderRadius:"6px",border:"1px solid #fcc",background:"#fff8f8",color:"#c0392b",fontSize:"10px",fontWeight:600,cursor:"pointer"}}>Delete</button>
                )}
                <div style={{padding:"6px 14px",borderRadius:"6px",background:C.navy,color:"#fff",fontSize:"10px",fontWeight:700}}>Open →</div>
              </div>
            </div>
          );
        })}
      </div>

      {showForm&&<ClientForm existing={editingClient} onSave={handleSaveClient} onCancel={()=>{setShowForm(false);setEditingClient(null);}}/>}
    </div>
  );

    // ── Dashboard ──
  return (
    <div style={{minHeight:"100vh",background:C.offwhite,fontFamily:"'Helvetica Neue',Arial,sans-serif"}}>

      {/* Header */}
      <div style={{background:C.navy,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 18px rgba(0,0,0,0.25)"}}>
        <div style={{padding:"13px 0",display:"flex",alignItems:"center",gap:"10px"}}>
          <div title="Back to all clients" style={{width:"30px",height:"30px",background:C.burgundy,borderRadius:"6px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,cursor:"pointer",transition:"box-shadow 0.15s"}} onClick={()=>{setActiveId(null);setClientInURL(null);setIsDirty(false);}} onMouseEnter={e=>e.currentTarget.style.boxShadow="0 0 0 3px rgba(255,255,255,0.35)"} onMouseLeave={e=>e.currentTarget.style.boxShadow="none"}>
            <span style={{color:"#fff",fontWeight:900,fontSize:"13px"}}>F</span>
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
                  <div onClick={()=>{setActiveId(null);setClientInURL(null);setShowMenu(false);setIsDirty(false);}} style={{padding:"10px 14px",cursor:"pointer",display:"flex",alignItems:"center",gap:"8px",background:"#fafafa"}} onMouseEnter={e=>e.currentTarget.style.background="#f0f0f0"} onMouseLeave={e=>e.currentTarget.style.background="#fafafa"}>
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
              <span style={{opacity:0.7}}>◈</span> {activeSc?activeSc.charAt(0).toUpperCase()+activeSc.slice(1):"Scenario"} <span style={{fontSize:"8px",opacity:0.5}}>▼</span>
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
                        <div style={{fontSize:"12px",fontWeight:700,color:active?C.burgundy:C.navy}}>{labels[s]}</div>
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
                  <div onClick={()=>{exportToPDF({base,improved,metrics,proj,payback,fee,clientName:activeClient?.name||"",activeSc,nrrDelta});setShowExportMenu(false);}} style={{padding:"11px 14px",cursor:"pointer",background:"#fff"}} onMouseEnter={e=>e.currentTarget.style.background="#f5f5f5"} onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                    <div style={{fontSize:"12px",fontWeight:700,color:C.navy}}>⬇ PDF Report</div>
                    <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>Print-ready client report</div>
                  </div>
                </div>
              )}
            </div>
          )}

          {presentMode&&<div style={{fontSize:"9px",color:"rgba(255,255,255,0.3)",letterSpacing:"0.1em",textTransform:"uppercase",padding:"0 4px"}}>Presentation Mode</div>}
        </div>
      </div>

      {(showMenu||showScenarioMenu||showShareMenu||showExportMenu)&&<div style={{position:"fixed",inset:0,zIndex:199}} onClick={()=>{setShowMenu(false);setShowScenarioMenu(false);setShowShareMenu(false);setShowExportMenu(false);}}/>}
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
            {[{label:"Current MRR",value:fmt(base.mrr),sub:"per month",col:"#fff"},{label:"Projected MRR",value:fmt(base.mrr+metrics.totalMRRGain),sub:"+"+fmt(metrics.totalMRRGain)+"/mo lift",col:"#6ee7a0"},{label:"Payback Period",value:payback?payback+"mo":"—",sub:"@ "+fmt(fee)+"/mo fee",col:payback&&payback<=6?"#6ee7a0":"#fbbf24",clickFee:true},{label:"Monthly Gain",value:fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo",sub:"net impact",col:"#6ee7a0"}].map((item,i)=>(
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
              <div style={{padding:"8px 16px",background:"#f8f9fb"}}><div style={{fontSize:"9px",color:"#aaa",fontStyle:"italic"}}>💡 Click any underlined value to edit. Use scenario presets to apply assumptions.</div></div>
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
          </div>

          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
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
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              {callouts.map(c=>(<div key={c.label} style={{background:"#fff",borderRadius:"8px",padding:"11px",borderTop:"3px solid "+c.color,boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}><div style={{fontSize:"7px",color:"#999",letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:"3px"}}>{c.label}</div><div style={{fontSize:"16px",fontWeight:900,color:c.color,lineHeight:1.1}}>{c.value}</div><div style={{fontSize:"9px",color:"#bbb",marginTop:"2px"}}>{c.sub}</div></div>))}
            </div>
            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,padding:"10px 14px"}}><div style={{color:"#fff",fontSize:"9px",fontWeight:700,letterSpacing:"0.07em"}}>PAYBACK CALCULATOR</div></div>
              <div style={{padding:"12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"10px"}}><span style={{fontSize:"10px",color:"#666"}}>Monthly Fee:</span><span onClick={()=>{setRawFee(fee.toString());setEditFee(true);}} style={{fontWeight:700,fontSize:"12px",color:C.navy,cursor:"pointer",borderBottom:"2px dashed "+C.tan,padding:"1px 2px"}}>{fmt(fee)}/mo</span></div>
                {[{label:"Monthly Impact",value:fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo",color:C.navy},{label:"Annual Investment",value:fmt(fee*12),color:"#888"},{label:"Annual Return",value:fmt(metrics.totalARRGain),color:C.positive},{label:"ROI",value:pct(((metrics.totalARRGain-fee*12)/(fee*12))*100),color:C.positive}].map(item=>(<div key={item.label} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"1px solid "+C.silver}}><span style={{fontSize:"10px",color:"#777"}}>{item.label}</span><span style={{fontSize:"11px",fontWeight:700,color:item.color}}>{item.value}</span></div>))}
                <div style={{marginTop:"11px",padding:"9px",background:payback&&payback<=6?C.posLight:"#fff8ec",borderRadius:"7px",textAlign:"center",border:"1px solid "+(payback&&payback<=6?"#a7d7b9":"#fcd57a")}}>
                  <div style={{fontSize:"8px",color:"#999",letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:"2px"}}>Payback Period</div>
                  <div style={{fontSize:"20px",fontWeight:900,color:payback&&payback<=6?C.positive:"#b45309"}}>{payback?payback+" months":"—"}</div>
                  <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>to recoup investment</div>
                </div>
              </div>
            </div>
          </div>
        </div>
        <div style={{textAlign:"center",marginTop:"16px",color:"#ccc",fontSize:"9px",letterSpacing:"0.08em"}}>{activeClient?.name?.toUpperCase()} × FREEDOMOPS CONFIDENTIAL · FOR DISCUSSION PURPOSES ONLY</div>
      </div>
    </div>
  );
}

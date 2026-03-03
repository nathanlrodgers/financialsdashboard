import { useState, useRef, useMemo } from "react";

const C = {
  navy: "#1E3A5F", burgundy: "#701427", tan: "#C4B5A6",
  silver: "#D6D3D1", offwhite: "#F5F5F5", positive: "#2e7d4f",
  posLight: "#e8f5ee", navyMid: "#2a4f7f",
};

const BASE = { mrr: 125000, churnRate: 5.2, nrr: 98, ttfv: 45, expansionRate: 8.5, supportCost: 18500, csat: 72 };

const PRESET_SCENARIOS = {
  conservative: { churnRate: -15, nrr: 4,  ttfv: -20, expansionRate: 10, supportCost: -10, csat: 8  },
  moderate:     { churnRate: -28, nrr: 8,  ttfv: -38, expansionRate: 22, supportCost: -20, csat: 14 },
  aggressive:   { churnRate: -42, nrr: 14, ttfv: -55, expansionRate: 38, supportCost: -32, csat: 22 },
};

const fmt = n => Math.abs(n)>=1e6?`$${(n/1e6).toFixed(2)}M`:Math.abs(n)>=1e3?`$${(n/1e3).toFixed(1)}K`:`$${Math.round(n)}`;
const pct = (n,d=1) => `${n>=0?"+":""}${n.toFixed(d)}%`;

function computeMetrics(base, imp) {
  const churnSaved    = base.mrr * ((base.churnRate - imp.churnRate) / 100);
  const expansionGain = base.mrr * ((imp.expansionRate - base.expansionRate) / 100);
  const nrrLift       = base.mrr * ((imp.nrr - base.nrr) / 100);
  const costSaved     = base.supportCost - imp.supportCost;
  const totalMRRGain  = churnSaved + expansionGain + nrrLift;
  const totalARRGain  = totalMRRGain * 12 + costSaved * 12;
  return { churnSaved, expansionGain, nrrLift, costSaved, totalMRRGain, totalARRGain };
}

function applyScenario(base, key) {
  const s = PRESET_SCENARIOS[key];
  return {
    mrr: base.mrr,
    churnRate:     +(base.churnRate * (1 + s.churnRate / 100)).toFixed(2),
    nrr:           +(base.nrr + s.nrr).toFixed(1),
    ttfv:          +(base.ttfv * (1 + s.ttfv / 100)).toFixed(1),
    expansionRate: +(base.expansionRate + s.expansionRate * base.expansionRate / 100).toFixed(2),
    supportCost:   +(base.supportCost * (1 + s.supportCost / 100)).toFixed(0),
    csat:          +(base.csat + s.csat).toFixed(1),
  };
}

function buildProjection(base, imp) {
  const costSave = base.supportCost - imp.supportCost;
  let bMRR = base.mrr, wMRR = base.mrr, cumGap = 0;
  return Array.from({ length: 12 }, (_, i) => {
    bMRR = bMRR * (1 + (base.expansionRate - base.churnRate) / 100);
    wMRR = wMRR * (1 + (imp.expansionRate - imp.churnRate) / 100);
    cumGap += (wMRR - bMRR) + costSave;
    return { month: `M${i+1}`, without: Math.round(bMRR), with: Math.round(wMRR), cumGap: Math.round(Math.max(cumGap, 0)) };
  });
}

// ── SVG Line Chart ──────────────────────────────────────────
function LineChartSVG({ data }) {
  const [tip, setTip] = useState(null);
  const W=560,H=200,PL=68,PR=14,PT=10,PB=30;
  const iW=W-PL-PR, iH=H-PT-PB;
  const allV=data.flatMap(d=>[d.without,d.with]);
  const minV=Math.min(...allV)*0.97, maxV=Math.max(...allV)*1.02;
  const xP=i=>PL+(i/(data.length-1))*iW;
  const yP=v=>PT+iH-((v-minV)/(maxV-minV))*iH;
  const yTicks=Array.from({length:4},(_,i)=>minV+(i/3)*(maxV-minV));
  return (
    <div style={{position:"relative"}}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        {yTicks.map((v,i)=>(
          <g key={i}>
            <line x1={PL} x2={W-PR} y1={yP(v)} y2={yP(v)} stroke={C.silver} strokeWidth="1" strokeDasharray="3 3"/>
            <text x={PL-5} y={yP(v)+4} textAnchor="end" fontSize="8.5" fill="#999">{fmt(v)}</text>
          </g>
        ))}
        {data.map((d,i)=><text key={i} x={xP(i)} y={H-5} textAnchor="middle" fontSize="8.5" fill="#999">{d.month}</text>)}
        <polygon points={[...data.map((d,i)=>`${xP(i)},${yP(d.with)}`), ...data.slice().reverse().map((d,i)=>`${xP(data.length-1-i)},${yP(d.without)}`)].join(" ")} fill={C.navy} fillOpacity="0.07"/>
        <polyline points={data.map((d,i)=>`${xP(i)},${yP(d.without)}`).join(" ")} fill="none" stroke={C.silver} strokeWidth="2" strokeDasharray="5 4"/>
        <polyline points={data.map((d,i)=>`${xP(i)},${yP(d.with)}`).join(" ")} fill="none" stroke={C.navy} strokeWidth="2.5"/>
        {data.map((d,i)=>(
          <rect key={i} x={xP(i)-18} y={PT} width={36} height={iH} fill="transparent"
            onMouseEnter={()=>setTip({i,d})} onMouseLeave={()=>setTip(null)}/>
        ))}
        {tip&&<>
          <circle cx={xP(tip.i)} cy={yP(tip.d.with)} r="4" fill={C.navy}/>
          <circle cx={xP(tip.i)} cy={yP(tip.d.without)} r="4" fill={C.silver}/>
        </>}
      </svg>
      {tip&&(
        <div style={{position:"absolute",top:"4px",left:`${Math.min((xP(tip.i)/W)*100,60)}%`,transform:"translateX(-50%)",background:"#fff",border:`1px solid ${C.silver}`,borderRadius:"7px",padding:"7px 11px",boxShadow:"0 4px 14px rgba(0,0,0,0.11)",fontSize:"10px",whiteSpace:"nowrap",zIndex:10,pointerEvents:"none"}}>
          <div style={{fontWeight:700,color:C.navy,marginBottom:"3px"}}>{tip.d.month}</div>
          <div style={{color:C.navy}}>With FreedomOps: <strong>{fmt(tip.d.with)}</strong></div>
          <div style={{color:"#999"}}>Without: <strong>{fmt(tip.d.without)}</strong></div>
          <div style={{color:C.positive,marginTop:"2px"}}>Gap: <strong>{fmt(tip.d.with-tip.d.without)}</strong></div>
        </div>
      )}
      <div style={{display:"flex",gap:"16px",justifyContent:"center",marginTop:"6px"}}>
        <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#555"}}>
          <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.navy} strokeWidth="2.5"/></svg>With FreedomOps
        </div>
        <div style={{display:"flex",alignItems:"center",gap:"5px",fontSize:"10px",color:"#999"}}>
          <svg width="22" height="8"><line x1="0" y1="4" x2="22" y2="4" stroke={C.silver} strokeWidth="2" strokeDasharray="5 3"/></svg>Without FreedomOps
        </div>
      </div>
    </div>
  );
}

function BarChartSVG({ data }) {
  const [tip, setTip] = useState(null);
  const W=560,H=200,PL=68,PR=14,PT=10,PB=30;
  const iW=W-PL-PR, iH=H-PT-PB;
  const maxV=Math.max(...data.map(d=>d.cumGap),1);
  const yP=v=>PT+iH-(v/maxV)*iH;
  const bW=(iW/data.length)*0.58;
  const xP=i=>PL+(i+0.5)*(iW/data.length);
  const yTicks=Array.from({length:4},(_,i)=>(i/3)*maxV);
  return (
    <div style={{position:"relative"}}>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{display:"block"}}>
        {yTicks.map((v,i)=>(
          <g key={i}>
            <line x1={PL} x2={W-PR} y1={yP(v)} y2={yP(v)} stroke={C.silver} strokeWidth="1" strokeDasharray="3 3"/>
            <text x={PL-5} y={yP(v)+4} textAnchor="end" fontSize="8.5" fill="#999">{fmt(v)}</text>
          </g>
        ))}
        {data.map((d,i)=>{
          const bh=Math.max(iH-(yP(d.cumGap)-PT),1);
          return (
            <g key={i}>
              <rect x={xP(i)-bW/2} y={yP(d.cumGap)} width={bW} height={bh} fill={C.burgundy} rx="3" opacity={tip?.i===i?1:0.82} onMouseEnter={()=>setTip({i,d})} onMouseLeave={()=>setTip(null)}/>
              <text x={xP(i)} y={H-5} textAnchor="middle" fontSize="8.5" fill="#999">{d.month}</text>
            </g>
          );
        })}
      </svg>
      {tip&&(
        <div style={{position:"absolute",top:"4px",left:`${Math.min((xP(tip.i)/W)*100,60)}%`,transform:"translateX(-50%)",background:"#fff",border:`1px solid ${C.silver}`,borderRadius:"7px",padding:"7px 11px",boxShadow:"0 4px 14px rgba(0,0,0,0.11)",fontSize:"10px",whiteSpace:"nowrap",zIndex:10,pointerEvents:"none"}}>
          <div style={{fontWeight:700,color:C.navy,marginBottom:"3px"}}>{tip.d.month}</div>
          <div style={{color:C.burgundy}}>Cumulative Gain: <strong>{fmt(tip.d.cumGap)}</strong></div>
        </div>
      )}
    </div>
  );
}

// ── Custom Scenario Editor ──────────────────────────────────
function CustomScenarioEditor({ base, customImp, onChange }) {
  const fields = [
    { field:"churnRate",     label:"Churn Rate",           suffix:"%", decimals:2, step:0.1, min:0,   max:20   },
    { field:"nrr",           label:"Net Revenue Retention",suffix:"%", decimals:1, step:0.5, min:80,  max:150  },
    { field:"ttfv",          label:"Time-to-First-Value",  suffix:"d", decimals:0, step:1,   min:1,   max:180  },
    { field:"expansionRate", label:"Expansion Rate",       suffix:"%", decimals:2, step:0.1, min:0,   max:30   },
    { field:"supportCost",   label:"Support Cost",         suffix:"",  decimals:0, step:100, min:0,   max:100000, prefix:"$" },
    { field:"csat",          label:"CSAT Score",           suffix:"",  decimals:1, step:1,   min:0,   max:100  },
  ];
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"10px",padding:"14px"}}>
      {fields.map(f => {
        const baseVal = base[f.field];
        const impVal  = customImp[f.field];
        const delta   = impVal - baseVal;
        const pctChg  = baseVal !== 0 ? (delta/baseVal)*100 : 0;
        const lowerBetter = f.field==="churnRate"||f.field==="ttfv"||f.field==="supportCost";
        const isGood = lowerBetter ? delta<0 : delta>0;
        return (
          <div key={f.field} style={{background:C.offwhite,borderRadius:"8px",padding:"12px"}}>
            <div style={{fontSize:"10px",color:"#666",marginBottom:"6px",fontWeight:600}}>{f.label}</div>
            <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"8px"}}>
              <span style={{fontSize:"10px",color:"#aaa"}}>Base: <strong style={{color:C.navy}}>{f.prefix||""}{baseVal.toFixed(f.decimals)}{f.suffix}</strong></span>
              <span style={{fontSize:"10px",color:"#ccc"}}>→</span>
              <input type="number" value={impVal} step={f.step} min={f.min} max={f.max}
                onChange={e=>{const v=parseFloat(e.target.value);if(!isNaN(v))onChange(f.field,v);}}
                style={{width:"72px",border:`2px solid ${C.burgundy}`,borderRadius:"5px",padding:"3px 6px",fontSize:"12px",fontWeight:700,color:C.navy,outline:"none",textAlign:"center"}}
              />
              <span style={{fontSize:"10px",color:"#aaa"}}>{f.suffix}</span>
            </div>
            <input type="range" min={f.min} max={f.max} step={f.step} value={impVal}
              onChange={e=>onChange(f.field,parseFloat(e.target.value))}
              style={{width:"100%",accentColor:C.burgundy}}
            />
            <div style={{fontSize:"9px",marginTop:"4px",textAlign:"right",color:delta===0?"#aaa":isGood?C.positive:"#c0392b"}}>
              {delta===0?"No change":pct(pctChg)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Editable Cell ────────────────────────────────────────────
function EditableCell({ value, onChange, prefix="", suffix="", decimals=1, highlight=false }) {
  const [editing,setEditing]=useState(false);
  const [raw,setRaw]=useState("");
  const ref=useRef();
  const start=()=>{setRaw(value.toString());setEditing(true);setTimeout(()=>ref.current?.select(),10);};
  const commit=()=>{const p=parseFloat(raw);if(!isNaN(p))onChange(p);setEditing(false);};
  if(editing) return <input ref={ref} value={raw} onChange={e=>setRaw(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==="Enter")commit();if(e.key==="Escape")setEditing(false);}} style={{width:"82px",background:"#fff",border:`2px solid ${C.burgundy}`,borderRadius:"5px",padding:"3px 6px",fontSize:"12px",fontWeight:700,color:C.navy,textAlign:"center",outline:"none"}}/>;
  return <span onClick={start} title="Click to edit" style={{cursor:"pointer",borderBottom:`2px dashed ${highlight?C.positive:C.tan}`,color:highlight?C.positive:C.navy,fontWeight:700,fontSize:"12px",padding:"2px 3px",borderRadius:"3px",transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background="#f0f4f8"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>{prefix}{typeof value==="number"?value.toFixed(decimals):value}{suffix}</span>;
}

function MetricRow({ label, baseVal, improvedVal, prefix, suffix, decimals, onBaseChange, onImprovedChange, lowerIsBetter=false }) {
  const delta=improvedVal-baseVal;
  const pctChange=baseVal!==0?(delta/baseVal)*100:0;
  const isPos=lowerIsBetter?delta<0:delta>0;
  return (
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 90px",padding:"10px 16px",alignItems:"center",borderBottom:`1px solid ${C.silver}`,transition:"background 0.15s"}} onMouseEnter={e=>e.currentTarget.style.background="#f8f9fb"} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <div style={{color:"#444",fontSize:"12px"}}>{label}</div>
      <div style={{textAlign:"center"}}><EditableCell value={baseVal} onChange={onBaseChange} prefix={prefix} suffix={suffix} decimals={decimals}/></div>
      <div style={{textAlign:"center"}}><EditableCell value={improvedVal} onChange={onImprovedChange} prefix={prefix} suffix={suffix} decimals={decimals} highlight={isPos}/></div>
      <div style={{textAlign:"right"}}><span style={{display:"inline-block",padding:"2px 8px",borderRadius:"20px",fontSize:"10px",fontWeight:700,background:isPos?C.posLight:delta===0?"#f5f5f5":"#fdecea",color:isPos?C.positive:delta===0?"#888":"#c0392b"}}>{delta===0?"—":pct(pctChange)}</span></div>
    </div>
  );
}

function WBar({ label, value, maxVal, color }) {
  const w=maxVal>0?Math.min(Math.abs(value)/Math.abs(maxVal)*100,100):0;
  return (
    <div style={{marginBottom:"9px"}}>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:"2px"}}><span style={{fontSize:"10px",color:"#555"}}>{label}</span><span style={{fontSize:"10px",fontWeight:700,color}}>{fmt(value)}/mo</span></div>
      <div style={{height:"7px",background:C.silver,borderRadius:"4px",overflow:"hidden"}}><div style={{height:"100%",width:`${w}%`,background:color,borderRadius:"4px",transition:"width 0.5s ease"}}/></div>
    </div>
  );
}

// ── PDF Export ────────────────────────────────────────────────
function exportToPDF({ base, improved, metrics, proj, payback, fee, clientName, activeSc, nrrDelta }) {
  const client = clientName.trim() || "Prospect";
  const scenario = activeSc ? activeSc.charAt(0).toUpperCase() + activeSc.slice(1) : "Custom";
  const date = new Date().toLocaleDateString("en-US", { year:"numeric", month:"long", day:"numeric" });

  // Build waterfall bars as inline HTML
  const maxWF = Math.max(metrics.churnSaved, metrics.expansionGain, Math.abs(metrics.nrrLift), metrics.costSaved, 1);
  const wBar = (label, value, color) => {
    const w = Math.min(Math.abs(value)/maxWF*100, 100).toFixed(1);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px;font-size:10px">
        <span style="color:#555">${label}</span><span style="font-weight:700;color:${color}">${fmt(value)}/mo</span>
      </div>
      <div style="height:7px;background:#D6D3D1;border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${w}%;background:${color};border-radius:4px"></div>
      </div>
    </div>`;
  };

  // Build SVG bar chart for cumulative gain (static, no interaction)
  const W=480,H=160,PL=60,PR=12,PT=8,PB=26;
  const iW=W-PL-PR, iH=H-PT-PB;
  const maxCum = Math.max(...proj.map(d=>d.cumGap), 1);
  const yP = v => PT+iH-(v/maxCum)*iH;
  const bW = (iW/proj.length)*0.55;
  const xP = i => PL+(i+0.5)*(iW/proj.length);
  const yTicks = [0,0.33,0.66,1].map(t=>t*maxCum);

  const svgBars = proj.map((d,i)=>{
    const bh = Math.max(iH-(yP(d.cumGap)-PT),1);
    return `<rect x="${xP(i)-bW/2}" y="${yP(d.cumGap)}" width="${bW}" height="${bh}" fill="#701427" rx="2" opacity="0.85"/>
            <text x="${xP(i)}" y="${H-4}" text-anchor="middle" font-size="7.5" fill="#999">${d.month}</text>`;
  }).join("");
  const svgGrid = yTicks.map(v=>`
    <line x1="${PL}" x2="${W-PR}" y1="${yP(v)}" y2="${yP(v)}" stroke="#D6D3D1" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="${PL-4}" y="${yP(v)+3}" text-anchor="end" font-size="7.5" fill="#999">${fmt(v)}</text>`).join("");

  // Build SVG line chart for MRR projection (static)
  const LW=480,LH=160,LPL=60,LPR=12,LPT=8,LPB=26;
  const liW=LW-LPL-LPR, liH=LH-LPT-LPB;
  const allV=proj.flatMap(d=>[d.without,d.with]);
  const minV=Math.min(...allV)*0.97, maxV2=Math.max(...allV)*1.02;
  const lxP=i=>LPL+(i/(proj.length-1))*liW;
  const lyP=v=>LPT+liH-((v-minV)/(maxV2-minV))*liH;
  const lTicks=[0,0.33,0.66,1].map(t=>minV+t*(maxV2-minV));
  const lineGrid=lTicks.map(v=>`
    <line x1="${LPL}" x2="${LW-LPR}" y1="${lyP(v)}" y2="${lyP(v)}" stroke="#D6D3D1" stroke-width="1" stroke-dasharray="3 3"/>
    <text x="${LPL-4}" y="${lyP(v)+3}" text-anchor="end" font-size="7.5" fill="#999">${fmt(v)}</text>`).join("");
  const withPts=proj.map((d,i)=>`${lxP(i)},${lyP(d.with)}`).join(" ");
  const withoutPts=proj.map((d,i)=>`${lxP(i)},${lyP(d.without)}`).join(" ");
  const fillPts=[...proj.map((d,i)=>`${lxP(i)},${lyP(d.with)}`), ...proj.slice().reverse().map((d,i)=>`${lxP(proj.length-1-i)},${lyP(d.without)}`)].join(" ");
  const lineXLabels=proj.map((d,i)=>`<text x="${lxP(i)}" y="${LH-4}" text-anchor="middle" font-size="7.5" fill="#999">${d.month}</text>`).join("");

  const rows = [
    {label:"Monthly Churn Rate",        base:base.churnRate,     imp:improved.churnRate,     suffix:"%", decimals:2, lower:true},
    {label:"Net Revenue Retention",     base:base.nrr,           imp:improved.nrr,           suffix:"%", decimals:1},
    {label:"Time-to-First-Value (days)",base:base.ttfv,          imp:improved.ttfv,          suffix:"",  decimals:0, lower:true},
    {label:"Monthly Expansion Rate",    base:base.expansionRate, imp:improved.expansionRate, suffix:"%", decimals:2},
    {label:"Monthly Support Cost",      base:base.supportCost,   imp:improved.supportCost,   suffix:"",  decimals:0, prefix:"$", lower:true},
    {label:"CSAT Score",                base:base.csat,          imp:improved.csat,          suffix:"",  decimals:1},
  ];

  const tableRows = rows.map(r => {
    const delta = r.imp - r.base;
    const pctChg = r.base !== 0 ? (delta/r.base)*100 : 0;
    const isPos = r.lower ? delta<0 : delta>0;
    const badge = delta===0?"—":pct(pctChg);
    const badgeColor = isPos?"#2e7d4f":delta===0?"#888":"#c0392b";
    const badgeBg = isPos?"#e8f5ee":delta===0?"#f5f5f5":"#fdecea";
    const impColor = isPos?"#2e7d4f":"#1E3A5F";
    return `<tr>
      <td style="padding:8px 12px;font-size:11px;color:#444;border-bottom:1px solid #D6D3D1">${r.label}</td>
      <td style="padding:8px 12px;font-size:11px;text-align:center;font-weight:700;color:#1E3A5F;border-bottom:1px solid #D6D3D1">${r.prefix||""}${r.base.toFixed(r.decimals)}${r.suffix}</td>
      <td style="padding:8px 12px;font-size:11px;text-align:center;font-weight:700;color:${impColor};border-bottom:1px solid #D6D3D1">${r.prefix||""}${r.imp.toFixed(r.decimals)}${r.suffix}</td>
      <td style="padding:8px 12px;text-align:right;border-bottom:1px solid #D6D3D1"><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:${badgeBg};color:${badgeColor}">${badge}</span></td>
    </tr>`;
  }).join("");

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>FreedomOps Impact Report — ${client}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; background: #fff; color: #222; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @page { size: A4 landscape; margin: 10mm 12mm; }
  @media print { .no-print { display: none; } body { margin: 0; } }
  .page { max-width: 1050px; margin: 0 auto; padding: 20px; }
</style>
</head>
<body>
<div class="page">

  <!-- Header -->
  <div style="background:#1E3A5F;border-radius:10px;padding:16px 24px;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
    <div style="display:flex;align-items:center;gap:12px">
      <div style="width:34px;height:34px;background:#701427;border-radius:6px;display:flex;align-items:center;justify-content:center">
        <span style="color:#fff;font-weight:900;font-size:16px">F</span>
      </div>
      <div>
        <div style="color:#fff;font-weight:700;font-size:16px">${client} × FreedomOps</div>
        <div style="color:#C4B5A6;font-size:9px;letter-spacing:0.12em;text-transform:uppercase">Impact Report · ${scenario} Scenario · ${date}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="color:#C4B5A6;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;margin-bottom:3px">Additional ARR Impact</div>
      <div style="color:#fff;font-size:36px;font-weight:900;line-height:1">${fmt(metrics.totalARRGain)}</div>
    </div>
  </div>

  <!-- NRR Hero + KPI Row -->
  <div style="background:linear-gradient(135deg,#1E3A5F 0%,#2a4f7f 100%);border-radius:10px;padding:16px 24px;margin-bottom:14px;display:grid;grid-template-columns:1fr 1px 1fr 1px 1fr 1px 1fr;gap:0;align-items:center">
    <div style="text-align:center;padding:0 12px">
      <div style="color:#C4B5A6;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px">NRR: Current → Projected</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:10px">
        <span style="color:#fff;font-size:26px;font-weight:700">${base.nrr.toFixed(1)}%</span>
        <span style="color:#C4B5A6;font-size:14px">→</span>
        <span style="color:#6ee7a0;font-size:26px;font-weight:700">${improved.nrr.toFixed(1)}%</span>
      </div>
      <div style="display:inline-block;margin-top:6px;padding:3px 10px;background:rgba(110,231,160,0.2);border:1px solid rgba(110,231,160,0.4);border-radius:20px;color:#6ee7a0;font-size:10px;font-weight:700">+${nrrDelta.toFixed(1)} pts</div>
    </div>
    <div style="width:1px;height:50px;background:rgba(255,255,255,0.15);margin:0 auto"></div>
    <div style="text-align:center;padding:0 12px">
      <div style="color:#C4B5A6;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px">MRR Lift</div>
      <div style="color:#6ee7a0;font-size:24px;font-weight:700">+${fmt(metrics.totalMRRGain)}/mo</div>
      <div style="color:#D6D3D1;font-size:9px;margin-top:3px">${fmt(base.mrr)} → ${fmt(base.mrr+metrics.totalMRRGain)}</div>
    </div>
    <div style="width:1px;height:50px;background:rgba(255,255,255,0.15);margin:0 auto"></div>
    <div style="text-align:center;padding:0 12px">
      <div style="color:#C4B5A6;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px">Payback Period</div>
      <div style="color:${payback&&payback<=6?"#6ee7a0":"#fbbf24"};font-size:28px;font-weight:900">${payback?`${payback} mo`:"—"}</div>
      <div style="color:#D6D3D1;font-size:9px;margin-top:3px">@ ${fmt(fee)}/mo investment</div>
    </div>
    <div style="width:1px;height:50px;background:rgba(255,255,255,0.15);margin:0 auto"></div>
    <div style="text-align:center;padding:0 12px">
      <div style="color:#C4B5A6;font-size:8px;letter-spacing:0.14em;text-transform:uppercase;margin-bottom:4px">ROI</div>
      <div style="color:#6ee7a0;font-size:28px;font-weight:900">${pct(((metrics.totalARRGain-fee*12)/(fee*12))*100)}</div>
      <div style="color:#D6D3D1;font-size:9px;margin-top:3px">annual return on investment</div>
    </div>
  </div>

  <!-- Two column layout -->
  <div style="display:grid;grid-template-columns:1fr 230px;gap:14px">
    <div style="display:flex;flex-direction:column;gap:14px">

      <!-- Metrics Table -->
      <div style="background:#fff;border-radius:10px;border:1px solid #D6D3D1;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="background:#1E3A5F">
              <th style="padding:10px 12px;text-align:left;color:#C4B5A6;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">Metric</th>
              <th style="padding:10px 12px;text-align:center;color:#C4B5A6;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">Current</th>
              <th style="padding:10px 12px;text-align:center;color:#fff;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">With FreedomOps</th>
              <th style="padding:10px 12px;text-align:right;color:#C4B5A6;font-size:9px;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">Δ Change</th>
            </tr>
            <tr style="background:#fafbfc">
              <td style="padding:9px 12px;font-size:12px;font-weight:700;color:#222;border-bottom:2px solid #D6D3D1">Monthly Recurring Revenue</td>
              <td style="padding:9px 12px;text-align:center;font-weight:700;font-size:12px;color:#1E3A5F;border-bottom:2px solid #D6D3D1">${fmt(base.mrr)}</td>
              <td style="padding:9px 12px;text-align:center;font-weight:700;font-size:12px;color:#2e7d4f;border-bottom:2px solid #D6D3D1">${fmt(base.mrr+metrics.totalMRRGain)}</td>
              <td style="padding:9px 12px;text-align:right;border-bottom:2px solid #D6D3D1"><span style="display:inline-block;padding:2px 8px;border-radius:20px;font-size:10px;font-weight:700;background:#e8f5ee;color:#2e7d4f">${pct((metrics.totalMRRGain/base.mrr)*100)}</span></td>
            </tr>
          </thead>
          <tbody>${tableRows}</tbody>
        </table>
      </div>

      <!-- Charts side by side -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div style="background:#fff;border-radius:10px;border:1px solid #D6D3D1;overflow:hidden">
          <div style="background:#1E3A5F;padding:9px 14px"><div style="color:#fff;font-size:9px;font-weight:700;letter-spacing:0.07em">12-MONTH MRR PROJECTION</div></div>
          <div style="padding:12px">
            <svg width="100%" viewBox="0 0 ${LW} ${LH}">
              ${lineGrid}
              ${lineXLabels}
              <polygon points="${fillPts}" fill="#1E3A5F" fill-opacity="0.07"/>
              <polyline points="${withoutPts}" fill="none" stroke="#D6D3D1" stroke-width="1.5" stroke-dasharray="5 4"/>
              <polyline points="${withPts}" fill="none" stroke="#1E3A5F" stroke-width="2"/>
            </svg>
            <div style="display:flex;gap:14px;justify-content:center;margin-top:6px">
              <div style="display:flex;align-items:center;gap:4px;font-size:9px;color:#555"><span style="display:inline-block;width:18px;height:2px;background:#1E3A5F"></span>With FreedomOps</div>
              <div style="display:flex;align-items:center;gap:4px;font-size:9px;color:#999"><span style="display:inline-block;width:18px;height:2px;background:#D6D3D1;border-top:1px dashed #aaa"></span>Without</div>
            </div>
          </div>
        </div>
        <div style="background:#fff;border-radius:10px;border:1px solid #D6D3D1;overflow:hidden">
          <div style="background:#701427;padding:9px 14px"><div style="color:#fff;font-size:9px;font-weight:700;letter-spacing:0.07em">CUMULATIVE ARR GAIN</div></div>
          <div style="padding:12px">
            <svg width="100%" viewBox="0 0 ${W} ${H}">${svgGrid}${svgBars}</svg>
          </div>
        </div>
      </div>
    </div>

    <!-- Right column -->
    <div style="display:flex;flex-direction:column;gap:12px">

      <!-- Waterfall -->
      <div style="background:#fff;border-radius:10px;border:1px solid #D6D3D1;overflow:hidden">
        <div style="background:#701427;padding:9px 14px"><div style="color:#fff;font-size:9px;font-weight:700;letter-spacing:0.07em">MRR GAIN BREAKDOWN</div></div>
        <div style="padding:12px">
          ${wBar("Churn Reduction", metrics.churnSaved, C.navy)}
          ${wBar("Expansion Revenue", metrics.expansionGain, C.burgundy)}
          ${wBar("NRR Improvement", metrics.nrrLift, C.tan)}
          ${wBar("Support Cost Savings", metrics.costSaved, "#5a7fa8")}
          <div style="margin-top:10px;padding-top:10px;border-top:2px solid #1E3A5F;display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:9px;font-weight:700;color:#1E3A5F">Total Monthly</span>
            <span style="font-size:13px;font-weight:900;color:#1E3A5F">${fmt(metrics.totalMRRGain+metrics.costSaved)}/mo</span>
          </div>
        </div>
      </div>

      <!-- Payback detail -->
      <div style="background:#fff;border-radius:10px;border:1px solid #D6D3D1;overflow:hidden">
        <div style="background:#1E3A5F;padding:9px 14px"><div style="color:#fff;font-size:9px;font-weight:700;letter-spacing:0.07em">PAYBACK CALCULATOR</div></div>
        <div style="padding:12px">
          ${[
            ["Monthly Impact", fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo", C.navy],
            ["Annual Investment", fmt(fee*12), "#888"],
            ["Annual Return", fmt(metrics.totalARRGain), "#2e7d4f"],
            ["ROI", pct(((metrics.totalARRGain-fee*12)/(fee*12))*100), "#2e7d4f"],
          ].map(([l,v,col])=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #D6D3D1"><span style="font-size:10px;color:#777">${l}</span><span style="font-size:11px;font-weight:700;color:${col}">${v}</span></div>`).join("")}
          <div style="margin-top:10px;padding:9px;background:${payback&&payback<=6?"#e8f5ee":"#fff8ec"};border-radius:7px;text-align:center;border:1px solid ${payback&&payback<=6?"#a7d7b9":"#fcd57a"}">
            <div style="font-size:8px;color:#999;letter-spacing:0.09em;text-transform:uppercase;margin-bottom:2px">Payback Period</div>
            <div style="font-size:22px;font-weight:900;color:${payback&&payback<=6?"#2e7d4f":"#b45309"}">${payback?`${payback} months`:"—"}</div>
            <div style="font-size:9px;color:#aaa;margin-top:2px">to recoup investment</div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Footer -->
  <div style="text-align:center;margin-top:14px;color:#ccc;font-size:9px;letter-spacing:0.08em">
    ${client.toUpperCase()} × FREEDOMOPS CONFIDENTIAL · FOR DISCUSSION PURPOSES ONLY · ${date}
  </div>

</div>
<script>window.onload=function(){window.print();}</script>
</body>
</html>`;

  const w = window.open("", "_blank", "width=1100,height=800");
  if (!w) { alert("Pop-up blocked — please allow pop-ups for this page and try again."); return; }
  w.document.write(html);
  w.document.close();
}

// ── Main Dashboard ────────────────────────────────────────────
export default function Dashboard() {
  const [base,setBase]=useState({...BASE});
  const [improved,setImproved]=useState(applyScenario(BASE,"moderate"));
  const [customImp,setCustomImp]=useState(applyScenario(BASE,"moderate"));
  const [activeSc,setActiveSc]=useState("moderate");
  const [snapState,setSnapState]=useState("idle");
  const [clientName,setClientName]=useState("");
  const [editClient,setEditClient]=useState(false);
  const [tab,setTab]=useState("mrr");
  const [fee,setFee]=useState(5000);
  const [editFee,setEditFee]=useState(false);
  const [rawFee,setRawFee]=useState("");
  const feeRef=useRef();

  const metrics=computeMetrics(base,improved);
  const proj=useMemo(()=>buildProjection(base,improved),[base,improved]);
  const maxWF=Math.max(metrics.churnSaved,metrics.expansionGain,Math.abs(metrics.nrrLift),metrics.costSaved,1);
  const nrrDelta=improved.nrr-base.nrr;

  const payback=useMemo(()=>{
    let cum=0;const mg=metrics.totalMRRGain+(base.supportCost-improved.supportCost);
    for(let m=1;m<=60;m++){cum+=mg;if(cum>=fee*m)return m;}return null;
  },[metrics,base,improved,fee]);

  const setSc=key=>{
    setActiveSc(key);
    if(key==="custom"){ setImproved({...customImp}); }
    else { const ni=applyScenario(base,key); setImproved(ni); }
  };

  const updateCustomField=(field,val)=>{
    const updated={...customImp,[field]:val};
    setCustomImp(updated);
    if(activeSc==="custom") setImproved(updated);
  };

  const updBase=f=>v=>{const nb={...base,[f]:v};setBase(nb);if(activeSc&&activeSc!=="custom")setImproved(applyScenario(nb,activeSc));};
  const updImp=f=>v=>{setActiveSc(null);setImproved(p=>({...p,[f]:v}));};

  const doSnapshot=()=>{
    const cl=clientName.trim()||"Prospect";
    const txt=[`FreedomOps × ${cl} — Impact Snapshot`,"─".repeat(36),`Additional ARR:        ${fmt(metrics.totalARRGain)}`,`MRR Lift:              ${fmt(metrics.totalMRRGain)}/mo`,`NRR Lift:              +${nrrDelta.toFixed(1)} pts (${base.nrr}% → ${improved.nrr}%)`,`Payback Period:        ${payback?payback+" months":"—"}`,`ROI:                   ${pct(((metrics.totalARRGain-fee*12)/(fee*12))*100)}`,`Churn Reduction:       ${pct(((improved.churnRate-base.churnRate)/base.churnRate)*100)}`,`Expansion Rate:        ${base.expansionRate}% → ${improved.expansionRate}%`,`TTFV:                  ${base.ttfv} → ${improved.ttfv} days`,`Support Savings:       ${fmt(base.supportCost-improved.supportCost)}/mo`,`CSAT:                  ${base.csat} → ${improved.csat}`,].join("\n");
    const ta=document.createElement("textarea");ta.value=txt;ta.style.cssText="position:fixed;top:-9999px;left:-9999px;opacity:0;";document.body.appendChild(ta);ta.focus();ta.select();
    try{document.execCommand("copy");setSnapState("copied");}catch{setSnapState("error");}
    document.body.removeChild(ta);setTimeout(()=>setSnapState("idle"),2500);
  };

  const handleExportPDF=()=>{
    exportToPDF({ base, improved, metrics, proj, payback, fee, clientName, activeSc, nrrDelta });
  };

  const rows=[
    {field:"churnRate",    label:"Monthly Churn Rate",         prefix:"",  suffix:"%",decimals:2,lowerIsBetter:true},
    {field:"nrr",          label:"Net Revenue Retention",      prefix:"",  suffix:"%",decimals:1},
    {field:"ttfv",         label:"Time-to-First-Value (days)", prefix:"",  suffix:"", decimals:0,lowerIsBetter:true},
    {field:"expansionRate",label:"Monthly Expansion Rate",     prefix:"",  suffix:"%",decimals:2},
    {field:"supportCost",  label:"Monthly Support Cost",       prefix:"$", suffix:"", decimals:0,lowerIsBetter:true},
    {field:"csat",         label:"CSAT Score",                 prefix:"",  suffix:"", decimals:1},
  ];

  const callouts=[
    {label:"NRR Lift",         value:`+${nrrDelta.toFixed(1)}pts`,                                   sub:`${base.nrr}% → ${improved.nrr}%`,             color:C.navy},
    {label:"Churn Reduction",  value:pct(((improved.churnRate-base.churnRate)/base.churnRate)*100),   sub:`${base.churnRate}% → ${improved.churnRate}%`,  color:C.burgundy},
    {label:"TTFV Improvement", value:pct(((improved.ttfv-base.ttfv)/base.ttfv)*100),                 sub:`${base.ttfv} → ${improved.ttfv} days`,         color:C.burgundy},
    {label:"CSAT Gain",        value:`+${(improved.csat-base.csat).toFixed(1)}`,                     sub:`${base.csat} → ${improved.csat}`,              color:C.navy},
  ];

  const snapLabel={idle:"📋 Snapshot",copied:"✓ Copied!",error:"⚠ Ctrl+C"}[snapState];
  const clientDisplay=clientName.trim()?`${clientName.trim()} × FreedomOps`:"FreedomOps";

  const scBtn=(id,lbl)=>(
    <button onClick={()=>setSc(id)} style={{padding:"5px 12px",borderRadius:"5px",border:activeSc===id?"none":`1px solid rgba(255,255,255,0.2)`,background:activeSc===id?C.burgundy:"rgba(255,255,255,0.08)",color:activeSc===id?"#fff":C.tan,fontSize:"10px",fontWeight:700,cursor:"pointer",letterSpacing:"0.06em",textTransform:"capitalize",transition:"all 0.2s"}}>{lbl}</button>
  );

  return (
    <div style={{minHeight:"100vh",background:C.offwhite,fontFamily:"'Helvetica Neue',Arial,sans-serif"}}>

      {/* Header */}
      <div style={{background:C.navy,padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 2px 18px rgba(0,0,0,0.25)"}}>
        <div style={{padding:"15px 0",display:"flex",alignItems:"center",gap:"10px"}}>
          <div style={{width:"32px",height:"32px",background:C.burgundy,borderRadius:"6px",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
            <span style={{color:"#fff",fontWeight:900,fontSize:"14px"}}>F</span>
          </div>
          <div>
            {editClient?(
              <input defaultValue={clientName} autoFocus
                onBlur={e=>{setClientName(e.target.value.trim());setEditClient(false);}}
                onKeyDown={e=>{if(e.key==="Enter"||e.key==="Escape"){setClientName(e.target.value.trim());setEditClient(false);}}}
                placeholder="Type client name…"
                style={{background:"rgba(255,255,255,0.15)",border:"1px solid rgba(255,255,255,0.45)",borderRadius:"4px",color:"#fff",fontSize:"14px",fontWeight:700,padding:"2px 7px",outline:"none",width:"210px"}}
              />
            ):(
              <div onClick={()=>setEditClient(true)} style={{color:"#fff",fontWeight:700,fontSize:"15px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px"}}>
                {clientDisplay}
                <span style={{fontSize:"8px",color:C.tan,fontWeight:400,border:`1px dashed ${C.tan}`,borderRadius:"3px",padding:"1px 5px"}}>edit</span>
              </div>
            )}
            <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.14em",textTransform:"uppercase"}}>Impact Modeler</div>
          </div>
        </div>
        <div style={{display:"flex",gap:"5px",alignItems:"center"}}>
          {scBtn("conservative","Conservative")}
          {scBtn("moderate","Moderate")}
          {scBtn("aggressive","Aggressive")}
          {scBtn("custom","✦ Custom")}
          <div style={{width:"1px",height:"22px",background:"rgba(255,255,255,0.2)",margin:"0 4px"}}/>
          <button onClick={doSnapshot} style={{padding:"5px 11px",borderRadius:"5px",border:`1px solid ${C.tan}`,background:snapState==="copied"?C.positive:snapState==="error"?"#b45309":"transparent",color:snapState!=="idle"?"#fff":C.tan,fontSize:"10px",fontWeight:600,cursor:"pointer",transition:"all 0.2s",whiteSpace:"nowrap"}}>{snapLabel}</button>
          <button onClick={handleExportPDF} style={{padding:"5px 11px",borderRadius:"5px",border:`1px solid ${C.tan}`,background:"transparent",color:C.tan,fontSize:"10px",fontWeight:600,cursor:"pointer",whiteSpace:"nowrap"}}>⬇ Export PDF</button>
        </div>
      </div>

      <div style={{padding:"20px 24px",maxWidth:"1340px",margin:"0 auto"}}>

        {/* NRR Hero */}
        <div style={{background:`linear-gradient(135deg,${C.navy} 0%,${C.navyMid} 100%)`,borderRadius:"12px",padding:"20px 28px",marginBottom:"16px",boxShadow:"0 8px 32px rgba(30,58,95,0.3)",position:"relative",overflow:"hidden"}}>
          <div style={{position:"absolute",top:0,right:0,width:"280px",height:"100%",background:"radial-gradient(ellipse at top right,rgba(112,20,39,0.4) 0%,transparent 70%)",pointerEvents:"none"}}/>
          {/* NRR main row */}
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"16px",paddingBottom:"16px",borderBottom:"1px solid rgba(255,255,255,0.12)"}}>
            <div style={{display:"flex",alignItems:"center",gap:"20px"}}>
              <div style={{textAlign:"center"}}>
                <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>Current NRR</div>
                <div style={{color:"#fff",fontSize:"34px",fontWeight:700,lineHeight:1}}>{base.nrr.toFixed(1)}<span style={{fontSize:"17px"}}>%</span></div>
              </div>
              <div style={{color:C.tan,fontSize:"22px",fontWeight:300}}>→</div>
              <div style={{textAlign:"center"}}>
                <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>With FreedomOps</div>
                <div style={{color:"#6ee7a0",fontSize:"34px",fontWeight:700,lineHeight:1}}>{improved.nrr.toFixed(1)}<span style={{fontSize:"17px"}}>%</span></div>
              </div>
              <div style={{background:"rgba(110,231,160,0.15)",border:"1px solid rgba(110,231,160,0.35)",borderRadius:"8px",padding:"8px 18px",textAlign:"center"}}>
                <div style={{color:"rgba(110,231,160,0.75)",fontSize:"8px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"2px"}}>NRR Lift</div>
                <div style={{color:"#6ee7a0",fontSize:"28px",fontWeight:900,lineHeight:1}}>+{nrrDelta.toFixed(1)}<span style={{fontSize:"14px"}}>pts</span></div>
              </div>
            </div>
            <div style={{textAlign:"right",position:"relative",zIndex:1}}>
              <div style={{color:C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>Additional ARR Impact</div>
              <div style={{color:"#fff",fontSize:"42px",fontWeight:900,lineHeight:1}}>{fmt(metrics.totalARRGain)}</div>
              <div style={{display:"inline-block",marginTop:"6px",padding:"3px 10px",background:C.burgundy,borderRadius:"20px",color:"#fff",fontSize:"9px",fontWeight:600}}>with FreedomOps</div>
            </div>
          </div>
          {/* Sub metrics */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"12px"}}>
            {[
              {label:"Current MRR",   value:fmt(base.mrr),                                     sub:"per month",                              col:"#fff"},
              {label:"Projected MRR", value:fmt(base.mrr+metrics.totalMRRGain),                sub:`+${fmt(metrics.totalMRRGain)}/mo lift`,  col:"#6ee7a0"},
              {label:"Payback Period",value:payback?`${payback}mo`:"—",                        sub:`@ ${fmt(fee)}/mo fee`,                   col:payback&&payback<=6?"#6ee7a0":"#fbbf24", clickFee:true},
              {label:"Monthly Gain",  value:fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo", sub:"net impact",                            col:"#6ee7a0"},
            ].map((item,i)=>(
              <div key={i} style={{textAlign:"center"}}>
                <div style={{color:C.tan,fontSize:"8px",letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:"3px"}}>{item.label}</div>
                <div style={{color:item.col,fontSize:"20px",fontWeight:700}}>{item.value}</div>
                <div onClick={item.clickFee?()=>{setRawFee(fee.toString());setEditFee(true);}:undefined} style={{color:C.silver,fontSize:"9px",marginTop:"2px",cursor:item.clickFee?"pointer":"default",borderBottom:item.clickFee?`1px dashed ${C.tan}`:"none",display:"inline-block"}}>{item.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Fee modal */}
        {editFee&&(
          <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.4)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100}}>
            <div style={{background:"#fff",borderRadius:"12px",padding:"24px",boxShadow:"0 8px 40px rgba(0,0,0,0.2)",minWidth:"260px"}}>
              <div style={{fontWeight:700,color:C.navy,fontSize:"14px",marginBottom:"12px"}}>Set Monthly Fee</div>
              <input ref={feeRef} value={rawFee} onChange={e=>setRawFee(e.target.value)} autoFocus
                onKeyDown={e=>{if(e.key==="Enter"){const p=parseFloat(rawFee);if(!isNaN(p))setFee(p);setEditFee(false);}if(e.key==="Escape")setEditFee(false);}}
                style={{width:"100%",border:`2px solid ${C.burgundy}`,borderRadius:"6px",padding:"8px 12px",fontSize:"16px",fontWeight:700,outline:"none",color:C.navy,boxSizing:"border-box"}}
              />
              <div style={{display:"flex",gap:"8px",marginTop:"12px"}}>
                <button onClick={()=>{const p=parseFloat(rawFee);if(!isNaN(p))setFee(p);setEditFee(false);}} style={{flex:1,padding:"8px",background:C.navy,color:"#fff",border:"none",borderRadius:"6px",fontWeight:700,cursor:"pointer"}}>Save</button>
                <button onClick={()=>setEditFee(false)} style={{flex:1,padding:"8px",background:C.offwhite,color:C.navy,border:`1px solid ${C.silver}`,borderRadius:"6px",fontWeight:600,cursor:"pointer"}}>Cancel</button>
              </div>
            </div>
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 276px",gap:"14px"}}>
          <div style={{display:"flex",flexDirection:"column",gap:"14px"}}>

            {/* Custom panel */}
            {activeSc==="custom"&&(
              <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
                <div style={{background:C.burgundy,padding:"11px 16px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{color:"#fff",fontSize:"10px",fontWeight:700,letterSpacing:"0.07em"}}>✦ CUSTOM SCENARIO — Adjust sliders or type values directly</div>
                  <button onClick={()=>{setActiveSc("custom");setImproved({...customImp});}} style={{padding:"4px 12px",background:"rgba(255,255,255,0.2)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:"5px",color:"#fff",fontSize:"9px",fontWeight:700,cursor:"pointer"}}>Apply</button>
                </div>
                <CustomScenarioEditor base={base} customImp={customImp} onChange={updateCustomField}/>
              </div>
            )}

            {/* Metrics table */}
            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,padding:"11px 16px",display:"grid",gridTemplateColumns:"1fr 1fr 1fr 90px"}}>
                {["Metric","Current","With FreedomOps","Δ Change"].map((h,i)=>(
                  <div key={h} style={{color:i===2?"#fff":C.tan,fontSize:"9px",letterSpacing:"0.12em",textTransform:"uppercase",textAlign:i===0?"left":i===3?"right":"center",fontWeight:700}}>{h}</div>
                ))}
              </div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 90px",padding:"11px 16px",alignItems:"center",borderBottom:`2px solid ${C.silver}`,background:"#fafbfc"}}>
                <div style={{color:"#222",fontSize:"12px",fontWeight:700}}>Monthly Recurring Revenue</div>
                <div style={{textAlign:"center"}}><EditableCell value={base.mrr} onChange={v=>setBase(b=>({...b,mrr:v}))} prefix="$" suffix="" decimals={0}/></div>
                <div style={{textAlign:"center"}}><span style={{color:C.positive,fontWeight:700,fontSize:"12px"}}>{fmt(base.mrr+metrics.totalMRRGain)}</span></div>
                <div style={{textAlign:"right"}}><span style={{display:"inline-block",padding:"2px 7px",borderRadius:"20px",fontSize:"10px",fontWeight:700,background:C.posLight,color:C.positive}}>{pct((metrics.totalMRRGain/base.mrr)*100)}</span></div>
              </div>
              {rows.map(r=><MetricRow key={r.field} label={r.label} baseVal={base[r.field]} improvedVal={improved[r.field]} prefix={r.prefix} suffix={r.suffix} decimals={r.decimals} lowerIsBetter={r.lowerIsBetter} onBaseChange={updBase(r.field)} onImprovedChange={updImp(r.field)}/>)}
              <div style={{padding:"8px 16px",background:"#f8f9fb"}}>
                <div style={{fontSize:"9px",color:"#aaa",fontStyle:"italic"}}>💡 Click any underlined value to edit. Use scenario presets to apply assumptions.</div>
              </div>
            </div>

            {/* Chart tabs */}
            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,display:"flex",alignItems:"flex-end",padding:"0 16px",gap:"0"}}>
                {[["mrr","12-Month MRR Projection"],["cumulative","Cumulative ARR Gain"]].map(([id,lbl])=>(
                  <button key={id} onClick={()=>setTab(id)} style={{padding:"7px 14px",border:"none",cursor:"pointer",background:tab===id?"#fff":"transparent",color:tab===id?C.navy:C.tan,fontSize:"9px",fontWeight:700,letterSpacing:"0.08em",textTransform:"uppercase",borderBottom:tab===id?`3px solid ${C.burgundy}`:"3px solid transparent",transition:"all 0.2s"}}>{lbl}</button>
                ))}
              </div>
              <div style={{padding:"14px 16px 10px"}}>
                <div style={{fontSize:"9px",color:"#aaa",marginBottom:"10px"}}>
                  {tab==="mrr"?"MRR trajectory with vs. without FreedomOps — hover for values.":"Cumulative additional revenue from partnering with FreedomOps — hover for values."}
                </div>
                {tab==="mrr"&&<LineChartSVG data={proj}/>}
                {tab==="cumulative"&&<BarChartSVG data={proj}/>}
              </div>
            </div>
          </div>

          {/* Right col */}
          <div style={{display:"flex",flexDirection:"column",gap:"12px"}}>
            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.burgundy,padding:"10px 14px"}}>
                <div style={{color:"#fff",fontSize:"9px",fontWeight:700,letterSpacing:"0.07em"}}>MRR GAIN BREAKDOWN</div>
              </div>
              <div style={{padding:"12px"}}>
                <WBar label="Churn Reduction"      value={metrics.churnSaved}    maxVal={maxWF} color={C.navy}/>
                <WBar label="Expansion Revenue"    value={metrics.expansionGain} maxVal={maxWF} color={C.burgundy}/>
                <WBar label="NRR Improvement"      value={metrics.nrrLift}        maxVal={maxWF} color={C.tan}/>
                <WBar label="Support Cost Savings" value={metrics.costSaved}      maxVal={maxWF} color="#5a7fa8"/>
                <div style={{marginTop:"10px",paddingTop:"10px",borderTop:`2px solid ${C.navy}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontSize:"9px",fontWeight:700,color:C.navy}}>Total Monthly</span>
                  <span style={{fontSize:"13px",fontWeight:900,color:C.navy}}>{fmt(metrics.totalMRRGain+metrics.costSaved)}/mo</span>
                </div>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"8px"}}>
              {callouts.map(c=>(
                <div key={c.label} style={{background:"#fff",borderRadius:"8px",padding:"11px",borderTop:`3px solid ${c.color}`,boxShadow:"0 2px 8px rgba(0,0,0,0.06)"}}>
                  <div style={{fontSize:"7px",color:"#999",letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:"3px"}}>{c.label}</div>
                  <div style={{fontSize:"16px",fontWeight:900,color:c.color,lineHeight:1.1}}>{c.value}</div>
                  <div style={{fontSize:"9px",color:"#bbb",marginTop:"2px"}}>{c.sub}</div>
                </div>
              ))}
            </div>

            <div style={{background:"#fff",borderRadius:"10px",boxShadow:"0 2px 12px rgba(0,0,0,0.07)",overflow:"hidden"}}>
              <div style={{background:C.navy,padding:"10px 14px"}}>
                <div style={{color:"#fff",fontSize:"9px",fontWeight:700,letterSpacing:"0.07em"}}>PAYBACK CALCULATOR</div>
              </div>
              <div style={{padding:"12px"}}>
                <div style={{display:"flex",alignItems:"center",gap:"6px",marginBottom:"10px"}}>
                  <span style={{fontSize:"10px",color:"#666"}}>Monthly Fee:</span>
                  <span onClick={()=>{setRawFee(fee.toString());setEditFee(true);}} style={{fontWeight:700,fontSize:"12px",color:C.navy,cursor:"pointer",borderBottom:`2px dashed ${C.tan}`,padding:"1px 2px"}}>{fmt(fee)}/mo</span>
                </div>
                {[
                  {label:"Monthly Impact",   value:fmt(metrics.totalMRRGain+metrics.costSaved)+"/mo", color:C.navy},
                  {label:"Annual Investment",value:fmt(fee*12),                                       color:"#888"},
                  {label:"Annual Return",    value:fmt(metrics.totalARRGain),                         color:C.positive},
                  {label:"ROI",              value:pct(((metrics.totalARRGain-fee*12)/(fee*12))*100), color:C.positive},
                ].map(item=>(
                  <div key={item.label} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:`1px solid ${C.silver}`}}>
                    <span style={{fontSize:"10px",color:"#777"}}>{item.label}</span>
                    <span style={{fontSize:"11px",fontWeight:700,color:item.color}}>{item.value}</span>
                  </div>
                ))}
                <div style={{marginTop:"11px",padding:"9px",background:payback&&payback<=6?C.posLight:"#fff8ec",borderRadius:"7px",textAlign:"center",border:`1px solid ${payback&&payback<=6?"#a7d7b9":"#fcd57a"}`}}>
                  <div style={{fontSize:"8px",color:"#999",letterSpacing:"0.09em",textTransform:"uppercase",marginBottom:"2px"}}>Payback Period</div>
                  <div style={{fontSize:"20px",fontWeight:900,color:payback&&payback<=6?C.positive:"#b45309"}}>{payback?`${payback} months`:"—"}</div>
                  <div style={{fontSize:"9px",color:"#aaa",marginTop:"2px"}}>to recoup investment</div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div style={{textAlign:"center",marginTop:"16px",color:"#ccc",fontSize:"9px",letterSpacing:"0.08em"}}>
          {clientName.trim()?`${clientName.trim().toUpperCase()} × `:""}FREEDOMOPS CONFIDENTIAL · FOR DISCUSSION PURPOSES ONLY
          {activeSc==="custom"&&<span style={{marginLeft:"8px",color:C.tan}}>· CUSTOM SCENARIO</span>}
        </div>
      </div>
    </div>
  );
}

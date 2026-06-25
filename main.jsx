import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Plus, Trash2, RefreshCw, Settings, Download, Upload, Calculator, TrendingDown, Percent } from 'lucide-react';
import './style.css';

const STORAGE_KEY = 'tiddoi-v2-state';
const DEMO_PORTFOLIO = { id: 'main', name: 'พอร์ตเริ่มต้น', targetPct: 100, holdings: [], cash: 0 };

const emptyState = {
  apiKey: '',
  activeId: 'main',
  portfolios: [DEMO_PORTFOLIO],
  quotes: {},
  lastUpdated: null,
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState;
    const parsed = JSON.parse(raw);
    return { ...emptyState, ...parsed, portfolios: parsed.portfolios?.length ? parsed.portfolios : [DEMO_PORTFOLIO] };
  } catch {
    return emptyState;
  }
}

function saveState(state) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const uid = () => `id_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
const num = (v) => Number.isFinite(Number(v)) ? Number(v) : 0;
const money = (v) => v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const qty = (v) => Number(v || 0).toLocaleString('en-US', { maximumFractionDigits: 5 });
const pct = (v) => v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`;
const cleanSymbol = (s) => String(s || '').trim().toUpperCase();

function App() {
  const [state, setState] = useState(loadState);
  const [showSettings, setShowSettings] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [sim, setSim] = useState(null);

  useEffect(() => saveState(state), [state]);

  const active = useMemo(() => state.portfolios.find((p) => p.id === state.activeId) || state.portfolios[0], [state]);
  const allHoldings = useMemo(() => state.portfolios.flatMap((p) => (p.holdings || []).map((h) => ({ ...h, portfolioName: p.name }))), [state.portfolios]);
  const rows = useMemo(() => groupRows(active?.holdings || [], state.quotes), [active, state.quotes]);
  const overviewRows = useMemo(() => groupRows(allHoldings, state.quotes), [allHoldings, state.quotes]);
  const totals = useMemo(() => calcTotals(rows), [rows]);
  const overviewTotals = useMemo(() => calcTotals(overviewRows), [overviewRows]);

  const isOverview = state.activeId === '__overview__';
  const displayRows = isOverview ? overviewRows : rows;
  const displayTotals = isOverview ? overviewTotals : totals;
  const displayCash = isOverview ? state.portfolios.reduce((s, p) => s + num(p.cash), 0) : num(active?.cash);
  const grandTotal = (displayTotals.value || displayTotals.cost) + displayCash;

  function updateState(fn) {
    setState((prev) => {
      const next = typeof fn === 'function' ? fn(prev) : fn;
      return next;
    });
  }

  function updatePortfolio(id, updater) {
    updateState((prev) => ({ ...prev, portfolios: prev.portfolios.map((p) => p.id === id ? updater(p) : p) }));
  }

  async function refreshQuotes() {
    const symbols = [...new Set((isOverview ? allHoldings : active.holdings).map((h) => h.symbol))];
    if (!state.apiKey) return setError('กรุณาใส่ Finnhub API Key ในตั้งค่าก่อน');
    if (!symbols.length) return;
    setLoading(true); setError('');
    const nextQuotes = { ...state.quotes };
    try {
      for (const symbol of symbols) {
        const res = await fetch(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${state.apiKey}`);
        if (res.status === 401 || res.status === 403) throw new Error('API Key ไม่ถูกต้อง');
        if (res.status === 429) throw new Error('เรียก API ถี่เกินไป โปรดลองใหม่ภายหลัง');
        const data = await res.json();
        nextQuotes[symbol] = data && typeof data.c === 'number' && data.c > 0
          ? { price: data.c, prevClose: data.pc, dayChangePct: data.dp }
          : { price: null, notFound: true };
      }
      updateState((prev) => ({ ...prev, quotes: nextQuotes, lastUpdated: new Date().toISOString() }));
    } catch (e) {
      setError(`เชื่อมต่อ Finnhub ไม่ได้: ${e?.message || String(e)}`);
    } finally { setLoading(false); }
  }

  function addHolding(data) {
    const holding = { id: uid(), symbol: cleanSymbol(data.symbol), shares: num(data.shares), costPerShare: num(data.costPerShare), targetPct: data.targetPct === '' ? null : num(data.targetPct) };
    if (!holding.symbol || holding.shares <= 0 || holding.costPerShare <= 0) return setError('กรุณากรอก Symbol, จำนวนหุ้น และต้นทุนให้ถูกต้อง');
    updatePortfolio(active.id, (p) => ({ ...p, holdings: [...(p.holdings || []), holding] }));
    setShowAdd(false); setError('');
  }

  function saveHolding(id, data) {
    updatePortfolio(active.id, (p) => ({ ...p, holdings: p.holdings.map((h) => h.id === id ? { ...h, symbol: cleanSymbol(data.symbol), shares: num(data.shares), costPerShare: num(data.costPerShare), targetPct: data.targetPct === '' ? null : num(data.targetPct) } : h) }));
    setEditing(null);
  }

  function deleteHolding(id) {
    updatePortfolio(active.id, (p) => ({ ...p, holdings: p.holdings.filter((h) => h.id !== id) }));
    setEditing(null);
  }

  function createPortfolio() {
    const name = prompt('ชื่อพอร์ตใหม่');
    if (!name) return;
    const id = uid();
    updateState((prev) => ({ ...prev, activeId: id, portfolios: [...prev.portfolios, { id, name, targetPct: null, cash: 0, holdings: [] }] }));
  }

  function deletePortfolio(id) {
    if (state.portfolios.length <= 1) return alert('ต้องมีอย่างน้อย 1 พอร์ต');
    if (!confirm('ลบพอร์ตนี้?')) return;
    updateState((prev) => {
      const ps = prev.portfolios.filter((p) => p.id !== id);
      return { ...prev, portfolios: ps, activeId: ps[0].id };
    });
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `tiddoi-backup-${new Date().toISOString().slice(0,10)}.json`; a.click();
    URL.revokeObjectURL(url);
  }

  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try { setState({ ...emptyState, ...JSON.parse(reader.result) }); setShowSettings(false); }
      catch { alert('ไฟล์ Backup ไม่ถูกต้อง'); }
    };
    reader.readAsText(file);
  }

  return <div className="app">
    <header className="header">
      <div><div className="brand"><span>◆</span><h1>TIDDOI</h1></div><p>พอร์ตหุ้นสหรัฐฯ ของคุณ</p></div>
      <div className="actions"><button onClick={refreshQuotes} disabled={loading}><RefreshCw size={18} className={loading ? 'spin' : ''}/></button><button onClick={() => setShowSettings(true)}><Settings size={18}/></button></div>
    </header>

    <div className="tabs"><button className={isOverview ? 'active' : ''} onClick={() => updateState((p) => ({ ...p, activeId: '__overview__' }))}>◆ พอร์ตหลัก</button>{state.portfolios.map(p => <button key={p.id} className={p.id === state.activeId ? 'active' : ''} onClick={() => updateState((s) => ({ ...s, activeId: p.id }))}>{p.name}</button>)}<button onClick={createPortfolio}><Plus size={16}/></button></div>

    {error && <div className="error">{error}</div>}
    {!state.apiKey && <div className="banner">ยังไม่ได้ใส่ Finnhub API Key <button onClick={() => setShowSettings(true)}>ตั้งค่า</button></div>}

    <section className="summary">
      <Card label="มูลค่าพอร์ต" value={money(displayTotals.value)} big />
      <Card label="เงินสด" value={money(displayCash)} />
      <Card label="ต้นทุนรวม" value={money(displayTotals.cost)} />
      <Card label="กำไร/ขาดทุน" value={money(displayTotals.gain)} tone={displayTotals.gain} />
      <Card label="% กำไร/ขาดทุน" value={pct(displayTotals.gainPct)} tone={displayTotals.gainPct} />
      <Card label="รวมเงินสด" value={money(grandTotal)} />
    </section>

    {state.lastUpdated && <p className="updated">อัปเดตล่าสุด {new Date(state.lastUpdated).toLocaleTimeString('th-TH')}</p>}

    {displayRows.length > 0 && <Pie rows={displayRows} total={displayTotals.value || displayTotals.cost} />}

    <section className="panel">
      <div className="panelHead"><h2>{isOverview ? 'หุ้นรวมทุกพอร์ต' : 'หุ้นในพอร์ต'}</h2>{!isOverview && <button className="primary" onClick={() => setShowAdd(true)}><Plus size={16}/>เพิ่มหุ้น</button>}</div>
      {displayRows.length === 0 ? <div className="empty">ยังไม่มีหุ้นในพอร์ต</div> : displayRows.map(r => <HoldingCard key={r.symbol} row={r} onEdit={() => !isOverview && setEditing(r)} onSim={(type) => setSim({ type, row: r })} readOnly={isOverview}/>) }
    </section>

    {!isOverview && <section className="panel compact"><div className="panelHead"><h2>จัดการพอร์ต</h2></div><div className="portfolioTools"><input value={active?.name || ''} onChange={(e)=>updatePortfolio(active.id, p=>({...p,name:e.target.value}))}/><input type="number" value={active?.cash || ''} placeholder="เงินสด USD" onChange={(e)=>updatePortfolio(active.id, p=>({...p,cash:num(e.target.value)}))}/><button className="danger" onClick={()=>deletePortfolio(active.id)}><Trash2 size={16}/>ลบพอร์ต</button></div></section>}

    {showAdd && <HoldingModal title="เพิ่มหุ้น" onClose={()=>setShowAdd(false)} onSave={addHolding}/>}    
    {editing && <HoldingModal title={`แก้ไข ${editing.symbol}`} row={editing.lots[0]} onClose={()=>setEditing(null)} onSave={(d)=>saveHolding(editing.lots[0].id,d)} onDelete={()=>deleteHolding(editing.lots[0].id)}/>}    
    {showSettings && <SettingsModal state={state} setState={setState} onClose={()=>setShowSettings(false)} exportBackup={exportBackup} importBackup={importBackup}/>}    
    {sim && <SimModal {...sim} portfolioValue={displayTotals.value || displayTotals.cost} onClose={()=>setSim(null)}/>}    
  </div>;
}

function groupRows(holdings, quotes) {
  const map = {};
  for (const h of holdings || []) {
    const sym = cleanSymbol(h.symbol);
    if (!map[sym]) map[sym] = { symbol: sym, shares: 0, cost: 0, lots: [], targetPct: h.targetPct ?? null };
    map[sym].shares += num(h.shares);
    map[sym].cost += num(h.shares) * num(h.costPerShare);
    map[sym].lots.push(h);
    if (h.targetPct != null) map[sym].targetPct = h.targetPct;
  }
  return Object.values(map).map((r) => {
    const avg = r.shares ? r.cost / r.shares : 0;
    const q = quotes[r.symbol] || {};
    const price = q.price ?? null;
    const value = price != null ? price * r.shares : null;
    const gain = value != null ? value - r.cost : null;
    return { ...r, avgCost: avg, price, value, gain, gainPct: r.cost ? gain / r.cost * 100 : null, dayChangePct: q.dayChangePct, notFound: q.notFound };
  }).sort((a,b)=>(b.value||b.cost)-(a.value||a.cost));
}
function calcTotals(rows) { const cost = rows.reduce((s,r)=>s+r.cost,0); const value = rows.every(r=>r.value!=null) && rows.length ? rows.reduce((s,r)=>s+r.value,0) : null; const gain = value!=null ? value-cost : null; return { cost, value, gain, gainPct: cost && gain!=null ? gain/cost*100 : null }; }
function Card({ label, value, tone, big }) { return <div className={big ? 'card big' : 'card'}><span>{label}</span><strong className={tone == null ? '' : tone >= 0 ? 'up' : 'down'}>{value}</strong></div>; }
function HoldingCard({ row, onEdit, onSim, readOnly }) { const base = row.value ?? row.cost; return <div className="holding"><div className="holdingTop"><div><b>{row.symbol}</b><small>{qty(row.shares)} หุ้น {row.notFound ? '· ไม่พบราคา' : ''}</small></div><div className="right"><strong>{money(base)}</strong><small className={row.gain == null ? '' : row.gain >= 0 ? 'up' : 'down'}>{money(row.gain)} · {pct(row.gainPct)}</small></div></div><div className="grid"><span>เฉลี่ย <b>{money(row.avgCost)}</b></span><span>ล่าสุด <b>{money(row.price)}</b></span><span>วันนี้ <b className={row.dayChangePct >= 0 ? 'up' : 'down'}>{pct(row.dayChangePct)}</b></span><span>เป้าหมาย <b>{row.targetPct ?? '—'}%</b></span></div>{!readOnly && <div className="rowActions"><button onClick={()=>onSim('buy')}><Calculator size={15}/>จำลองซื้อ</button><button onClick={()=>onSim('sell')}><TrendingDown size={15}/>จำลองขาย</button><button onClick={()=>onSim('forecast')}><Percent size={15}/>Forecast</button><button onClick={onEdit}>แก้ไข</button></div>}</div>; }
function HoldingModal({ title, row, onClose, onSave, onDelete }) { const [form,setForm]=useState({symbol:row?.symbol||'',shares:row?.shares||'',costPerShare:row?.costPerShare||'',targetPct:row?.targetPct??''}); return <Modal title={title} onClose={onClose}><label>Symbol<input value={form.symbol} onChange={e=>setForm({...form,symbol:e.target.value})}/></label><label>จำนวนหุ้น<input type="number" value={form.shares} onChange={e=>setForm({...form,shares:e.target.value})}/></label><label>ต้นทุนต่อหุ้น<input type="number" value={form.costPerShare} onChange={e=>setForm({...form,costPerShare:e.target.value})}/></label><label>เป้าหมาย %<input type="number" value={form.targetPct} onChange={e=>setForm({...form,targetPct:e.target.value})}/></label><div className="modalActions">{onDelete&&<button className="danger" onClick={onDelete}>ลบ</button>}<button onClick={onClose}>ยกเลิก</button><button className="primary" onClick={()=>onSave(form)}>บันทึก</button></div></Modal>; }
function SettingsModal({ state, setState, onClose, exportBackup, importBackup }) { const [key,setKey]=useState(state.apiKey||''); return <Modal title="ตั้งค่า" onClose={onClose}><label>Finnhub API Key<input value={key} onChange={e=>setKey(e.target.value)} placeholder="ใส่ API Key"/></label><p className="hint">ข้อมูลทั้งหมดเก็บในเครื่องผู้ใช้ด้วย localStorage คนอื่นที่เปิดลิงก์จะมีข้อมูลแยกกัน</p><div className="modalActions wrap"><button className="primary" onClick={()=>{setState({...state,apiKey:key.trim()});onClose();}}>บันทึก</button><button onClick={exportBackup}><Download size={15}/>Backup</button><label className="fileBtn"><Upload size={15}/>Restore<input type="file" accept="application/json" onChange={e=>e.target.files?.[0]&&importBackup(e.target.files[0])}/></label><button className="danger" onClick={()=>confirm('ล้างข้อมูลทั้งหมด?')&&setState(emptyState)}>ล้างข้อมูล</button></div></Modal>; }
function SimModal({ type, row, portfolioValue, onClose }) { const [price,setPrice]=useState(row.price||row.avgCost); const [amount,setAmount]=useState(type==='sell'?'1':'100'); let content=null; const p=num(price), a=num(amount); if(type==='buy'){ const added=a/p; const shares=row.shares+added; const cost=row.cost+a; content=<Result items={[['หุ้นเพิ่ม',qty(added)],['หุ้นรวม',qty(shares)],['ค่าเฉลี่ยใหม่',money(cost/shares)],['สัดส่วนใหม่',portfolioValue+a ? `${(((row.value??row.cost)+a)/(portfolioValue+a)*100).toFixed(2)}%`:'—']]}/> } if(type==='sell'){ const sold=Math.min(a,row.shares); const proceeds=sold*p; const costSold=sold*row.avgCost; content=<Result items={[['เงินที่ได้รับ',money(proceeds)],['กำไร/ขาดทุน',money(proceeds-costSold)],['หุ้นเหลือ',qty(row.shares-sold)],['สัดส่วนใหม่',portfolioValue-proceeds>0?`${(((row.value??row.cost)-proceeds)/(portfolioValue-proceeds)*100).toFixed(2)}%`:'0.00%']]}/> } if(type==='forecast'){ const newPrice=row.avgCost*(1+a/100); const value=newPrice*row.shares; content=<Result items={[['ราคาเป้าหมาย',money(newPrice)],['มูลค่า',money(value)],['กำไร/ขาดทุน',money(value-row.cost)],['สัดส่วนใหม่',portfolioValue?`${(value/portfolioValue*100).toFixed(2)}%`:'—']]}/> } return <Modal title={type==='buy'?'จำลองซื้อ':type==='sell'?'จำลองขาย':'Forecast'} onClose={onClose}><label>{type==='forecast'?'กำไร/ขาดทุน %':'ราคา'}<input type="number" value={price} onChange={e=>setPrice(e.target.value)} disabled={type==='forecast'}/></label><label>{type==='buy'?'ยอดซื้อ $':type==='sell'?'จำนวนหุ้นขาย':'เปอร์เซ็นต์'}<input type="number" value={amount} onChange={e=>setAmount(e.target.value)}/></label>{content}</Modal>; }
function Result({items}){return <div className="result">{items.map(([k,v])=><div key={k}><span>{k}</span><b>{v}</b></div>)}</div>}
function Modal({ title, children, onClose }) { return <div className="overlay" onClick={onClose}><div className="modal" onClick={e=>e.stopPropagation()}><div className="modalHead"><h3>{title}</h3><button onClick={onClose}>×</button></div>{children}</div></div>; }
function Pie({ rows, total }) { let acc=0; const colors=['#d4a24c','#8fb7c9','#b98fc9','#5fad7e','#d4685c','#7c93c9']; const gradient=rows.map((r,i)=>{const val=r.value??r.cost; const p=total?val/total*100:0; const s=`${colors[i%colors.length]} ${acc}% ${acc+p}%`; acc+=p; return s}).join(','); return <section className="piePanel"><div className="donut" style={{background:`conic-gradient(${gradient})`}}/><div className="legend">{rows.map((r,i)=><span key={r.symbol}><i style={{background:colors[i%colors.length]}}/> {r.symbol} {total?(((r.value??r.cost)/total)*100).toFixed(1):0}%</span>)}</div></section> }

createRoot(document.getElementById('root')).render(<App />);

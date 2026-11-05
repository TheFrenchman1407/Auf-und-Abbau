(() => {
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const ls = { get(k){ try{ return localStorage.getItem(k)||""; }catch(e){ return ""; } }, set(k,v){ try{ localStorage.setItem(k,v); }catch(e){} }, del(k){ try{ localStorage.removeItem(k); }catch(e){} } };
  const ROLE = { master:"Master", editor:"Bearbeiten", viewer:"Nur ansehen" };

  const S = { items:[], loans:[], reports:[], users:[], tab: ls.get("hi-tab") || "bestand", q:"", loaded:false, me:null, pendingUsers:0 };
  let TOKEN = ls.get("hi-token");
  const pending = {}; // id -> {qty, opened} Deltas, die noch gesendet werden
  const timers = {}; const writing = {};

  function toast(msg){ const t=$("#toast"); t.textContent=msg; t.classList.add("show"); clearTimeout(t._h); t._h=setTimeout(()=>t.classList.remove("show"),2400); }
  function setStatus(msg, bad){ const s=$("#status"); s.textContent=msg; s.classList.toggle("bad", !!bad); }
  const fmtDate = ts => { if(!ts) return ""; const d=new Date(ts); return d.toLocaleDateString("de-DE",{day:"2-digit",month:"2-digit"})+" "+d.toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit"}); };
  const canEdit = () => S.me && S.me.role !== "viewer";
  const isMaster = () => S.me && S.me.role === "master";

  // ---------- Anmelde-Bildschirm ----------
  function gate(kind, user){
    const g=$("#gate");
    if (!kind){ g.classList.remove("show"); g.innerHTML=""; return; }
    g.classList.add("show");
    if (kind==="register"){
      g.innerHTML=`<form class="gatebox" id="fReg">
        <h2>🏐 Hallen-Inventur</h2>
        <div class="meta">Einmal anmelden – dieses Gerät merkt sich das.</div>
        <input name="name" placeholder="Dein Name (oder z. B. „Hallen-Tablet“)" maxlength="40" required>
        <input name="code" type="password" placeholder="Freischaltcode" autocomplete="off" required>
        <button class="btn">Anmelden</button>
        <div class="meta" id="regErr" style="color:var(--bad)"></div>
      </form>`;
      $("#fReg").addEventListener("submit", async e=>{
        e.preventDefault(); const f=e.target;
        try {
          const r = await fetch("/api/register",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({name:f.name.value,code:f.code.value})});
          const d = await r.json();
          if (r.status===401){ $("#regErr").textContent="Falscher Freischaltcode."; return; }
          if (!r.ok){ $("#regErr").textContent="Anmeldung fehlgeschlagen."; return; }
          TOKEN=d.token; ls.set("hi-token",TOKEN);
          refresh();
        } catch(err){ $("#regErr").textContent="Keine Verbindung."; }
      });
    } else if (kind==="pending"){
      g.innerHTML=`<div class="gatebox" style="text-align:center">
        <h2>Fast geschafft, ${esc(user?.name||"")}!</h2>
        <div class="spinner"></div>
        <div>Deine Anmeldung muss noch vom Admin freigeschaltet werden.</div>
        <div class="meta">Diese Seite öffnet sich automatisch, sobald du freigeschaltet bist.</div>
        <button class="btn ghost small" id="regAgain">Mit anderem Namen anmelden</button>
      </div>`;
      $("#regAgain").onclick=()=>{ TOKEN=""; ls.del("hi-token"); gate("register"); };
    }
  }

  // ---------- API ----------
  async function api(path, body){
    if (!TOKEN){ gate("register"); throw {code:"auth"}; }
    let r;
    try { r = await fetch("/api"+path,{method:body?"POST":"GET",headers:{"content-type":"application/json","x-token":TOKEN},body:body?JSON.stringify(body):undefined,cache:"no-store"}); }
    catch(e){ throw {code:"offline"}; }
    let d={}; try{ d=await r.json(); }catch(e){}
    if (r.status===401){ TOKEN=""; ls.del("hi-token"); gate("register"); throw {code:"auth"}; }
    if (r.status===403 && d.error==="pending"){ gate("pending", d.user); throw {code:"pending"}; }
    if (r.status===403 && d.error==="readonly"){ throw {code:"readonly"}; }
    if (!r.ok) throw {code:"http"};
    return d;
  }
  const quiet = e => ["auth","pending"].includes(e.code);
  let refreshing=false;
  async function refresh(){
    if (refreshing) return; refreshing=true;
    try {
      const s=await api("/state");
      gate(null);
      Object.assign(S,{items:s.items,loans:s.loans,reports:s.reports,me:s.me,pendingUsers:s.pendingUsers||0,loaded:true});
      if (S.tab==="nutzer" && isMaster()) await loadUsers();
      setStatus("● Live – "+new Date().toLocaleTimeString("de-DE",{hour:"2-digit",minute:"2-digit",second:"2-digit"}));
      render();
    } catch(e){ if(!quiet(e)) setStatus("Keine Verbindung – versuche erneut…", true); }
    refreshing=false;
  }
  async function loadUsers(){ try{ const d=await api("/users"); S.users=d.users; }catch(e){} }
  async function write(fn, okMsg){
    try { await fn(); if (okMsg) toast(okMsg); await refresh(); return true; }
    catch(e){ if(e.code==="readonly") toast("Du hast nur Leserechte."); else if(!quiet(e)) toast(e.code==="offline"?"Keine Verbindung – nicht gespeichert":"Konnte nicht speichern"); return false; }
  }
  const save = (col, data, id) => api("/save",{col,id,data});
  const del = (col, id) => api("/delete",{col,id});

  // ---------- Berechnungen ----------
  const P = id => pending[id] || {qty:0, opened:0};
  const fullOf = it => Math.max(0,(Number(it.qty)||0)+P(it.id).qty);
  const openOf = it => it.halves ? Math.max(0,(Number(it.opened)||0)+P(it.id).opened) : 0;
  const openLoans = () => S.loans.filter(l=>!l.returnedAt);
  const openReps = () => S.reports.filter(r=>r.status!=="erledigt");
  const lentOf = id => openLoans().filter(l=>l.itemId===id).reduce((a,l)=>a+(Number(l.qty)||0),0);
  // angebrochene zählen als halbe
  const stockOf = it => fullOf(it) + openOf(it)*0.5 - lentOf(it.id);
  const isLow = it => (Number(it.minQty)||0) > 0 && stockOf(it) <= Number(it.minQty);
  const isEmpty = it => (Number(it.minQty)||0) > 0 && stockOf(it) <= 0;
  const itemById = id => S.items.find(i=>i.id===id);
  const fmtStock = it => { const f=fullOf(it), o=openOf(it); return o ? `${f} voll + ${o} angebrochen` : `${f}`; };
  const half = n => { const w=Math.floor(n); return (n-w)>=0.5 ? (w? w+"½" : "½") : String(w); };

  // ---------- Darstellung ----------
  function render(){
    document.body.classList.toggle("ro", !canEdit());
    if (S.me){ $("#meBtn").textContent="👤 "+S.me.name; }
    $("#tabNutzer").style.display = isMaster() ? "" : "none";
    if (S.tab==="nutzer" && !isMaster()) S.tab="bestand";
    document.querySelectorAll("#tabs button").forEach(b=>b.classList.toggle("on", b.dataset.tab===S.tab));
    const low=S.items.filter(isLow), ol=openLoans().length, or=openReps().length;
    const bl=$("#b-low"); bl.textContent=low.length; bl.className="badge"+(low.some(isEmpty)?" bad":low.length?" warn":"");
    $("#b-loan").textContent=ol;
    const bd=$("#b-def"); bd.textContent=or; bd.className="badge"+(or?" bad":"");
    const bu=$("#b-usr"); bu.textContent=S.pendingUsers; bu.className="badge"+(S.pendingUsers?" warn":"");
    $("#cats").innerHTML=[...new Set(S.items.map(i=>i.category).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join("");
    $("#locs").innerHTML=[...new Set(S.items.map(i=>i.location).filter(Boolean))].map(c=>`<option value="${esc(c)}">`).join("");

    const a=document.activeElement, sf=a&&a.id==="search", pos=sf?a.selectionStart:0;
    const views={bestand:viewBestand,nachkauf:viewNachkauf,ausleihe:viewAusleihe,defekte:viewDefekte,nutzer:viewNutzer};
    $("#main").innerHTML=(views[S.tab]||viewBestand)();
    if (sf){ const s=$("#search"); if(s){ s.focus(); try{s.setSelectionRange(pos,pos);}catch(e){} } }
  }

  function counter(label, id, field, val){
    return `<div class="counter"><div class="lbl">${label}</div><div class="qty">
      <button class="qbtn edit-only" data-dq="-1" data-f="${field}" data-id="${esc(id)}" aria-label="weniger">−</button>
      <div class="qnum">${val}</div>
      <button class="qbtn edit-only" data-dq="1" data-f="${field}" data-id="${esc(id)}" aria-label="mehr">+</button></div></div>`;
  }

  function itemCard(it){
    const lent=lentOf(it.id), reps=openReps().filter(r=>r.itemId===it.id).length, o=openOf(it);
    const pills=[];
    if (isEmpty(it)) pills.push(`<span class="pill bad">Leer – nachkaufen!</span>`);
    else if (isLow(it)) pills.push(`<span class="pill warn">Nachkaufen (Mindestmenge ${esc(it.minQty)})</span>`);
    if (o) pills.push(`<span class="pill info">${o} angebrochen</span>`);
    if (lent) pills.push(`<span class="pill info">${lent} ausgeliehen</span>`);
    if (reps) pills.push(`<span class="pill bad">${reps} Defekt-Meldung${reps>1?"en":""}</span>`);
    return `<div class="item ${isEmpty(it)?"empty0":isLow(it)?"low":""}">
      <div class="row"><div class="name">${esc(it.name)}</div><button class="btn ghost small edit-only" data-edit="${esc(it.id)}" aria-label="bearbeiten">✎</button></div>
      <div class="meta">${esc(it.location||"kein Ort")}${Number(it.minQty)>0?" · Mindestmenge "+esc(it.minQty):""}${it.note?" · "+esc(it.note):""}</div>
      ${pills.length?`<div class="row" style="flex-wrap:wrap;gap:6px">${pills.join("")}</div>`:""}
      <div class="counters">
        ${counter(it.halves?"Voll":"Bestand", it.id, "qty", fullOf(it))}
        ${it.halves?counter("Angebrochen", it.id, "opened", o):""}
      </div>
      <div class="row edit-only" style="flex-wrap:wrap">
        ${it.halves?`<button class="btn ghost small" data-openone="${esc(it.id)}" ${fullOf(it)<1?"disabled":""}>Kiste anbrechen</button>`:""}
        <div class="actions">
          <button class="btn ghost small" data-loan="${esc(it.id)}">Ausleihen</button>
          <button class="btn ghost small" data-rep="${esc(it.id)}" aria-label="Defekt melden">⚠︎ Defekt</button>
        </div>
      </div>
      ${it.updatedAt?`<div class="meta" style="font-size:12px">zuletzt ${fmtDate(it.updatedAt)}${it.updatedBy?" · "+esc(it.updatedBy):""}</div>`:""}
    </div>`;
  }

  function lowAlert(){
    const low=S.items.filter(isLow); if (!low.length) return "";
    const empty=low.filter(isEmpty).length;
    return `<div class="alert ${empty?"bad":""}" data-goto="nachkauf">⚠︎ ${low.length} Artikel nachkaufen${empty?` (${empty} leer)`:""} – antippen für die Liste</div>`;
  }

  function viewBestand(){
    const q=S.q.trim().toLowerCase();
    const items=S.items.filter(i=>!q || [i.name,i.category,i.location,i.note].join(" ").toLowerCase().includes(q));
    let html=lowAlert()+`<div class="toolbar">
      <input class="search" id="search" type="search" placeholder="Suchen…" value="${esc(S.q)}">
      <button class="btn edit-only" id="addItem">+ Artikel</button></div>`;
    if (!S.loaded) return html+`<div class="empty">Lade Bestand…</div>`;
    if (!S.items.length) return html+`<div class="empty">Noch keine Artikel.</div>`;
    if (!items.length) return html+`<div class="empty">Nichts gefunden für „${esc(S.q)}“.</div>`;
    const groups={};
    items.forEach(i=>{ const c=i.category||"Sonstiges"; (groups[c]=groups[c]||[]).push(i); });
    Object.keys(groups).sort((a,b)=>a.localeCompare(b,"de")).forEach(c=>{
      html+=`<div class="cat">${esc(c)}</div><div class="grid">${groups[c].sort((a,b)=>String(a.name).localeCompare(String(b.name),"de")).map(itemCard).join("")}</div>`;
    });
    return html;
  }

  function viewNachkauf(){
    const low=S.items.filter(isLow).sort((a,b)=>stockOf(a)-stockOf(b));
    const noMin=S.items.filter(i=>!(Number(i.minQty)>0)).length;
    let html="";
    if (!low.length) html+=`<div class="empty">✅ Alles über der Mindestmenge. Nichts nachzukaufen.</div>`;
    else html+=`<div class="list">`+low.map(it=>{
      const s=stockOf(it), e=isEmpty(it);
      return `<div class="line ${e?"bad":"warn"}"><div class="grow"><b>${esc(it.name)}</b>
        <div>${e?"<b style='color:var(--bad)'>Leer!</b> Bitte nachkaufen.":`Nur noch <b>${half(s)}</b> da – bitte nachkaufen.`}</div>
        <div class="meta">${esc(fmtStock(it))}${lentOf(it.id)?` · ${lentOf(it.id)} ausgeliehen`:""} · Mindestmenge ${esc(it.minQty)}</div></div>
        <button class="btn ghost small edit-only" data-edit="${esc(it.id)}">Bestand anpassen</button></div>`;
    }).join("")+`</div><div style="margin-top:14px"><button class="btn ghost" id="copyList">Einkaufsliste kopieren</button></div>`;
    if (noMin) html+=`<div class="meta" style="margin-top:16px">${noMin} Artikel haben noch keine Mindestmenge und lösen deshalb nie eine Warnung aus. Einstellen über ✎ beim Artikel.</div>`;
    return html;
  }

  function viewAusleihe(){
    const open=openLoans().sort((a,b)=>(b.outAt||0)-(a.outAt||0));
    const done=S.loans.filter(l=>l.returnedAt).sort((a,b)=>(b.returnedAt||0)-(a.returnedAt||0)).slice(0,15);
    let html=`<div class="toolbar edit-only"><button class="btn" data-loan="">+ Ausleihe eintragen</button></div>`;
    html+= open.length ? `<div class="list">`+open.map(l=>`<div class="line"><div class="grow"><b>${esc(l.qty)}× ${esc(l.itemName)}</b>
      <div class="meta">bei <b>${esc(l.borrower)}</b> · seit ${fmtDate(l.outAt)}${l.note?" · "+esc(l.note):""}${l.by?" · eingetragen von "+esc(l.by):""}</div></div>
      <button class="btn small edit-only" data-ret="${esc(l.id)}">Zurückgebracht</button></div>`).join("")+`</div>`
      : `<div class="empty">Gerade ist nichts ausgeliehen.</div>`;
    if (done.length) html+=`<div class="cat">Zuletzt zurück</div><div class="list">`+done.map(l=>`<div class="line"><div class="grow">${esc(l.qty)}× ${esc(l.itemName)} <span class="meta">· ${esc(l.borrower)} · zurück ${fmtDate(l.returnedAt)}</span></div>
      <button class="btn ghost small edit-only" data-delloan="${esc(l.id)}">Entfernen</button></div>`).join("")+`</div>`;
    return html;
  }

  function viewDefekte(){
    const open=openReps().sort((a,b)=>(b.at||0)-(a.at||0));
    const done=S.reports.filter(r=>r.status==="erledigt").sort((a,b)=>(b.doneAt||0)-(a.doneAt||0)).slice(0,15);
    let html=`<div class="toolbar edit-only"><button class="btn" data-rep="">+ Defekt melden</button></div>`;
    html+= open.length ? `<div class="list">`+open.map(r=>`<div class="line bad"><div class="grow"><b>${esc(r.itemName)}</b> <span class="pill bad">${esc(r.qty||1)} Stk.</span>
      <div>${esc(r.text)}</div><div class="meta">${fmtDate(r.at)}${r.by?" · "+esc(r.by):""}${r.deducted?" · aus Bestand abgezogen":""}</div></div>
      <button class="btn small edit-only" data-done="${esc(r.id)}">Erledigt</button></div>`).join("")+`</div>`
      : `<div class="empty">Keine offenen Defekte. 👍</div>`;
    if (done.length) html+=`<div class="cat">Erledigt</div><div class="list">`+done.map(r=>`<div class="line"><div class="grow">${esc(r.itemName)}: ${esc(r.text)} <span class="meta">· erledigt ${fmtDate(r.doneAt)}</span></div>
      <button class="btn ghost small edit-only" data-delrep="${esc(r.id)}">Entfernen</button></div>`).join("")+`</div>`;
    return html;
  }

  function viewNutzer(){
    const us=S.users.slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const pend=us.filter(u=>u.status==="pending"), act=us.filter(u=>u.status==="active"), blk=us.filter(u=>u.status==="blocked");
    const roleSel = u => `<select data-role="${esc(u.id)}" style="min-height:38px">${["editor","viewer","master"].map(r=>`<option value="${r}" ${u.role===r?"selected":""}>${ROLE[r]}</option>`).join("")}</select>`;
    let html=`<div class="meta" style="margin-bottom:14px">Hier siehst du jedes Gerät, das sich angemeldet hat. <b>Bearbeiten</b> = darf Bestand ändern (z. B. Hallen-Tablet), <b>Nur ansehen</b> = sieht alles, ändert nichts (z. B. Präsi).</div>`;
    html+=`<div class="cat">Wartet auf Freischaltung (${pend.length})</div>`;
    html+= pend.length ? `<div class="list">`+pend.map(u=>`<div class="line warn"><div class="grow"><b>${esc(u.name)}</b><div class="meta">angemeldet ${fmtDate(u.createdAt)}</div></div>
      <button class="btn small" data-approve="${esc(u.id)}" data-r="editor">Freischalten: Bearbeiten</button>
      <button class="btn ghost small" data-approve="${esc(u.id)}" data-r="viewer">Freischalten: Nur ansehen</button>
      <button class="btn ghost small" data-urm="${esc(u.id)}">Ablehnen</button></div>`).join("")+`</div>`
      : `<div class="empty" style="padding:18px">Niemand wartet.</div>`;
    html+=`<div class="cat">Aktiv (${act.length})</div><div class="list">`+act.map(u=>{
      return `<div class="line"><div class="grow"><b>${esc(u.name)}</b> ${u.role==="master"?`<span class="role master">Master</span>`:""}
        <div class="meta">seit ${fmtDate(u.createdAt)} · zuletzt aktiv ${fmtDate(u.lastSeen)}</div></div>
        ${u.id===S.me?.id?`<span class="meta">Das bist du</span>`:`${roleSel(u)}
        <button class="btn ghost small" data-block="${esc(u.id)}">Sperren</button>`}</div>`;
    }).join("")+`</div>`;
    if (blk.length) html+=`<div class="cat">Gesperrt (${blk.length})</div><div class="list">`+blk.map(u=>`<div class="line bad"><div class="grow"><b>${esc(u.name)}</b><div class="meta">${ROLE[u.role]||""}</div></div>
      <button class="btn ghost small" data-unblock="${esc(u.id)}">Entsperren</button>
      <button class="btn ghost small" data-urm="${esc(u.id)}">Entfernen</button></div>`).join("")+`</div>`;
    return html;
  }

  // ---------- Mengen (+/−) gesammelt senden ----------
  function bump(id, field, d){
    const it=itemById(id); if(!it) return;
    const cur = field==="opened" ? openOf(it) : fullOf(it);
    if (cur+d<0) return;
    pending[id]=pending[id]||{qty:0,opened:0}; pending[id][field]+=d;
    render();
    clearTimeout(timers[id]); timers[id]=setTimeout(()=>flush(id),700);
  }
  async function flush(id){
    const p=pending[id]; if(!p) return;
    if (writing[id]){ timers[id]=setTimeout(()=>flush(id),400); return; }
    writing[id]=true;
    const send={...p};
    try {
      let r;
      if (send.qty) r=await api("/qty",{id,field:"qty",delta:send.qty});
      if (send.opened) r=await api("/qty",{id,field:"opened",delta:send.opened});
      pending[id].qty-=send.qty; pending[id].opened-=send.opened;
      if (!pending[id].qty && !pending[id].opened) delete pending[id];
      const it=itemById(id); if (it && r){ it.qty=r.qty; it.opened=r.opened; it.updatedAt=Date.now(); it.updatedBy=S.me?.name; }
    } catch(e){ delete pending[id]; if(e.code==="readonly") toast("Du hast nur Leserechte."); else if(!quiet(e)) toast("Menge nicht gespeichert – keine Verbindung"); }
    writing[id]=false; render();
  }

  // ---------- Dialoge ----------
  let editId=null;
  function syncHalves(){ $("#openedWrap").style.display = $("#fItem").halves.checked ? "" : "none"; }
  $("#fItem").halves.addEventListener("change", syncHalves);
  function openItem(id){
    editId=id||null; const f=$("#fItem"); f.reset();
    const it=id?itemById(id):null;
    $("#dItemTitle").textContent=it?"Artikel bearbeiten":"Neuer Artikel";
    $("#delItem").style.display=it?"":"none";
    if (it){ f.name.value=it.name||""; f.category.value=it.category||""; f.location.value=it.location||""; f.halves.checked=!!it.halves;
      f.qty.value=fullOf(it); f.opened.value=openOf(it); f.minQty.value=it.minQty||0; f.note.value=it.note||""; }
    syncHalves(); $("#dItem").showModal();
  }
  $("#fItem").addEventListener("submit", async e=>{
    e.preventDefault(); const f=e.target;
    const body={ name:f.name.value.trim(), category:f.category.value.trim(), location:f.location.value.trim(), halves:f.halves.checked,
      qty:Math.max(0,parseInt(f.qty.value)||0), opened:f.halves.checked?Math.max(0,parseInt(f.opened.value)||0):0,
      minQty:Math.max(0,parseInt(f.minQty.value)||0), note:f.note.value.trim(), updatedAt:Date.now() };
    if(!body.name) return;
    $("#dItem").close();
    if (editId){ delete pending[editId]; await write(()=>save("items",body,editId),"Gespeichert"); }
    else await write(()=>save("items",body),"Artikel angelegt");
  });
  $("#delItem").addEventListener("click", ()=>{
    const it=itemById(editId); if(!it) return; $("#dItem").close();
    ask("Artikel löschen?", `„${it.name}“ wird für alle entfernt.`, ()=>write(()=>del("items",it.id),"Gelöscht"));
  });

  function fillSelect(sel, id){ sel.innerHTML=S.items.slice().sort((a,b)=>String(a.name).localeCompare(String(b.name),"de")).map(i=>`<option value="${esc(i.id)}" ${i.id===id?"selected":""}>${esc(i.name)}</option>`).join(""); }
  function openLoan(id){ if(!S.items.length) return toast("Erst Artikel anlegen"); $("#fLoan").reset(); fillSelect($("#loanItem"),id); $("#dLoan").showModal(); }
  $("#fLoan").addEventListener("submit", async e=>{
    e.preventDefault(); const f=e.target; const it=itemById(f.itemId.value); if(!it) return;
    const qty=Math.max(1,parseInt(f.qty.value)||1);
    if (qty>fullOf(it)-lentOf(it.id)) return toast(`Nur ${Math.max(0,fullOf(it)-lentOf(it.id))} verfügbar`);
    $("#dLoan").close();
    await write(()=>save("loans",{itemId:it.id,itemName:it.name,qty,borrower:f.borrower.value.trim(),note:f.note.value.trim(),outAt:Date.now(),returnedAt:null}),"Ausleihe eingetragen");
  });
  function openRep(id){ if(!S.items.length) return toast("Erst Artikel anlegen"); $("#fRep").reset(); fillSelect($("#repItem"),id); $("#dRep").showModal(); }
  $("#fRep").addEventListener("submit", async e=>{
    e.preventDefault(); const f=e.target; const it=itemById(f.itemId.value); if(!it) return;
    const qty=Math.max(1,parseInt(f.qty.value)||1), deduct=f.deduct.checked;
    $("#dRep").close();
    await write(async()=>{
      await save("reports",{itemId:it.id,itemName:it.name,text:f.text.value.trim(),qty,deducted:deduct,status:"offen",at:Date.now()});
      if (deduct) await api("/qty",{id:it.id,field:"qty",delta:-qty});
    },"Defekt gemeldet");
  });

  let askFn=null;
  function ask(title,text,fn){ $("#askTitle").textContent=title; $("#askText").textContent=text; askFn=fn; $("#dAsk").showModal(); }
  $("#askNo").onclick=()=>$("#dAsk").close();
  $("#askYes").onclick=()=>{ $("#dAsk").close(); if(askFn) askFn(); };
  document.querySelectorAll("[data-close]").forEach(b=>b.addEventListener("click",()=>b.closest("dialog").close()));

  $("#meBtn").addEventListener("click", ()=>{ if(!S.me) return; $("#meName").textContent=S.me.name; $("#meRole").textContent="Rolle: "+(ROLE[S.me.role]||S.me.role); $("#dMe").showModal(); });
  $("#logout").addEventListener("click", ()=>{ $("#dMe").close(); ask("Gerät abmelden?","Danach muss sich dieses Gerät neu anmelden und (außer mit Master-Code) wieder freigeschaltet werden.",()=>{ TOKEN=""; ls.del("hi-token"); S.me=null; gate("register"); }); });

  const userOp = (body,msg) => write(async()=>{ await api("/user",body); await loadUsers(); }, msg);

  // ---------- Events ----------
  $("#tabs").addEventListener("click", async e=>{ const b=e.target.closest("button"); if(!b) return; S.tab=b.dataset.tab; ls.set("hi-tab",S.tab); render(); if(S.tab==="nutzer"){ await loadUsers(); render(); } });
  $("#main").addEventListener("input", e=>{ if(e.target.id==="search"){ S.q=e.target.value; render(); } });
  $("#main").addEventListener("change", e=>{ const s=e.target.closest("[data-role]"); if(s) userOp({id:s.dataset.role,role:s.value},"Rolle geändert"); });
  $("#main").addEventListener("click", e=>{
    const t=e.target.closest("button,[data-goto]"); if(!t || t.disabled) return;
    const d=t.dataset;
    if (d.goto){ S.tab=d.goto; ls.set("hi-tab",S.tab); render(); window.scrollTo({top:0}); return; }
    if (t.id==="addItem") return openItem();
    if (t.id==="copyList"){
      const txt="Einkaufsliste Halle:\n"+S.items.filter(isLow).map(i=>`- ${i.name} (noch ${half(stockOf(i))}, Mindestmenge ${i.minQty})`).join("\n");
      navigator.clipboard.writeText(txt).then(()=>toast("Kopiert"),()=>toast("Kopieren nicht möglich")); return;
    }
    if (d.dq) return bump(d.id, d.f, Number(d.dq));
    if (d.openone) return write(()=>api("/qty",{id:d.openone,field:"open"}),"Kiste angebrochen");
    if (d.edit!==undefined) return openItem(d.edit);
    if (d.loan!==undefined) return openLoan(d.loan);
    if (d.rep!==undefined) return openRep(d.rep);
    if (d.ret) return write(()=>save("loans",{returnedAt:Date.now()},d.ret),"Zurückgebucht");
    if (d.done) return write(()=>save("reports",{status:"erledigt",doneAt:Date.now()},d.done),"Erledigt");
    if (d.delloan) return write(()=>del("loans",d.delloan));
    if (d.delrep) return write(()=>del("reports",d.delrep));
    if (d.approve) return userOp({id:d.approve,status:"active",role:d.r},"Freigeschaltet");
    if (d.block) return ask("Gerät sperren?","Es kann die App dann nicht mehr öffnen.",()=>userOp({id:d.block,status:"blocked"},"Gesperrt"));
    if (d.unblock) return userOp({id:d.unblock,status:"active"},"Entsperrt");
    if (d.urm) return ask("Anmeldung entfernen?","Das Gerät muss sich danach neu anmelden.",()=>userOp({id:d.urm,remove:true},"Entfernt"));
  });

  // ---------- Start ----------
  if (!TOKEN) gate("register");
  render(); refresh();
  setInterval(()=>{ if(!document.hidden && !document.querySelector("dialog[open]") && document.activeElement?.tagName!=="SELECT") refresh(); }, 5000);
  document.addEventListener("visibilitychange", ()=>{ if(!document.hidden) refresh(); });
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(()=>{});
})();

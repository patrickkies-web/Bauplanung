"use strict";
const VERSION='1.2';
const CATS={
  arbeit:{label:'Arbeit',color:'#FF9500'},
  absprache:{label:'Absprache',color:'#007AFF'},
  planung:{label:'Planung',color:'#AF52DE'},
  termin:{label:'Termin',color:'#34C759'},
  todo:{label:'To-do',color:'#5AC8FA'},
};
const PRIOS={hoch:{label:'Hohe Priorität',color:'#FF3B30'},mittel:{label:'Mittlere Priorität',color:'#FF9F0A'},niedrig:{label:'Niedrige Priorität',color:'#8E8E93'}};
const ICONS={
  arbeit:'<path d="M4 20l7.2-7.2"/><path d="M12.6 8.4l2.8-2.8 1.3 1.3 2.6-2.6 2 2-2.6 2.6 1.3 1.3-2.8 2.8z"/>',
  absprache:'<path d="M5 5.2h14a1.4 1.4 0 0 1 1.4 1.4v7.2A1.4 1.4 0 0 1 19 15.2h-8.2L6.4 18.6v-3.4H5a1.4 1.4 0 0 1-1.4-1.4V6.6A1.4 1.4 0 0 1 5 5.2z"/>',
  planung:'<path d="M5 19l1.1-4L16 5.1 18.9 8 9 17.9z"/><path d="M14.2 6.9l2.9 2.9"/>',
  termin:'<rect x="4" y="5" width="16" height="15" rx="3"/><path d="M4 9.6h16M8.4 3v3.6M15.6 3v3.6"/>',
  todo:'<path d="M5 12.4l4.2 4.2L19 6.8"/>',
};
function catIcon(cat){return '<span class="cat-badge" style="background:'+CATS[cat].color+'"><svg viewBox="0 0 24 24">'+ICONS[cat]+'</svg></span>';}
const UI={
  grip:'<svg class="svgi" viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="9" cy="6" r="1.45"/><circle cx="15" cy="6" r="1.45"/><circle cx="9" cy="12" r="1.45"/><circle cx="15" cy="12" r="1.45"/><circle cx="9" cy="18" r="1.45"/><circle cx="15" cy="18" r="1.45"/></svg>',
  trash:'<svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14M10 7V5.5h4V7M7.2 7l.9 12.3h7.8L16.8 7"/></svg>',
  download:'<svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 20h14"/></svg>',
  close:'<svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M7 7l10 10M17 7L7 17"/></svg>',
  paperclip:'<svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M19.5 11.5l-7.8 7.8a4.2 4.2 0 0 1-6-6L13 5a2.8 2.8 0 0 1 4 4l-7.4 7.4a1.4 1.4 0 0 1-2-2L14.6 8"/></svg>',
};

const STATE_KEY='sanierung:state:v1';
const FILE_PREFIX='sanierung:file:';
const MAX_FILE=4*1024*1024;
const DRAG_THRESH=9;
const UID_KEY='bauplanung:uid';
const NAME_KEY='bauplanung:name';

let state={tasks:[]};
let openMap={};
let currentView='timeline';
let fileCache={};
let changelog=[];
let db=null;
let lastSavedValue=null;
let syncActive=false;

const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const $=s=>document.querySelector(s);
const $$=s=>[...document.querySelectorAll(s)];

/* ===== USER IDENTITY ===== */
function getUserId(){
  let id=localStorage.getItem(UID_KEY);
  if(!id){id=uid();localStorage.setItem(UID_KEY,id);}
  return id;
}
function getUserName(){return localStorage.getItem(NAME_KEY)||'';}
const currentUserId=getUserId();

/* ===== FIREBASE + STORAGE ===== */
function initFirebase(){
  try{
    if(typeof firebase==='undefined'||!firebaseConfig||!firebaseConfig.projectId)return;
    if(!firebase.apps.length)firebase.initializeApp(firebaseConfig);
    db=firebase.firestore();
    syncActive=true;
    updateSyncDot();
    setupRealTimeSync();
  }catch(e){
    db=null;syncActive=false;
  }
}

function updateSyncDot(){
  const dot=$('#syncDot');
  if(dot)dot.classList.toggle('on',syncActive);
}

function setupRealTimeSync(){
  if(!db)return;
  const stateKey=STATE_KEY.replace(/[:/]/g,'_');
  db.collection('data').doc(stateKey).onSnapshot(snap=>{
    if(!snap.exists)return;
    const val=snap.data().value;
    if(val===lastSavedValue)return;
    try{
      const newState=JSON.parse(val);
      state=newState;
      walk(state.tasks,t=>{if(openMap[t.id]===undefined)openMap[t.id]=true;});
      renderAll();
    }catch(e){}
  });
  db.collection('changelog').orderBy('ts','desc').limit(100).onSnapshot(snap=>{
    changelog=snap.docs.map(d=>({id:d.id,...d.data()}));
    if(currentView==='protokoll')renderProtocol();
  });
}

async function sGet(k){
  const key=k.replace(/[:/]/g,'_');
  if(db){
    try{const s=await db.collection('data').doc(key).get();return s.exists?s.data().value:null;}catch(e){}
  }
  try{return localStorage.getItem(k);}catch(e){return null;}
}
async function sSet(k,v){
  const key=k.replace(/[:/]/g,'_');
  if(db){
    try{await db.collection('data').doc(key).set({value:v});localStorage.setItem(k,v);return true;}catch(e){}
  }
  try{localStorage.setItem(k,v);return true;}catch(e){return false;}
}
async function sDel(k){
  const key=k.replace(/[:/]/g,'_');
  if(db){try{await db.collection('data').doc(key).delete();}catch(e){}}
  try{localStorage.removeItem(k);}catch(e){}
}

/* ===== CHANGELOG ===== */
const LOG_ACTIONS={
  ERSTELLT:{label:'Erstellt',color:'#34C759'},
  BEARBEITET:{label:'Bearbeitet',color:'#007AFF'},
  ERLEDIGT:{label:'Erledigt',color:'#5AC8FA'},
  GEOEFFNET:{label:'Wieder geöffnet',color:'#FF9500'},
  GELOESCHT:{label:'Gelöscht',color:'#FF3B30'},
  VERSCHOBEN:{label:'Verschoben',color:'#AF52DE'},
  EINGEORDNET:{label:'Eingeordnet',color:'#007AFF'},
  GELOEST:{label:'Aus Gruppe gelöst',color:'#8E8E93'},
};

function logChange(action,taskTitle,details={}){
  if(!db)return;
  const name=getUserName();
  db.collection('changelog').add({
    action,
    taskTitle:taskTitle||'Unbekannt',
    userId:currentUserId,
    userName:name,
    ts:firebase.firestore.FieldValue.serverTimestamp(),
    ...details,
  }).catch(()=>{});
}

function fmtAgo(date){
  if(!date)return '';
  const sec=Math.round((Date.now()-date.getTime())/1000);
  if(sec<60)return 'gerade eben';
  if(sec<3600)return Math.floor(sec/60)+'m';
  if(sec<86400)return Math.floor(sec/3600)+'h';
  return Math.floor(sec/86400)+'T';
}

/* ===== SAVE ===== */
let saveTimer=null;
function scheduleSave(){
  const ind=$('#saveInd');if(ind){ind.textContent='sichern…';ind.classList.add('show');}
  clearTimeout(saveTimer);
  saveTimer=setTimeout(async()=>{
    const value=JSON.stringify(state);
    lastSavedValue=value;
    await sSet(STATE_KEY,value);
    if(ind){ind.textContent='gespeichert';setTimeout(()=>ind.classList.remove('show'),900);}
  },420);
}

/* ===== DATE UTILS ===== */
const MS=86400000;
const today=()=>{const d=new Date();d.setHours(0,0,0,0);return d;};
function parseD(s){if(!s)return null;const d=new Date(s+'T00:00:00');return isNaN(d)?null:d;}
function isoD(d){return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');}
function dayDiff(a,b){return Math.round((a-b)/MS);}
const MON=['Jan','Feb','März','Apr','Mai','Juni','Juli','Aug','Sep','Okt','Nov','Dez'];
const MONS=['Jan','Feb','Mär','Apr','Mai','Jun','Jul','Aug','Sep','Okt','Nov','Dez'];
function fmtShort(d){return d.getDate()+'. '+MONS[d.getMonth()];}
function fmtLong(d){return d.getDate()+'. '+MON[d.getMonth()]+' '+d.getFullYear();}
function fmtSize(b){if(b<1024)return b+' B';if(b<1048576)return (b/1024).toFixed(0)+' KB';return (b/1048576).toFixed(1)+' MB';}

/* ===== TASK HELPERS ===== */
function newTask(cat){return {id:uid(),title:'',cat:cat||'todo',prio:'mittel',done:false,start:'',end:'',notes:'',contacts:'',cost:'',files:[],checklist:[],journal:[],children:[]};}
function walk(list,fn,parent=null){list.forEach((t,i)=>{fn(t,parent,i);walk(t.children,fn,t);});}
function findTask(id,list=state.tasks,parent=null){for(const t of list){if(t.id===id)return{task:t,parent,list};const r=findTask(id,t.children,t);if(r)return r;}return null;}
function pathTo(id,list=state.tasks,acc=[]){for(const t of list){if(t.id===id)return[...acc,t];const r=pathTo(id,t.children,[...acc,t]);if(r)return r;}return null;}
function countOpen(){let n=0;walk(state.tasks,t=>{if(!t.done)n++;});return n;}

/* ===== INIT ===== */
async function init(){
  document.title='Bauleiter v'+VERSION;
  initFirebase();
  const raw=await sGet(STATE_KEY);
  if(raw){try{state=JSON.parse(raw);}catch(e){state={tasks:[]};}}
  if(!state.tasks||!state.tasks.length){state=seed();await sSet(STATE_KEY,JSON.stringify(state));}
  walk(state.tasks,t=>{if(openMap[t.id]===undefined)openMap[t.id]=true;});
  setupLogoSecret();
  renderAll();
  setTimeout(scrollToToday,80);
}

function seed(){
  const t=today();const d=n=>isoD(new Date(t.getTime()+n*MS));
  return {tasks:[
    {...newTask('planung'),id:uid(),title:'Bestandsaufnahme & Aufmaß',prio:'hoch',done:true,start:d(-24),end:d(-18),notes:'Alle Räume vermessen, Schäden dokumentiert.',children:[
      {...newTask('absprache'),id:uid(),title:'Architekt kontaktieren',done:true,start:d(-22),prio:'hoch'},
    ]},
    {...newTask('planung'),id:uid(),title:'Kostenplanung & Budget',prio:'hoch',start:d(-4),end:d(3),notes:'Puffer von 15% einplanen.',contacts:'Bank – Finanzierungszusage',children:[
      {...newTask('todo'),id:uid(),title:'Angebote vergleichen',prio:'hoch',start:d(-2)},
    ]},
    {...newTask('termin'),id:uid(),title:'Statiker vor Ort',prio:'mittel',start:d(6)},
    {...newTask('arbeit'),id:uid(),title:'Entkernung & Abbruch',prio:'hoch',start:d(10),end:d(22),children:[
      {...newTask('absprache'),id:uid(),title:'Container bestellen',prio:'mittel',start:d(8)},
    ]},
    {...newTask('arbeit'),id:uid(),title:'Elektrik & Sanitär (Rohbau)',prio:'hoch',start:d(24),end:d(42)},
    {...newTask('todo'),id:uid(),title:'KfW-Förderung prüfen',prio:'mittel',start:''},
    {...newTask('todo'),id:uid(),title:'Fliesen aussuchen',prio:'niedrig',start:''},
  ]};
}

/* ===== RENDER ALL ===== */
function renderAll(){
  const open=countOpen();
  const bdg=$('#todoBadge');if(open>0){bdg.style.display='flex';bdg.textContent=open>99?'99+':open;}else bdg.style.display='none';
  if(currentView==='timeline')renderTimeline();
  if(currentView==='tree')renderTree();
  if(currentView==='todo')renderTodo();
  if(currentView==='protokoll')renderProtocol();
}

/* ===== PROTOKOLL (HIDDEN) ===== */
let logoTapCount=0,logoTapTimer=null;

function setupLogoSecret(){
  $('#brandMark').addEventListener('click',()=>{
    logoTapCount++;
    clearTimeout(logoTapTimer);
    logoTapTimer=setTimeout(()=>{logoTapCount=0;},1500);
    if(logoTapCount>=5){
      logoTapCount=0;
      toggleProtokoll();
    }
  });
}

function toggleProtokoll(){
  const tab=$('#tabProtokoll');
  if(!tab)return;
  const isVisible=tab.style.display!=='none';
  if(isVisible&&currentView==='protokoll'){
    tab.style.display='none';
    switchView('timeline');
    toast('Protokoll ausgeblendet');
  }else{
    tab.style.display='';
    switchView('protokoll');
    toast('Protokoll geöffnet');
  }
}

function renderProtocol(){
  const box=$('#protokollList');if(!box)return;
  const sub=$('#protoSub');

  if(!db){
    if(sub)sub.innerHTML='<span class="sync-dot"></span>Kein Server – firebase-config.js ausfüllen';
    box.innerHTML='<div class="log-empty">Noch nicht mit Firebase verbunden.<br>firebase-config.js befüllen, dann funktioniert das Protokoll.</div>';
    return;
  }

  if(sub){
    const name=getUserName();
    sub.innerHTML='<span class="sync-dot on" id="syncDot"></span>Live-Sync aktiv'+
      (name?' · angemeldet als <strong>'+esc(name)+'</strong>':'');
  }

  const nameBox=document.createElement('div');
  nameBox.className='proto-user-row';
  nameBox.innerHTML='<span class="proto-user-label">Dein Name:</span><input class="proto-user-input" placeholder="z. B. Max Müller" value="'+escAttr(getUserName())+'">';
  nameBox.querySelector('input').oninput=e=>{localStorage.setItem(NAME_KEY,e.target.value);};

  box.innerHTML='';
  box.appendChild(nameBox);

  if(!changelog.length){
    const empty=document.createElement('div');empty.className='log-empty';empty.textContent='Noch keine Einträge – Änderungen erscheinen hier automatisch.';
    box.appendChild(empty);
    return;
  }
  changelog.forEach(entry=>{
    const cfg=LOG_ACTIONS[entry.action]||{label:entry.action,color:'#8E8E93'};
    const el=document.createElement('div');el.className='log-entry';
    const tsDate=entry.ts&&entry.ts.toDate?entry.ts.toDate():null;
    const timeAgo=fmtAgo(tsDate);
    const name=entry.userName||('Nutzer '+(entry.userId||'?').slice(-4).toUpperCase());
    el.innerHTML=
      '<span class="log-dot" style="background:'+cfg.color+'"></span>'+
      '<div class="log-body">'+
      '<div class="log-title">'+esc(entry.taskTitle)+'</div>'+
      '<div class="log-meta"><span class="log-action" style="color:'+cfg.color+'">'+cfg.label+'</span>'+
      (timeAgo?'<span>'+timeAgo+'</span>':'')+
      '<span class="log-user">'+esc(name)+'</span></div></div>';
    box.appendChild(el);
  });
}

/* ===== TIMELINE ===== */
function dateForDrop(clientY,excludeId){
  const tiles=[...$('#tlInner').querySelectorAll('.tl-tile')].filter(el=>el.dataset.id!==excludeId);
  let above=null,below=null;
  for(const el of tiles){
    const r=el.getBoundingClientRect();const mid=r.top+r.height/2;
    if(clientY>=mid)above=parseD(el.dataset.date);
    else{below=parseD(el.dataset.date);break;}
  }
  if(above&&below){const m=new Date((above.getTime()+below.getTime())/2);m.setHours(0,0,0,0);return m;}
  if(above)return new Date(above.getTime()+1*MS);
  if(below)return new Date(below.getTime()-1*MS);
  return today();
}

function subtreeIds(task){const ids=[];walk([task],x=>ids.push(x.id));return ids;}
function detachTask(id){const f=findTask(id);if(!f||!f.parent)return false;const i=f.list.findIndex(x=>x.id===id);const[m]=f.list.splice(i,1);state.tasks.push(m);return true;}
function nestUnder(id,targetId){
  if(id===targetId)return false;
  const src=findTask(id),tgt=findTask(targetId);if(!src||!tgt)return false;
  if(subtreeIds(src.task).includes(targetId))return false;
  if(tgt.task.children.some(c=>c.id===id))return false;
  const i=src.list.findIndex(x=>x.id===id);const[m]=src.list.splice(i,1);
  tgt.task.children.push(m);openMap[targetId]=true;
  return true;
}

function renderTimeline(){
  const inner=$('#tlInner');inner.innerHTML='';
  const dated=state.tasks.filter(t=>t.start).map(t=>({t,s:parseD(t.start),e:parseD(t.end)||parseD(t.start)}));
  dated.sort((a,b)=>a.s-b.s||(a.t.title<b.t.title?-1:1));
  if(!dated.length){
    inner.innerHTML='<div class="today-divider" id="todayDiv"><span class="tg">HEUTE</span><span class="dt">'+fmtLong(today())+'</span><span class="ln"></span></div>'+
      '<div class="tl-empty">Noch nichts terminiert.<br>Ziehe unten eine Aufgabe am Ziehgriff hierher, oder lege oben mit + etwas an.</div>';
    renderTray();return;
  }
  const t0=today();let lastMonth=null,todayPlaced=false;
  dated.forEach(d=>{
    if(!todayPlaced&&d.s>t0){inner.appendChild(todayDivider());todayPlaced=true;lastMonth=null;}
    const mk=d.s.getFullYear()+'-'+d.s.getMonth();
    if(mk!==lastMonth){const sep=document.createElement('div');sep.className='month-sep';sep.textContent=MON[d.s.getMonth()]+' '+d.s.getFullYear();inner.appendChild(sep);lastMonth=mk;}
    appendTaskTiles(d.t,0,inner);
  });
  if(!todayPlaced)inner.appendChild(todayDivider());
  renderTray();
}
function appendTaskTiles(task,depth,inner){
  inner.appendChild(buildTile(task,depth));
  if(task.children.length&&openMap[task.id]){task.children.forEach(ch=>appendTaskTiles(ch,depth+1,inner));}
}
function todayDivider(){
  const el=document.createElement('div');el.className='today-divider';el.id='todayDiv';
  el.innerHTML='<span class="tg">HEUTE</span><span class="dt">'+fmtShort(today())+'</span><span class="ln"></span>';
  return el;
}
function buildTile(t,depth){
  const c=CATS[t.cat].color,s=parseD(t.start),e=parseD(t.end)||s,dur=s?dayDiff(e,s):0;
  const hasKids=t.children.length>0,open=openMap[t.id]!==false;
  const tile=document.createElement('div');
  tile.className='tl-tile'+(t.done?' done':'')+(depth?' child':'');
  tile.dataset.id=t.id;tile.dataset.date=t.start||'';tile.dataset.depth=depth;
  if(depth)tile.style.marginLeft=(depth*20)+'px';
  if(depth)tile.style.borderLeft='3px solid '+c;
  const dateTxt=s?(fmtShort(s)+(dur>0?'–'+fmtShort(e):'')):'ohne Datum';
  tile.innerHTML=
    (hasKids?'<button class="tt-caret'+(open?' open':'')+'">›</button>':'<span class="tt-caret sp"></span>')+
    catIcon(t.cat)+
    '<div class="tt-body"><div class="tt-title">'+esc(t.title||'Ohne Titel')+'</div>'+
    '<div class="tt-meta"><span class="cat-name" style="color:'+c+'">'+CATS[t.cat].label+'</span>'+
    '<span class="mid">·</span>'+dateTxt+
    '<span class="tt-prio" style="background:'+PRIOS[t.prio].color+'"></span>'+
    (hasKids?'<span class="tt-sub">'+t.children.length+'</span>':'')+'</div></div>'+
    '<button class="tt-check'+(t.done?' on':'')+'">'+(t.done?'<svg class="svgi" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg>':'')+'</button>'+
    '<span class="tt-grip" title="Verschieben oder auf eine Aufgabe ziehen">'+UI.grip+'</span>';
  if(hasKids)tile.querySelector('.tt-caret').addEventListener('click',ev=>{ev.stopPropagation();openMap[t.id]=(openMap[t.id]===false);renderTimeline();});
  tile.querySelector('.tt-check').addEventListener('pointerdown',ev=>ev.stopPropagation());
  tile.querySelector('.tt-check').addEventListener('click',ev=>{ev.stopPropagation();toggleDone(t.id);});
  tile.addEventListener('click',ev=>{if(ev.target.closest('.tt-grip')||ev.target.closest('.tt-check')||ev.target.closest('.tt-caret'))return;openSheet(t.id);});
  attachTileDrag(tile.querySelector('.tt-grip'),tile,t);
  return tile;
}

function renderTray(){
  const box=$('#trayScroll');box.innerHTML='';
  const undated=state.tasks.filter(t=>!t.start);
  if(!undated.length){box.innerHTML='<div class="tray-empty">Alles terminiert ✓</div>';return;}
  undated.forEach(t=>{
    const chip=document.createElement('div');chip.className='tray-chip';chip.dataset.id=t.id;chip.dataset.depth='0';chip.dataset.date='';
    chip.innerHTML=catIcon(t.cat)+'<span class="tc-t">'+esc(t.title||'Ohne Titel')+(t.children.length?' <span class="tt-sub">'+t.children.length+'</span>':'')+'</span><span class="tray-grip" title="Auf Zeitstrahl oder auf eine Aufgabe ziehen">'+UI.grip+'</span>';
    chip.addEventListener('click',e=>{if(e.target.closest('.tray-grip'))return;openSheet(t.id);});
    attachDateDrag(chip.querySelector('.tray-grip'),chip,t,true);
    box.appendChild(chip);
  });
}

function attachTileDrag(handle,tile,task){attachDateDrag(handle,tile,task,false);}
function attachDateDrag(handle,srcEl,task,fromTray){
  let active=false,ghost=null,moved=false,sx,sy,pid=null,line=null,autoTimer=null,lastY=0;
  let excludeIds=[],mode='top',nestId=null;
  const inner=()=>$('#tlInner');
  const ensureLine=()=>{if(line)return;line=document.createElement('div');line.className='drop-line';inner().appendChild(line);requestAnimationFrame(()=>line&&line.classList.add('show'));};
  const clearNest=()=>{$$('.tl-tile.nest-target').forEach(el=>el.classList.remove('nest-target'));};
  const updateIndicator=clientY=>{
    const tiles=[...inner().querySelectorAll('.tl-tile')];
    let nestEl=null;
    for(const el of tiles){
      if(excludeIds.includes(el.dataset.id))continue;
      const r=el.getBoundingClientRect();
      if(clientY>r.top+r.height*0.28&&clientY<r.bottom-r.height*0.28){nestEl=el;break;}
    }
    if(nestEl){mode='nest';nestId=nestEl.dataset.id;clearNest();nestEl.classList.add('nest-target');if(line)line.classList.remove('show');return;}
    mode='top';nestId=null;clearNest();
    ensureLine();line.classList.add('show');
    const tops=tiles.filter(el=>el.dataset.depth==='0'&&!excludeIds.includes(el.dataset.id));
    let ref=null;
    for(const el of tops){const r=el.getBoundingClientRect();if(clientY<r.top+r.height/2){ref=el;break;}}
    let y;
    if(ref)y=ref.offsetTop-6;
    else if(tops.length)y=tops[tops.length-1].offsetTop+tops[tops.length-1].offsetHeight+3;
    else y=8;
    line.style.top=y+'px';
  };
  const autoScroll=()=>{
    const sc=$('#tlScroll');const r=sc.getBoundingClientRect();const edge=58;let v=0;
    if(lastY<r.top+edge)v=-Math.min(14,(r.top+edge-lastY)/3);
    else if(lastY>r.bottom-edge)v=Math.min(14,(lastY-(r.bottom-edge))/3);
    if(v){sc.scrollTop+=v;updateIndicator(lastY);}
  };
  const cleanup=()=>{
    active=false;pid=null;
    window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',cancel);
    if(autoTimer){clearInterval(autoTimer);autoTimer=null;}
    srcEl.classList.remove('drag-src');clearNest();
    if(line){line.remove();line=null;}
  };
  const removeGhost=()=>{if(ghost){const g=ghost;ghost=null;g.style.opacity='0';g.style.transform='scale(.9)';setTimeout(()=>g.remove(),170);}};
  const down=e=>{if(active||(e.button!==undefined&&e.button!==0))return;sx=e.clientX;sy=e.clientY;lastY=e.clientY;active=true;moved=false;pid=e.pointerId;e.stopPropagation();window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',cancel);};
  const move=e=>{
    if(!active||(pid!==null&&e.pointerId!==pid))return;
    const dx=e.clientX-sx,dy=e.clientY-sy;lastY=e.clientY;
    if(!moved){
      if(Math.abs(dx)<DRAG_THRESH&&Math.abs(dy)<DRAG_THRESH)return;
      moved=true;srcEl.classList.add('drag-src');
      const f=findTask(task.id);excludeIds=f?subtreeIds(f.task):[task.id];
      ghost=srcEl.cloneNode(true);ghost.className=srcEl.className.replace('drag-src','')+' drag-ghost';
      ghost.style.position='fixed';ghost.style.zIndex='100';ghost.style.pointerEvents='none';ghost.style.margin='0';ghost.style.width=srcEl.offsetWidth+'px';ghost.style.left='0';ghost.style.top='0';
      document.body.appendChild(ghost);
      if(currentView==='timeline')autoTimer=setInterval(autoScroll,16);
    }
    ghost.style.transform='translate('+(e.clientX-srcEl.offsetWidth/2)+'px,'+(e.clientY-24)+'px) scale(1.02)';
    updateIndicator(e.clientY);
    e.preventDefault();
  };
  const up=e=>{
    if(!active)return;const wm=moved;const py=(e.clientY!==undefined?e.clientY:lastY);const m=mode,nId=nestId;
    removeGhost();cleanup();
    if(!wm)return;
    const sw=ev=>{ev.stopPropagation();ev.preventDefault();};window.addEventListener('click',sw,true);setTimeout(()=>window.removeEventListener('click',sw,true),360);
    const sc=$('#tlScroll');const r=sc.getBoundingClientRect();
    if(py<r.top-40||py>r.bottom+40){renderTimeline();return;}
    if(m==='nest'&&nId){
      const tg=findTask(nId);
      if(nestUnder(task.id,nId)){
        scheduleSave();renderAll();
        logChange('EINGEORDNET',task.title,{unterTitle:(tg&&tg.task.title)||''});
        toast('Einsortiert unter „'+esc((tg&&tg.task.title)||'Aufgabe')+'"');
      }else{renderTimeline();toast('Hier nicht möglich');}
      return;
    }
    const nd=dateForDrop(py,task.id);
    detachTask(task.id);
    const f=findTask(task.id);if(!f){renderTimeline();return;}
    const old=parseD(f.task.start),oe=parseD(f.task.end);
    f.task.start=isoD(nd);
    if(oe&&old){const sp=dayDiff(oe,old);f.task.end=isoD(new Date(nd.getTime()+sp*MS));}
    scheduleSave();renderAll();
    logChange('VERSCHOBEN',task.title,{datum:isoD(nd)});
    toast((fromTray?'Terminiert auf ':'Verschoben auf ')+fmtLong(nd));
  };
  const cancel=()=>{removeGhost();cleanup();renderTimeline();};
  handle.addEventListener('pointerdown',down);
}

function scrollToToday(){const sc=$('#tlScroll');if(!sc)return;const td=$('#todayDiv');if(!td){sc.scrollTo({top:0,behavior:'smooth'});return;}const off=td.offsetTop-58;sc.scrollTo({top:Math.max(0,off),behavior:'smooth'});}

/* ===== TREE ===== */
function renderTree(){
  const box=$('#tree');box.innerHTML='';
  if(!state.tasks.length){box.innerHTML='<div class="empty-pane"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6h16M8 12h12M12 18h8"/><circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none"/><circle cx="8.5" cy="18" r="1.2" fill="currentColor" stroke="none"/></svg></div><h3>Noch keine Arbeitsschritte</h3><p>Tippe oben auf +, um deinen ersten Hauptarbeitsschritt anzulegen.</p></div>';return;}
  const card=document.createElement('div');card.className='card-list';card.style.margin='8px 16px 0';
  state.tasks.forEach(t=>renderNode(t,state.tasks,0,card));
  const add=document.createElement('button');add.className='add-row';add.innerHTML='<span class="plus">+</span>Hauptarbeitsschritt';
  add.onclick=()=>{const nt=newTask('arbeit');state.tasks.push(nt);scheduleSave();renderAll();logChange('ERSTELLT',nt.title||'Neuer Arbeitsschritt');openSheet(nt.id);};
  card.appendChild(add);
  box.appendChild(card);
}
function renderNode(t,siblings,depth,container){
  const open=openMap[t.id],hasKids=t.children.length>0,c=CATS[t.cat].color,start=parseD(t.start);
  const row=document.createElement('div');row.className='row'+(t.done?' done':'');row.dataset.id=t.id;
  row.innerHTML=
    '<span class="indent" style="width:'+(depth*16)+'px"></span>'+
    '<span class="caret-btn'+(hasKids?'':' empty')+(open?' open':'')+'">›</span>'+
    '<span class="r-check'+(t.done?' on':'')+'">'+(t.done?'✓':'')+'</span>'+
    catIcon(t.cat)+
    '<div class="r-body"><div class="r-title">'+esc(t.title||'Ohne Titel')+'</div>'+
    '<div class="r-sub"><span style="color:'+c+';font-weight:600">'+CATS[t.cat].label+'</span>'+
    (start?'<span>· '+fmtShort(start)+'</span>':'<span style="opacity:.7">· offen</span>')+
    (hasKids?'<span>· '+t.children.length+' Unterp.</span>':'')+
    '<span class="r-prio" style="background:'+PRIOS[t.prio].color+'"></span></div></div>'+
    '<span class="grip">'+UI.grip+'</span>';
  row.querySelector('.caret-btn').onclick=e=>{e.stopPropagation();if(!hasKids)return;openMap[t.id]=!openMap[t.id];renderTree();};
  row.querySelector('.r-check').onclick=e=>{e.stopPropagation();toggleDone(t.id);};
  row.querySelector('.r-body').onclick=()=>openSheet(t.id);
  attachReorder(row.querySelector('.grip'),row,t,siblings);
  container.appendChild(row);
  if(hasKids&&open){
    t.children.forEach(k=>renderNode(k,t.children,depth+1,container));
    const add=document.createElement('button');add.className='add-row';add.style.paddingLeft=(14+(depth+1)*16)+'px';add.innerHTML='<span class="plus">+</span>Unteraufgabe';
    add.onclick=()=>{const nt=newTask(t.cat==='termin'?'todo':t.cat);t.children.push(nt);openMap[t.id]=true;scheduleSave();renderAll();logChange('ERSTELLT',nt.title||'Neue Unteraufgabe',{elternTitle:t.title});openSheet(nt.id);};
    container.appendChild(add);
  }
}
function moveRelative(srcId,targetId,after){
  if(srcId===targetId)return false;
  const src=findTask(srcId);if(!src)return false;
  if(subtreeIds(src.task).includes(targetId))return false;
  const i=src.list.findIndex(x=>x.id===srcId);const[m]=src.list.splice(i,1);
  const tgt=findTask(targetId);if(!tgt){src.list.splice(i,0,m);return false;}
  let idx=tgt.list.findIndex(x=>x.id===targetId);if(after)idx++;
  tgt.list.splice(idx,0,m);return true;
}
function attachReorder(grip,row,task,siblings){
  grip.addEventListener('pointerdown',e=>{
    e.preventDefault();e.stopPropagation();
    const startY=e.clientY;let dragging=false,drop=null,exclude=null;
    const clear=()=>$$('.row.nest-target,.row.ins-before,.row.ins-after').forEach(x=>x.classList.remove('nest-target','ins-before','ins-after'));
    const move=ev=>{
      if(!dragging){if(Math.abs(ev.clientY-startY)<6)return;dragging=true;row.style.opacity='.4';exclude=subtreeIds(task);}
      let over=null;
      document.elementsFromPoint(ev.clientX,ev.clientY).forEach(el=>{if(el.classList&&el.classList.contains('row')&&!exclude.includes(el.dataset.id))over=over||el;});
      clear();drop=null;
      if(over){const r=over.getBoundingClientRect();const tid=over.dataset.id;
        if(ev.clientY<r.top+r.height*0.3){over.classList.add('ins-before');drop={t:tid,after:false};}
        else if(ev.clientY>r.bottom-r.height*0.3){over.classList.add('ins-after');drop={t:tid,after:true};}
        else{over.classList.add('nest-target');drop={t:tid,nest:true};}
      }
    };
    const up=()=>{
      window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);row.style.opacity='';
      if(dragging&&drop){
        let ok=false,msg='';
        if(drop.nest){ok=nestUnder(task.id,drop.t);const tg=findTask(drop.t);msg='Einsortiert unter „'+esc((tg&&tg.task.title)||'')+'"';if(ok)logChange('EINGEORDNET',task.title,{unterTitle:(tg&&tg.task.title)||''});}
        else{ok=moveRelative(task.id,drop.t,drop.after);msg='Verschoben';if(ok)logChange('VERSCHOBEN',task.title);}
        if(ok){scheduleSave();renderTree();toast(msg);}else clear();
      }else clear();
    };
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  });
}

/* ===== TODO ===== */
function renderTodo(){
  const box=$('#todoList');box.innerHTML='';
  const items=[];walk(state.tasks,(t,p)=>items.push({t,p}));
  const open=items.filter(x=>!x.t.done),done=items.filter(x=>x.t.done);
  if(!open.length&&!done.length){box.innerHTML='<div class="empty-pane"><div class="ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.2 4.2L19 7"/></svg></div><h3>Keine Aufgaben</h3><p>Über + anlegen – sie erscheinen hier nach Priorität.</p></div>';return;}
  ['hoch','mittel','niedrig'].forEach(pr=>{
    const g=open.filter(x=>x.t.prio===pr).sort(byDate);if(!g.length)return;
    const grp=document.createElement('div');grp.className='grp';
    grp.innerHTML='<div class="grp-h"><span class="pdot" style="background:'+PRIOS[pr].color+'"></span>'+PRIOS[pr].label+'<span class="cnt">'+g.length+'</span></div>';
    const cl=document.createElement('div');cl.className='card-list';g.forEach(x=>cl.appendChild(todoRow(x.t,x.p)));grp.appendChild(cl);box.appendChild(grp);
  });
  if(done.length){
    const grp=document.createElement('div');grp.className='grp';
    grp.innerHTML='<div class="grp-h"><span class="pdot" style="background:var(--gray)"></span>Erledigt<span class="cnt">'+done.length+'</span></div>';
    const cl=document.createElement('div');cl.className='card-list';done.sort(byDate).forEach(x=>cl.appendChild(todoRow(x.t,x.p)));grp.appendChild(cl);box.appendChild(grp);
  }
}
function byDate(a,b){const da=parseD(a.t.start),db=parseD(b.t.start);if(da&&db)return da-db;if(da)return -1;if(db)return 1;return 0;}
function todoRow(t,parent){
  const c=CATS[t.cat].color,s=parseD(t.start);let cls='',txt='';
  if(s){const dd=dayDiff(s,today());if(t.done)txt=fmtShort(s);else if(dd<0){cls='over';txt=(-dd)+'T überf.';}else if(dd===0){cls='soon';txt='heute';}else if(dd<=7){cls='soon';txt='in '+dd+'T';}else txt=fmtShort(s);}
  const row=document.createElement('div');row.className='row'+(t.done?' done':'');
  row.innerHTML=
    '<span class="r-check'+(t.done?' on':'')+'">'+(t.done?'✓':'')+'</span>'+
    catIcon(t.cat)+
    '<div class="r-body"><div class="r-title">'+esc(t.title||'Ohne Titel')+'</div>'+
    '<div class="r-sub"><span style="color:'+c+';font-weight:600">'+CATS[t.cat].label+'</span>'+
    (parent?'<span>· ↳ '+esc(parent.title||'')+'</span>':'')+'</div></div>'+
    (txt?'<span class="r-when '+cls+'">'+txt+'</span>':'')+'<span class="chev">›</span>';
  row.querySelector('.r-check').onclick=e=>{e.stopPropagation();toggleDone(t.id);};
  row.onclick=()=>openSheet(t.id);
  return row;
}

/* ===== ACTIONS ===== */
function toggleDone(id){
  const f=findTask(id);if(!f)return;const t=f.task;
  t.done=!t.done;
  if(t.done){
    const s=parseD(t.start);
    if(!s||s>today()){t.start=isoD(today());t.end='';}
    t.completedOn=isoD(today());
    logChange('ERLEDIGT',t.title);
    toast('Erledigt');
  }else{
    t.start='';t.end='';t.completedOn='';
    logChange('GEOEFFNET',t.title);
    toast('Zurück in „Nicht terminiert"');
  }
  scheduleSave();renderAll();
}
function confirmDelete(id){
  const f=findTask(id);if(!f)return;
  if(f.task.children.length&&!confirm('„'+(f.task.title||'Aufgabe')+'" inkl. '+f.task.children.length+' Unteraufgaben löschen?'))return;
  const title=f.task.title;
  walk([f.task],t=>t.files.forEach(fl=>sDel(FILE_PREFIX+fl.id)));
  const i=f.list.findIndex(x=>x.id===id);f.list.splice(i,1);
  logChange('GELOESCHT',title);
  scheduleSave();closeSheet();renderAll();toast('Gelöscht');
}

/* ===== DETAIL SHEET ===== */
let sheetId=null;
function openSheet(id){
  sheetId=id;const f=findTask(id);if(!f)return;const t=f.task;const path=pathTo(id)||[t];
  $('#sheet').innerHTML=`
    <div class="grabber"></div>
    <div class="sheet-nav"><button id="closeSheet">Fertig</button><div class="nt">Details</div><button class="done" id="delTop" style="color:var(--red)">Löschen</button></div>
    ${path.length>1?'<div class="crumbs">'+path.slice(0,-1).map(p=>'<a data-go="'+p.id+'">'+esc(p.title||'…')+'</a>').join(' › ')+' ›</div>':''}
    <div class="sheet-body">
      <div class="titlebox"><input class="title-input" id="f-title" placeholder="Titel…" value="${escAttr(t.title)}"></div>
      <div class="s-grp"><div class="s-h">Art</div>
        <div class="s-card"><div class="pillrow" id="seg-cat">${Object.entries(CATS).map(([k,v])=>`<button class="pill ${t.cat===k?'on':''}" data-v="${k}" style="${t.cat===k?'background:'+v.color:''}">${v.label}</button>`).join('')}</div></div></div>
      <div class="s-grp"><div class="s-h">Priorität</div>
        <div class="s-card"><div class="pillrow" id="seg-prio">${Object.entries(PRIOS).map(([k,v])=>`<button class="pill ${t.prio===k?'on':''}" data-v="${k}" style="${t.prio===k?'background:'+v.color:''}">${v.label.replace(' Priorität','')}</button>`).join('')}</div></div></div>
      <div class="s-grp"><div class="s-h">Einträge</div><div class="s-card" id="jnlCard"></div></div>

      <div class="s-grp"><div class="s-h">Zeit</div>
        <div class="s-card">
          <div class="s-field s-inline"><span class="fl">Start / Fällig</span><input type="date" id="f-start" value="${t.start||''}"></div>
          <div class="s-field s-inline"><span class="fl">Ende</span><input type="date" id="f-end" value="${t.end||''}"></div>
        </div></div>
      <div class="s-grp"><div class="s-h">Infos</div>
        <div class="s-card">
          <div class="s-field"><div class="fl">Ansprechpartner / Absprachen</div><input id="f-contacts" placeholder="z.B. Elektriker Meier, Tel. …" value="${escAttr(t.contacts)}"></div>
          <div class="s-field"><div class="fl">Kosten / Budget</div><input id="f-cost" placeholder="z.B. 4.500 €" value="${escAttr(t.cost)}"></div>
          <div class="s-field"><div class="fl">Notizen</div><textarea id="f-notes" placeholder="Details, offene Fragen, Material…">${esc(t.notes)}</textarea></div>
        </div></div>
      <div class="s-grp"><div class="s-h">Checkliste</div><div class="s-card" id="clCard"></div></div>
      <div class="s-grp"><div class="s-h">Dateien & Fotos</div><div class="s-card" id="fileCard"></div></div>
      <div class="s-grp"><div class="s-h">Unteraufgaben</div><div class="s-card" id="subCard"></div></div>
      ${path.length>1?`<div class="s-grp"><div class="s-h">Verschachtelung</div>
        <div class="s-card"><div class="s-field s-inline"><span class="fl">Unteraufgabe von</span><span style="color:var(--label2);font-weight:500">${esc(path[path.length-2].title||'…')}</span></div></div>
        <button class="btn-big" id="detachBtn" style="color:var(--blue)">Aus Hauptaufgabe lösen</button></div>`:''}
      <button class="btn-big btn-done" id="doneToggle">${t.done?'↺ Wieder öffnen':'✓ Als erledigt markieren'}</button>
      <input type="file" id="fileInput" multiple style="display:none">
    </div>`;
  $('#scrim').classList.add('open');$('#sheet').classList.add('open');
  bindSheet(t);renderJournal(t);renderChecklist(t);renderSub(t);renderFiles(t);
}
function bindSheet(t){
  let titleChanged=false;
  const save=(k,v)=>{t[k]=v;scheduleSave();};
  $('#closeSheet').onclick=closeSheet;
  $('#delTop').onclick=()=>confirmDelete(t.id);
  $('#f-title').oninput=e=>{save('title',e.target.value);titleChanged=true;};
  $('#f-title').onblur=()=>{if(titleChanged){logChange('BEARBEITET',t.title);titleChanged=false;}renderAll();};
  $('#f-contacts').oninput=e=>save('contacts',e.target.value);
  $('#f-cost').oninput=e=>save('cost',e.target.value);
  $('#f-notes').oninput=e=>{save('notes',e.target.value);e.target.style.height='auto';e.target.style.height=e.target.scrollHeight+'px';};
  $('#f-start').onchange=e=>{save('start',e.target.value);logChange('BEARBEITET',t.title,{feld:'Start'});};
  $('#f-end').onchange=e=>{save('end',e.target.value);logChange('BEARBEITET',t.title,{feld:'Ende'});};
  $$('#seg-cat .pill').forEach(b=>b.onclick=()=>{t.cat=b.dataset.v;scheduleSave();logChange('BEARBEITET',t.title,{feld:'Kategorie'});openSheet(t.id);});
  $$('#seg-prio .pill').forEach(b=>b.onclick=()=>{t.prio=b.dataset.v;scheduleSave();logChange('BEARBEITET',t.title,{feld:'Priorität'});$$('#seg-prio .pill').forEach(x=>{x.classList.remove('on');x.style.background='';});b.classList.add('on');b.style.background=PRIOS[b.dataset.v].color;});
  $$('.crumbs a').forEach(a=>a.onclick=()=>openSheet(a.dataset.go));
  $('#doneToggle').onclick=()=>{toggleDone(t.id);openSheet(t.id);};
  const db2=$('#detachBtn');if(db2)db2.onclick=()=>{logChange('GELOEST',t.title);detachTask(t.id);scheduleSave();renderAll();openSheet(t.id);toast('Als Hauptaufgabe gelöst');};
  const ta=$('#f-notes');if(ta){ta.style.height='auto';ta.style.height=ta.scrollHeight+'px';}
}
function renderChecklist(t){
  const box=$('#clCard');if(!box)return;box.innerHTML='';
  t.checklist.forEach(c=>{
    const r=document.createElement('div');r.className='cl-row';
    r.innerHTML='<span class="cl-box'+(c.done?' on':'')+'">'+(c.done?'✓':'')+'</span><input value="'+escAttr(c.text)+'" class="'+(c.done?'done':'')+'"><button class="cl-x ic-btn">'+UI.close+'</button>';
    r.querySelector('.cl-box').onclick=()=>{c.done=!c.done;scheduleSave();renderChecklist(t);};
    r.querySelector('input').oninput=e=>{c.text=e.target.value;scheduleSave();};
    r.querySelector('.cl-x').onclick=()=>{t.checklist=t.checklist.filter(x=>x.id!==c.id);scheduleSave();renderChecklist(t);};
    box.appendChild(r);
  });
  const add=document.createElement('div');add.className='cl-add';add.innerHTML='<span class="plus">+</span><input placeholder="Punkt hinzufügen…" id="clNew">';
  const doAdd=()=>{const v=add.querySelector('#clNew').value.trim();if(!v)return;t.checklist.push({id:uid(),text:v,done:false});scheduleSave();renderChecklist(t);setTimeout(()=>$('#clCard .cl-add input')&&$('#clCard .cl-add input').focus(),0);};
  add.querySelector('.plus').onclick=doAdd;
  add.querySelector('input').onkeydown=e=>{if(e.key==='Enter')doAdd();};
  box.appendChild(add);
}
function renderSub(t){
  const box=$('#subCard');if(!box)return;box.innerHTML='';
  t.children.forEach(s=>{
    const r=document.createElement('div');r.className='sub-row'+(s.done?' done':'');
    r.innerHTML='<span class="sc'+(s.done?' on':'')+'">'+(s.done?'✓':'')+'</span><span class="st">'+esc(s.title||'Ohne Titel')+'</span>'+(s.children.length?'<span style="font-size:12px;color:var(--label2)">'+s.children.length+'</span>':'')+'<span class="chev">›</span>';
    r.querySelector('.sc').onclick=e=>{e.stopPropagation();s.done=!s.done;scheduleSave();renderSub(t);renderAll();};
    r.onclick=()=>openSheet(s.id);
    box.appendChild(r);
  });
  const add=document.createElement('div');add.className='cl-add';add.innerHTML='<span class="plus">+</span><input placeholder="Unteraufgabe hinzufügen…" id="subNew">';
  const doAdd=()=>{const v=add.querySelector('#subNew').value.trim();if(!v)return;t.children.push({...newTask(t.cat==='termin'?'todo':t.cat),title:v});scheduleSave();renderSub(t);renderAll();setTimeout(()=>$('#subCard .cl-add input')&&$('#subCard .cl-add input').focus(),0);};
  add.querySelector('.plus').onclick=doAdd;
  add.querySelector('input').onkeydown=e=>{if(e.key==='Enter')doAdd();};
  box.appendChild(add);
}
async function renderFiles(t){
  const box=$('#fileCard');if(!box)return;box.innerHTML='';
  for(const fl of t.files){
    const r=document.createElement('div');r.className='file-row';
    const isImg=fl.type&&fl.type.startsWith('image/');
    r.innerHTML='<div class="file-ic">'+(fl.type&&fl.type.includes('pdf')?'PDF':((fl.name.split('.').pop()||'').slice(0,4).toUpperCase()||'DAT'))+'</div><div class="file-info"><div class="file-n">'+esc(fl.name)+'</div><div class="file-s">'+fmtSize(fl.size)+'</div></div><button class="file-dl ic-btn">'+UI.download+'</button><button class="file-rm ic-btn">'+UI.trash+'</button>';
    box.appendChild(r);
    const data=await getFileData(fl.id);
    if(data){if(isImg){const img=document.createElement('img');img.className='file-thumb';img.src=data;r.replaceChild(img,r.firstChild);}r.querySelector('.file-dl').onclick=()=>{const a=document.createElement('a');a.href=data;a.download=fl.name;a.click();};}
    else{r.querySelector('.file-dl').style.opacity='.3';}
    r.querySelector('.file-rm').onclick=()=>{t.files=t.files.filter(x=>x.id!==fl.id);sDel(FILE_PREFIX+fl.id);delete fileCache[fl.id];scheduleSave();renderFiles(t);};
  }
  const add=document.createElement('button');add.className='file-add';add.innerHTML='<span class="ic">'+UI.paperclip+'</span>Datei oder Foto hinzufügen';
  add.onclick=()=>$('#fileInput').click();
  box.appendChild(add);
  const fi=$('#fileInput');if(fi)fi.onchange=()=>{handleFiles(fi.files,t);fi.value='';};
}
async function getFileData(id){if(fileCache[id])return fileCache[id];const d=await sGet(FILE_PREFIX+id);if(d)fileCache[id]=d;return d;}
function handleFiles(list,t){
  [...list].forEach(file=>{
    if(file.size>MAX_FILE){toast('„'+file.name+'" ist zu groß (max. 4 MB)');return;}
    const reader=new FileReader();
    reader.onload=async()=>{const id=uid();const data=reader.result;const ok=await sSet(FILE_PREFIX+id,data);fileCache[id]=data;t.files.push({id,name:file.name,type:file.type,size:file.size});scheduleSave();renderFiles(t);if(!ok)toast('Datei gespeichert');};
    reader.readAsDataURL(file);
  });
}
function fmtJnlDate(d){
  const day=d.getDate()+'. '+MONS[d.getMonth()]+' '+d.getFullYear();
  const time=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
  return day+' · '+time;
}
function renderJournal(t){
  const box=$('#jnlCard');if(!box)return;box.innerHTML='';
  const entries=[...(t.journal||[])].reverse();
  if(entries.length){
    const list=document.createElement('div');list.className='jnl-list';
    entries.forEach(e=>{
      const r=document.createElement('div');r.className='jnl-row';
      const dt=new Date(e.ts);
      r.innerHTML=
        '<div class="jnl-header">'+
        '<span class="jnl-ts">'+fmtJnlDate(dt)+'</span>'+
        (e.author?'<span class="jnl-author">'+esc(e.author)+'</span>':'')+
        '<button class="jnl-del ic-btn">'+UI.trash+'</button>'+
        '</div>'+
        '<div class="jnl-text">'+esc(e.text)+'</div>';
      r.querySelector('.jnl-del').onclick=()=>{
        t.journal=t.journal.filter(x=>x.id!==e.id);
        scheduleSave();renderJournal(t);
      };
      list.appendChild(r);
    });
    box.appendChild(list);
  }
  const add=document.createElement('div');add.className='jnl-add';
  add.innerHTML='<textarea class="jnl-input" placeholder="Neuer Eintrag…" rows="2"></textarea>'+
    '<button class="jnl-submit">Eintragen</button>';
  const doAdd=()=>{
    const v=add.querySelector('textarea').value.trim();if(!v)return;
    const author=getUserName()||('Nutzer '+currentUserId.slice(-4).toUpperCase());
    if(!t.journal)t.journal=[];
    t.journal.push({id:uid(),text:v,ts:new Date().toISOString(),author});
    scheduleSave();
    logChange('BEARBEITET',t.title,{feld:'Eintrag'});
    add.querySelector('textarea').value='';
    renderJournal(t);
  };
  add.querySelector('.jnl-submit').onclick=doAdd;
  add.querySelector('textarea').onkeydown=e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey))doAdd();};
  box.appendChild(add);
}

function closeSheet(){$('#scrim').classList.remove('open');$('#sheet').classList.remove('open');sheetId=null;renderAll();}

/* ===== HELPERS ===== */
function esc(s){return(s||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function escAttr(s){return(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
let toastT;function toast(m){const el=$('#toast');el.textContent=m;el.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>el.classList.remove('show'),2400);}

/* ===== VIEW SWITCHING ===== */
function switchView(v){
  currentView=v;
  $$('.tab').forEach(x=>x.classList.toggle('on',x.dataset.view===v));
  $$('.view').forEach(el=>el.classList.toggle('active',el.id==='view-'+v));
  $('#heuteBtn').style.display=v==='timeline'?'':'none';
  renderAll();
  if(v==='timeline')setTimeout(scrollToToday,60);
}

$('#tabbar').addEventListener('click',e=>{
  const b=e.target.closest('.tab');if(!b)return;
  switchView(b.dataset.view);
});
$('#heuteBtn').onclick=scrollToToday;

const as=$('#actionSheet');
function openAS(){as.classList.add('open');$('#scrim').classList.add('open');}
function closeAS(){as.classList.remove('open');if(!$('#sheet').classList.contains('open'))$('#scrim').classList.remove('open');}
$('#addBtn').onclick=openAS;
$('#asCancel').onclick=closeAS;
as.addEventListener('click',e=>{
  const b=e.target.closest('.as-item');if(!b)return;
  const cat=b.dataset.cat;const nt=newTask(cat);
  if(cat==='termin')nt.start=isoD(today());
  state.tasks.push(nt);
  scheduleSave();closeAS();renderAll();
  logChange('ERSTELLT',nt.title||'Neue Aufgabe',{cat});
  openSheet(nt.id);
});
$('#scrim').addEventListener('click',()=>{closeAS();closeSheet();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closeAS();closeSheet();}});

init();

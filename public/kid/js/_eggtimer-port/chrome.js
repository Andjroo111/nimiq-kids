
import { createConfetti } from '/confetti.js';

const BUILD='tmr-a0821a';
const $=id=>document.getElementById(id);
const clamp=(v,a,b)=>v<a?a:v>b?b:v;
const CLEAN=new URLSearchParams(location.search).has('clean');
if(CLEAN)$('eg-dev').classList.add('eg-off');
/* ⚠️ BOTH builds, unmissable. Andjroo, 2026-07-31: "I'm still seeing the exact
   same version" — three rounds of work reached the Mini and the tunnel and never
   his phone, and there was nothing on screen that would have told him. */
$('eg-dvBuild').textContent=BUILD+' · rig …';

/* ---------- what the parent has chosen ----------
   ⚠️ bump LS whenever a default changes, or the new one silently loses to whatever
   is already in the browser. `kidtimer2` = the pie moved to the top left corner. */
const LS='kidtimer2';
const S={min:2, sec:0, bg:'city', heroes:null, reminder:'off',
         during:'none', end:'chime', muteMusic:false, muteBell:false,
         pie:'badge', pieXY:null};
try{ Object.assign(S, JSON.parse(localStorage.getItem(LS)||'{}')) }catch(e){}
/* ⚠️ MIGRATED, NOT BUMPED. `hero` was one id; it is a LIST now (Andjroo, 2026-07-31 —
   "I want the kid to be able to select multiple characters, so that way it's
   randomized as well"). Bumping LS would have taken his background, his reminder and
   his sounds down with it for a field that translates in one line. */
if(S.hero&&!S.heroes){ S.heroes=[S.hero] }
delete S.hero;
if(S.heroes&&!Array.isArray(S.heroes))S.heroes=[S.heroes];
const save=()=>{ try{ localStorage.setItem(LS,JSON.stringify(S)) }catch(e){} };

const BGS=[['city','City'],['meadow','Meadow'],['ocean','Ocean'],['space','Space']];
/* Andjroo's list, in his order: "there's an off button, there's a good job, you did
   it, hooray... time to get ready, time to clean up, time to brush your teeth."
   The glyphs are monoline stand-ins — the illustrated set is an art pass. */
const REMINDERS=[
  ['off','Off'],['goodjob','Good job'],['hooray','Hooray'],
  ['love','Love you'],['shoes','Shoes on'],['socks','Get dressed'],
  ['bath','Bath time'],['bed','Bedtime'],['tidy','Clean up'],
  ['teeth','Brush teeth'],['eat','Time to eat'],['screenoff','Screens off'],
];
/* Andjroo, 2026-07-31: "add a 'no music' option at the end" meant ADD ONE — the END
   LANE had no way out at all, only the during lane did. Read as a position instead, it
   moved the during lane's opt-out to last, and he corrected it: "the no music part
   should be the first thing on the sounds page." Off is the first choice in both
   lanes now, the way Off is the first tile on the reminder sheet. */
const DURING=[['none','No music'],['lullaby','Lullaby'],['bounce','Bouncy'],['space','Floaty'],['clock','Ticking']];
const ENDING=[['none','No sound'],['chime','Chime'],['fanfare','Fanfare'],['bell','Bell'],['cheer','Kids cheer'],['pop','Pop']];
/* which cracks the app rolls between — every pattern tools/crack_art.py cut */
const CRACK_PATTERNS=[1,2,3,4,5];

/* ---------- the rig ---------- */
const rigFrame=$('eg-rig');
rigFrame.src='/wiggle.html?embed=1&v='+BUILD;
let RIG=null, GEO={stage:{w:720,h:560}, egg:{x:179,y:70,w:362,h:432}, ring:{x:360,y:280,r:262}};
let heroes=[];

rigFrame.addEventListener('load',()=>{
  const w=rigFrame.contentWindow;
  const tryHook=()=>{
    if(w.RIG){ RIG=w.RIG; GEO=RIG.geom(); heroes=RIG.heroes();
      $('eg-dvBuild').textContent=BUILD+' · '+RIG.build;
      /* ⚠️ `heroes` is the DRAWN roster, read once, here. The kid's photos are
         pushed into the rig straight after, so re-reading RIG.heroes() later would
         hand back the drawn ones AND the photos and the grid would show every
         photo twice. buildEggGrid() joins the two lists itself. */
      /* ⚠️ The photos have to be registered BEFORE the set is read back, or a kid's
         own character is filtered out of its own selection as a dead id and the
         first tap after a reload silently re-adds it. */
      Promise.all(PHOTOS.map(p=>RIG.addHero(p.id,p.name,p.src)))
        .then(()=>{ S.heroes=heroSet(); save(); buildEggGrid() });
      S.heroes=heroSet();
      buildEggGrid(); RIG.sleep(); layout(); }
    else setTimeout(tryHook,60);
  };
  tryHook();
});

/* ---------- layout: every number here is a share of the phone, not a pixel ----------
   The two egg positions are computed from what the rig MEASURES (RIG.geom()), so a
   recut of the art moves the badge with it instead of leaving the egg off-centre. */
const L={};
function layout(){
  const W=$('eg-app').clientWidth, H=$('eg-app').clientHeight;
  L.W=W; L.H=H;
  L.cx=W/2;
  L.badgeR=Math.min(W*.44, H*.21);
  L.badgeY=H*.35;
  // the egg on the set screen: the ref's egg is ~77% of the width, centred at 35%
  L.setEggH=Math.min(H*.44, W*.95*(GEO.egg.h/GEO.egg.w));
  L.setEggW=L.setEggH*(GEO.egg.w/GEO.egg.h);
  L.setEggY=H*.35;

  // scene clip: wide open on set, the badge on run/hatch
  const set=document.body.classList.contains('set');
  $('eg-bgImg').style.setProperty('--clipR', set? Math.hypot(W,H)+'px' : L.badgeR+'px');
  $('eg-bgImg').style.setProperty('--clipX', L.cx+'px');
  $('eg-bgImg').style.setProperty('--clipY', (set? H/2 : L.badgeY)+'px');

  // the rig itself: scale + place so the right thing lands in the right spot
  let k,tx,ty;
  if(set){ k=L.setEggH/GEO.egg.h;
           tx=L.cx-(GEO.egg.x+GEO.egg.w/2)*k; ty=L.setEggY-(GEO.egg.y+GEO.egg.h/2)*k }
  else   { k=L.badgeR/GEO.ring.r;
           tx=L.cx-GEO.ring.x*k;              ty=L.badgeY-GEO.ring.y*k }
  const rw=$('eg-rigWrap');
  rw.style.left=tx+'px'; rw.style.top=ty+'px';
  rw.style.width=(720*k)+'px'; rw.style.height=(560*k)+'px';

  const rim=$('eg-badgeRim');
  rim.style.cssText+=`;left:${L.cx-L.badgeR}px;top:${L.badgeY-L.badgeR}px;
                      width:${L.badgeR*2}px;height:${L.badgeR*2}px`;
  // the canvas is the phone now, not the badge — see the #conf note
  const cf=$('eg-conf');
  cf.style.cssText+=`;left:0;top:0;width:${W}px;height:${H}px`;

  layoutSet(W,H); layoutRun(W,H); placePie();
}

function layoutSet(W,H){
  const eggT=L.setEggY-L.setEggH/2, eh=L.setEggH;
  const d=$('eg-dial');
  d.style.cssText+=`;left:0;right:0;top:${eggT+eh*.20}px`;
  $('eg-dialTitle').style.fontSize=Math.round(eh*.105)+'px';

  const rowH=Math.round(eh*.125), colW=Math.round(L.setEggW*.30);
  $('eg-cols').style.marginTop=Math.round(eh*.03)+'px';
  for(const h of ['hMin','hSec']) $(h).style.cssText+=`;font-size:${Math.round(eh*.062)}px;width:${colW}px`;
  for(const c of ['colMin','colSec']){
    const el=$(c);
    el.style.cssText+=`;width:${colW}px;height:${rowH*3}px;padding:${rowH}px 0`;
    el.querySelectorAll('.eg-n').forEach(n=>{ n.style.height=rowH+'px'; n.style.fontSize=Math.round(rowH*.86)+'px' });
  }
  // the band sits behind the middle row of both columns; the colon sits in it
  const headH=$('hMin').offsetHeight||Math.round(eh*.08);
  $('eg-band').style.cssText+=`;top:${headH+rowH}px;height:${rowH}px`;
  $('eg-colon').style.cssText+=`;top:${headH+rowH*1.5}px;font-size:${Math.round(rowH*.7)}px`;

  // the bubble's art is 100 wide but its disc is only 64 of that, so the box is
  // scaled off the disc — otherwise the tail's overhang shrinks the + itself
  /* ⚠️ THE SHOULDER, BUT ON SCREEN. The bubble is placed off the egg's own width, and
     the egg is as wide as the phone lets it be — so on a 360px phone the shoulder is
     already past the right edge and the bubble hung 6px off it. (4px of that predates
     the geom fix; reading the DRAWN curve made the egg 2% wider for the same height,
     which pushed it the rest of the way.) `right` is not a taste margin, it is where
     the mutes sit, so the bubble stops on the same line the rest of the chrome does. */
  const pw=Math.round(Math.min(92,L.setEggW*.31));
  const px=Math.min(L.cx+L.setEggW*.30, W-14-pw);
  $('eg-plus').style.cssText+=`;width:${pw}px;height:${pw}px;
      left:${px}px;top:${eggT-eh*.02}px`;

  const sh=Math.round(Math.min(76,H*.09));
  $('eg-start').style.cssText+=`;top:${H*.69-sh/2}px;height:${sh}px;font-size:${Math.round(sh*.52)}px`;

  const tb=Math.round(Math.min(64,W*.165));
  $('eg-tray').style.cssText+=`;top:${H*.88-tb/2}px;gap:${Math.round(tb*.42)}px`;
  document.querySelectorAll('.eg-trayb').forEach(b=>{ b.style.width=tb+'px'; b.style.height=tb+'px' });
}

function layoutRun(W,H){
  /* The countdown row is sized from what is left, not from a chosen number. With
     the pie beside the clock there is ~60px less to spend, so the digits come down
     a size — that trade is real and it is the reason to look at all three. */
  const inRow=(S.pie==='clock' && !S.pieXY);
  const pieW=inRow?Math.round(Math.min(62,W*.16)):0;
  const gap=Math.round(inRow?W*.028:W*.045);
  const st=Math.round(Math.min(inRow?42:50,W*.125));
  const room=W-28-pieW-st*2-gap*(inRow?4:2);
  const cs=Math.round(clamp(room/3.05, 42, Math.min(66,W*.17)));
  $('eg-clockRow').style.cssText+=`;top:${H*.665-cs*.7}px;gap:${gap}px`;
  $('eg-clock').style.fontSize=cs+'px';
  document.querySelectorAll('.eg-step').forEach(b=>{ b.style.width=st+'px'; b.style.height=st+'px' });

  const cw=Math.round(Math.min(112,W*.30)), ch=Math.round(cw*.72);
  $('eg-runCtl').style.cssText+=`;top:${H*.845-ch/2}px`;
  document.querySelectorAll('.eg-ctl').forEach(b=>{ b.style.width=cw+'px'; b.style.height=ch+'px' });
  $('eg-done').style.cssText+=`;top:${H*.845-ch/2}px;height:${ch}px;font-size:${Math.round(ch*.52)}px`;
  $('eg-hatchClock').style.cssText+=`;position:absolute;left:0;right:0;text-align:center;
     top:${H*.665-cs*.7}px;font-size:${cs}px;font-weight:800;color:var(--ink);
     font-variant-numeric:tabular-nums;letter-spacing:-1px`;

  for(const [id,on] of [['mMusic',S.muteMusic],['mBell',S.muteBell]]) drawMute(id,on);
}

/* the two little icons top right: music first, then the sound at the end */
function drawMute(id,off){
  const note=`<path d="M20 3.6 8.6 6v9.2a3.4 3.4 0 1 0 1.8 3V9.1l7.8-1.6v5.3a3.4 3.4 0 1 0 1.8 3z"/>`;
  const bell=`<path d="M12 2.6a5.6 5.6 0 0 0-5.6 5.6c0 5-2 6.4-2 6.4h15.2s-2-1.4-2-6.4A5.6 5.6 0 0 0 12 2.6z"/>
              <path d="M13.6 18.6a1.9 1.9 0 0 1-3.2 0"/>`;
  const body=id==='mMusic'?note:bell;
  const fill=id==='mMusic'?'#B9BFCB':'none';
  const cross=off?`<path d="M17.4 17.4l4.4 4.4M21.8 17.4l-4.4 4.4" stroke="#B9BFCB" stroke-width="2.6" stroke-linecap="round" fill="none"/>`:'';
  $(id).innerHTML=`<svg width="30" height="30" viewBox="0 0 24 26" fill="${fill}"
     stroke="${id==='mMusic'?'none':(off?'#B9BFCB':'#E9B213')}" stroke-width="1.9"
     stroke-linejoin="round" stroke-linecap="round">
     <g fill="${id==='mMusic'?(off?'#B9BFCB':'#B9BFCB'):(off?'none':'#E9B213')}"
        stroke="${id==='mMusic'?'none':(off?'#B9BFCB':'#E9B213')}">${body}</g>${cross}</svg>`;
}

/* ---------- the pie: ours, somewhere theirs is not ----------
   Theirs sits bottom-right INSIDE the badge, over the egg. All three of these keep
   it off the egg; which one ships is Andjroo's pick, and it drags anywhere from
   there. `clock` re-parents into the countdown row so flexbox spaces it; the other
   two float over the app.                                                        */
function placePie(){
  const pie=$('eg-pie'), arc=$('eg-rimArc'), rim=S.pie==='rim';
  pie.style.display=rim?'none':'block';
  arc.style.display=rim?'block':'none';
  if(rim){
    const pad=10, R=L.badgeR+pad, S8=8;
    arc.setAttribute('width',R*2+S8*2); arc.setAttribute('height',R*2+S8*2);
    arc.style.cssText+=`;left:${L.cx-R-S8}px;top:${L.badgeY-R-S8}px`;
    const c=$('eg-rimC');
    c.setAttribute('cx',R+S8); c.setAttribute('cy',R+S8); c.setAttribute('r',R);
    c.setAttribute('stroke-width',9);
    return;
  }
  const inRow = S.pie==='clock' && !S.pieXY;
  const d=Math.round(inRow ? Math.min(62,L.W*.16) : Math.min(98,L.W*.25));
  pie.setAttribute('width',d); pie.setAttribute('height',d);
  if(inRow){
    pie.classList.remove('free');
    pie.style.left=pie.style.top='';
    if(pie.parentElement!==$('eg-clockRow')) $('eg-clockRow').insertBefore(pie,$('eg-clockRow').firstChild);
    return;
  }
  pie.classList.add('free');
  if(pie.parentElement!==$('eg-pieHost')) $('eg-pieHost').insertBefore(pie,$('eg-pieHost').firstChild);
  let x,y;
  if(S.pieXY){ x=S.pieXY[0]*L.W; y=S.pieXY[1]*L.H }
  else{
    /* Andjroo, 2026-07-31: "the pie should be in the top left corner... it could
       overlap just a hair on the background."
       So the left edge is the margin and the HEIGHT is solved, not chosen: sit the
       disc's centre on the circle of radius (badgeR + d/2 − HAIR) about the badge
       and take the upper intersection with x = margin. That is the highest it can
       be while still touching, so it reads as tucked into the corner and the bite
       it takes out of the scene stays the same hair on every screen size. */
    const HAIR=10, m=Math.round(L.W*.046);
    x=m;
    const R=L.badgeR+d/2-HAIR, dx=L.cx-(x+d/2);
    y=L.badgeY-(Math.abs(dx)<R?Math.sqrt(R*R-dx*dx):0)-d/2;
  }
  pie.style.left=clamp(x,4,L.W-d-4)+'px';
  pie.style.top =clamp(y,Math.max(4,L.H*.055),L.H-d-4)+'px';
}
function drawPie(frac){
  const f=clamp(frac,0,1);
  if(S.pie==='rim'){
    const c=$('eg-rimC'), R=+c.getAttribute('r'), C=2*Math.PI*R;
    c.setAttribute('stroke-dasharray',C); c.setAttribute('stroke-dashoffset',C*(1-f));
    c.setAttribute('transform',`rotate(-90 ${c.getAttribute('cx')} ${c.getAttribute('cy')})`);
    return;
  }
  const a=-Math.PI/2, b=a+Math.PI*2*f, R=52;
  const x1=60+R*Math.cos(a), y1=60+R*Math.sin(a);
  const x2=60+R*Math.cos(b), y2=60+R*Math.sin(b);
  $('eg-pieWedge').setAttribute('d', f>=.9999
    ? `M60 8 A52 52 0 1 1 59.9 8 Z`
    : f<=0 ? '' : `M60 60 L${x1} ${y1} A${R} ${R} 0 ${f>.5?1:0} 1 ${x2} ${y2} Z`);
  $('eg-pieHand').setAttribute('x2',x2); $('eg-pieHand').setAttribute('y2',y2);
}
/* draggable, because everything on Andjroo's screens is */
(function dragPie(){
  const pie=$('eg-pie'); let on=false,dx=0,dy=0;
  pie.addEventListener('pointerdown',e=>{
    // lifting it out of the countdown row: freeze it exactly where it already is,
    // so the first frame of the drag is not a jump to some other corner
    if(!pie.classList.contains('free')){
      const r=pie.getBoundingClientRect(), a=$('eg-app').getBoundingClientRect();
      $('eg-pieHost').insertBefore(pie,$('eg-pieHost').firstChild);
      pie.classList.add('free');
      pie.style.left=(r.left-a.left)+'px'; pie.style.top=(r.top-a.top)+'px';
    }
    on=true; pie.classList.add('dragging');
    dx=e.clientX-pie.offsetLeft; dy=e.clientY-pie.offsetTop;
    try{ pie.setPointerCapture(e.pointerId) }catch(_){}       // can throw; never let it kill the gesture
  });
  pie.addEventListener('pointermove',e=>{                      // e.buttons is 0 under a finger
    if(!on)return; e.preventDefault();
    const d=pie.clientWidth;
    pie.style.left=clamp(e.clientX-dx,4,L.W-d-4)+'px';
    pie.style.top =clamp(e.clientY-dy,4,L.H-d-4)+'px';
  });
  const up=()=>{ if(!on)return; on=false; pie.classList.remove('dragging');
    S.pieXY=[pie.offsetLeft/L.W, pie.offsetTop/L.H]; save(); layoutRun(L.W,L.H) };
  pie.addEventListener('pointerup',up); pie.addEventListener('pointercancel',up);
})();

/* ---------- the scroll columns ---------- */
function fillCol(el,vals){
  el.innerHTML=vals.map(v=>`<div class="eg-n">${String(v).padStart(2,'0')}</div>`).join('');
}
const MINS=Array.from({length:60},(_,i)=>i);
const SECS=[0,5,10,15,20,25,30,35,40,45,50,55];
fillCol($('eg-colMin'),MINS); fillCol($('eg-colSec'),SECS);

/* ⚠️ The list is NEVER rebuilt while a finger is on it — the handler only reads the
   scroll offset and sets opacity. Rebuilding under the gesture is what made an
   earlier picker in this project twitch once and then ignore the finger. */
function wireCol(el,vals,onPick){
  const rowH=()=>el.querySelector('.eg-n')?.offsetHeight||40;
  let t=0;
  const paint=()=>{
    const h=rowH(), i=el.scrollTop/h;
    el.querySelectorAll('.eg-n').forEach((n,k)=>{
      const d=Math.abs(k-i);
      n.style.opacity = d<.5 ? 1 : d<1.6 ? .30 : 0;   // solid, faded, gone
    });
  };
  el.addEventListener('scroll',()=>{
    paint();
    clearTimeout(t);
    t=setTimeout(()=>{ const k=Math.round(el.scrollTop/rowH()); onPick(vals[clamp(k,0,vals.length-1)]) },90);
  },{passive:true});
  el._paint=paint;
  el._goto=v=>{ const k=Math.max(0,vals.indexOf(v)); el.scrollTop=k*rowH(); paint() };
}
wireCol($('eg-colMin'),MINS,v=>{ S.min=v; save(); syncStart() });
wireCol($('eg-colSec'),SECS,v=>{ S.sec=v; save(); syncStart() });
function syncStart(){ $('eg-start').textContent = (S.min||S.sec)?'Start':'Set a time' }

/* ---------- screens ---------- */
let screen='set';
function go(name){
  screen=name;
  document.body.className=name;
  for(const [id,n] of [['scSet','set'],['scRun','run'],['scHatch','hatch']])
    $(id).classList.toggle('on',n===name);
  layout();
}

/* ---------- the run loop: one read of the rig per frame ---------- */
const conf=createConfetti($('eg-conf'));
/* ⚠️ THE POP IS UNTOUCHED. `makeDefaults()` is byte-for-byte the approved rig (rings,
   ticks, colours, speed, life) and stays that way — the only thing overridden is HOW
   MANY of them a burst fires, and that is not a dial, it is the same DENSITY carried
   onto a bigger canvas. `celebrate()` already scatters each pop across the whole
   canvas, so the field went from the badge to the phone the moment #conf did; two
   pops that read as a shower inside a 342px disc read as a sprinkle across 390x844,
   which is 2.8 times the area. Same pops per unit of screen, more screen. */
const BADGEAREA=342*342;                       // the disc the defaults were dialled in
function burstPops(){
  const r=$('eg-conf').getBoundingClientRect();
  const k=(r.width*r.height)/BADGEAREA;
  return clamp(Math.round(2*k),2,8);
}
let hatched=false;
function mmss(t){ const m=Math.floor(t/60), s=Math.floor(t%60);
  return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0') }
function tick(){
  requestAnimationFrame(tick);
  if(!RIG)return;
  const st=RIG.state();
  if(screen==='run'||screen==='hatch'){
    $('eg-clock').textContent=mmss(st.left);
    $('eg-hatchClock').textContent=mmss(st.left);
    drawPie(st.total?st.left/st.total:0);
  }
  // the clock running out IS the break — the rig owns that, we only follow it
  if(st.breaking&&screen==='run'&&!hatched){ hatched=true; go('hatch');
    if(!S.muteBell)/* end sound would fire here */0;
    setTimeout(()=>conf.celebrate({burstPops:burstPops()}),420);
  }
}
requestAnimationFrame(tick);

/* ---------- IT CRACKS A DIFFERENT WAY EVERY RUN ----------
   Andjroo, 2026-07-31: "we should have randomized the egg cracking, but I only ever
   see one version of this."
   Nothing was broken — the app had simply never chosen. `RIG.setPattern()` has always
   existed and timer.html never called it, so every run in this app got whatever the
   TUNING PAGE happened to be left on, saved in the rig's own localStorage. One egg,
   forever, and it was the tuning page's egg rather than a decision the app made.

   ⚠️ This reverses a rule that is still written in HANDOFF §1 — "the egg cracks apart
   the same way every time. No randomised outcome." That rule was protecting the
   AUTHORING (a pattern plays identically once chosen, so it can be dialled in); it
   was never about the app, and Andjroo has now made the app's call the other way.

   ⚠️ Rolled at Start, BEFORE go(). setPattern() re-cuts the halves, rebuilds the
   fragments and re-derives the landed pose — mid-run that would rebuild the egg
   underneath a countdown that is already breaking it.

   ⚠️ And never the same one twice running. A fair roll over five repeats about one
   run in five, and a repeat is the one outcome that reads as "it did not randomise" —
   which is the exact complaint this is fixing. Excluding the last one is derived from
   what he is judging (does it look random), not a dial. */
/* ⚠️ Both rolls avoid the last one the SAME way, and it is one helper rather than two,
   because the two pools behave differently at the edges: the crack pool is always 5,
   the character pool is whatever the kid ticked and is legitimately 1. Excluding the
   previous pick out of a pool of one leaves nothing to choose. */
function rollFrom(pool,last){
  if(!pool.length)return null;
  const p=pool.length>1?pool.filter(x=>x!==last):pool;
  return p[Math.floor(Math.random()*p.length)];
}
let lastPat=null, lastHero=null;
function rollPattern(){
  if(!RIG||!RIG.setPattern)return null;
  const n=rollFrom(CRACK_PATTERNS,lastPat);
  if(n!=null&&RIG.setPattern(n)){ lastPat=n; return n }
  return null;
}
function rollHero(){
  if(!RIG||!RIG.setHero)return null;
  const id=rollFrom(heroSet(),lastHero);
  if(id){ RIG.setHero(id); lastHero=id; return id }
  return null;
}

/* ---------- controls ---------- */
$('eg-start').onclick=()=>{
  const secs=S.min*60+S.sec; if(secs<1)return;
  hatched=false; conf.clear();
  /* ⚠️ Both rolls happen HERE, before go(). setPattern() re-cuts the halves and
     re-derives the landed pose, and the landing is framed off the CHARACTER's width
     (the gap is the hole it left) — so the character has to be settled before the
     break is built, not swapped in when the egg opens. */
  rollPattern(); rollHero();
  go('run'); RIG.go(secs);
};
let paused=false;
$('eg-btnPause').onclick=()=>{
  paused=!paused;
  if(paused)RIG.pause(); else RIG.resume();
  $('eg-icPause').innerHTML = paused
    ? `<path d="M7.4 4.9a1 1 0 0 1 1.5-.86l9.2 6.1a1 1 0 0 1 0 1.72l-9.2 6.1a1 1 0 0 1-1.5-.86z"/>`
    : `<rect x="6.4" y="4.6" width="4.2" height="14.8" rx="1.6"/><rect x="13.4" y="4.6" width="4.2" height="14.8" rx="1.6"/>`;
};
$('eg-btnStop').onclick=()=>{ paused=false; conf.clear(); RIG.reset(); go('set') };
$('eg-done').onclick  =()=>{ conf.stop(); conf.clear(); RIG.reset(); hatched=false; go('set') };
$('eg-stepUp').onclick=()=>RIG&&RIG.addTime(60);
$('eg-stepDn').onclick=()=>RIG&&RIG.addTime(-60);
$('eg-mMusic').onclick=()=>{ S.muteMusic=!S.muteMusic; save(); drawMute('mMusic',S.muteMusic) };
$('eg-mBell').onclick =()=>{ S.muteBell =!S.muteBell;  save(); drawMute('mBell', S.muteBell) };

/* ---------- the tray's egg is THE egg ----------
   Same source of truth as the shell the rig clips to, so the glyph cannot drift from
   the art the way the hand-drawn one had. Fitted to the 24 viewBox by HEIGHT — the egg
   is the taller axis, and fitting by width would leave it clipped top and bottom.
   ⚠️ Decimated. 720 points across 18px is ~40 points per pixel: all of them would be
   an 18KB `d` attribute describing detail no one can see, and the SVG rasteriser walks
   every one of them on every paint. Every 10th point still puts a vertex every 0.25px.
   ⚠️ The inset is HALF THE STROKE, not a margin. A path is stroked centred on itself,
   so a curve run to the edge of the box loses the outer half of its own line. */
const GLYPH_STROKE=1.9, GLYPH_BOX=24;
function fitEggGlyph(pts){
  const M=GLYPH_STROKE/2+.45;
  let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
  for(const [x,y] of pts){ if(x<x0)x0=x; if(y<y0)y0=y; if(x>x1)x1=x; if(y>y1)y1=y }
  const k=(GLYPH_BOX-2*M)/(y1-y0), w=(x1-x0)*k;
  const ox=(GLYPH_BOX-w)/2-x0*k, oy=M-y0*k;
  const at=([x,y])=>[x*k+ox, y*k+oy];

  const step=Math.max(1,Math.round(pts.length/72));
  const d=pts.filter((_,i)=>i%step===0).map(at)
             .map(([x,y],i)=>(i?'L':'M')+x.toFixed(2)+' '+y.toFixed(2)).join('')+'Z';

  /* The crack is measured off the egg rather than drawn beside it: it starts ON the
     outline, crosses, and ends ON the outline, which is the one thing the generated
     crack art is required to do (HANDOFF §0 — "every crack must START at the shell's
     outer edge and cut through the outline itself"). So the span is the egg's OWN
     width at that height, found from the same points. */
  const top=M, bot=GLYPH_BOX-M, yc=top+(bot-top)*.60;
  let xl=1e9, xr=-1e9;
  for(const p of pts){ const [x,y]=at(p);
    if(Math.abs(y-yc)<(bot-top)*.045){ if(x<xl)xl=x; if(x>xr)xr=x } }
  if(!(xr>xl))return {d};
  const n=4, dx=(xr-xl)/n, a=(bot-top)*.042;
  let c='M'+xl.toFixed(2)+' '+yc.toFixed(2);
  for(let i=1;i<=n;i++) c+='L'+(xl+dx*i).toFixed(2)+' '+(yc+(i%2?-a:a)).toFixed(2);
  return {d, crack:c};
}
fetch('/egg-outline.json?v='+BUILD).then(r=>r.json()).then(j=>{
  if(!j||!j.pts||!j.pts.length)return;
  const g=fitEggGlyph(j.pts);
  $('glyphEgg').setAttribute('d',g.d);
  if(g.crack)$('glyphCrack').setAttribute('d',g.crack);
}).catch(()=>{});   // the authored fallback stays on screen

/* ---------- the toast ----------
   One call, and it works out where to sit from what is already on screen: above the
   sheet that raised it, or off the bottom of the phone when nothing is open. */
let toastT=null;
function toast(msg){
  const t=$('eg-toast'); t.textContent=msg;
  const open=document.querySelector('.eg-sheet.on');
  const H=$('eg-app').clientHeight;
  t.style.bottom=(open?Math.round(open.getBoundingClientRect().height)+12
                      :Math.round(H*.07))+'px';
  t.classList.add('on');
  clearTimeout(toastT);
  toastT=setTimeout(()=>$('eg-toast').classList.remove('on'),2000);
}

/* ---------- sheets ---------- */
/* The close mark and the selected mark are the two things every sheet shares, and
   both were wrong in the same way: a font character standing in for a drawn shape.
   ⚠️ VERBATIM from @nimiq/style close.svg via the registry (`nq info close-button`)
   — a disc with the X knocked out of it by fill-rule:evenodd, so it is ONE path and
   the cross can never sit off-centre in its circle. Do not redraw it. */
const XICON='<svg width="30" height="30" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M3.528 3.52c4.683-4.684 12.275-4.686 16.96-.005 4.678 4.69 4.678 12.28 0 16.97-4.685 4.68-12.277 4.678-16.96-.005-4.682-4.684-4.682-12.276 0-16.96zm13.145 13.133a1 1 0 0 0 .036-1.374l-3.11-3.11a.25.25 0 0 1 0-.352l3.11-3.11a1 1 0 1 0-1.414-1.415l-3.11 3.11a.25.25 0 0 1-.354 0l-3.11-3.11a1 1 0 0 0-1.41 1.415l3.11 3.11a.249.249 0 0 1 0 .353l-3.11 3.109a1 1 0 0 0 0 1.415c.396.38 1.021.38 1.416 0l3.109-3.11a.252.252 0 0 1 .354 0l3.11 3.11a1 1 0 0 0 1.373-.041z" fill="currentColor"/></svg>';
const TICK='<i class="eg-tick"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.8 9.6 17.4 19 7.2"/></svg></i>';
document.querySelectorAll('.eg-sheet').forEach(s=>{
  const b=document.createElement('button');
  b.className='sclose'; b.setAttribute('aria-label','Close'); b.innerHTML=XICON;
  b.onclick=()=>sheet(null);
  s.insertBefore(b,s.firstChild);
});
function sheet(id){
  document.querySelectorAll('.eg-sheet').forEach(s=>s.classList.toggle('on',s.id===id));
  $('eg-scrim').classList.toggle('on',!!id);
}
$('eg-scrim').onclick=()=>sheet(null);
/* ⚠️ The marker is on the CELL, so the CELL is what gets toggled. Toggling only the
   tile is how the badge ends up trapped under the tile's own clip — see the .tick
   note in the CSS. One helper, so the three grids cannot drift apart again. */
function markSel(root,sel,el){
  root.querySelectorAll(sel).forEach(p=>{
    const on=p===el;
    p.classList.toggle('on',on);
    const c=p.closest('.eg-cell'); if(c)c.classList.toggle('on',on);
  });
}
$('eg-plus').onclick=()=>sheet('shReminder');
document.querySelectorAll('[data-sheet]').forEach(b=>b.onclick=()=>
  sheet({egg:'shEgg',music:'shMusic',bg:'shBg'}[b.dataset.sheet]));

/* reminder icons — monoline, in the navy family. Illustrated set is an art pass. */
const GLYPH={
  goodjob:'<path d="M7 11.5v8.5H4.6a1.6 1.6 0 0 1-1.6-1.6v-5.3A1.6 1.6 0 0 1 4.6 11.5z"/><path d="M7 11.5 12.3 3a2.2 2.2 0 0 1 3.5 2.4L14.4 9.4h4.9a2 2 0 0 1 2 2.5l-1.6 6.4a2.4 2.4 0 0 1-2.3 1.7H7z"/>',
  hooray:'<circle cx="12" cy="12" r="9.3"/><path d="M8 10.4h.02M16 10.4h.02"/><path d="M7.6 14.2a5 5 0 0 0 8.8 0z"/>',
  love:'<path d="M12 20.4S3.4 15.3 3.4 9.3A4.6 4.6 0 0 1 12 6.9a4.6 4.6 0 0 1 8.6 2.4c0 6-8.6 11.1-8.6 11.1z"/>',
  shoes:'<path d="M3 16.6h12.4l4.6 1.8a2 2 0 0 1 1 1.7v.5H3z"/><path d="M3 16.6V8.2a1 1 0 0 1 1.5-.9L8 9.3l2.6-2 2.4 5.6"/>',
  socks:'<path d="M5.4 3h4.4v8.8l-3.2 4a2.6 2.6 0 1 0 4 3.3l3.3-4.1"/><path d="M14.2 3h4.4v9.2"/>',
  bath:'<path d="M3 12.4h18v2.2a4.6 4.6 0 0 1-4.6 4.6H7.6A4.6 4.6 0 0 1 3 14.6z"/><path d="M6.4 12.4V5.8a2.4 2.4 0 0 1 4.6-1M6 21l-1 1.6M18 21l1 1.6"/>',
  bed:'<path d="M12.6 2.6a7.4 7.4 0 1 0 8.8 8.8 7.6 7.6 0 0 1-8.8-8.8z"/><path d="M4.4 5.6h3.4L4.4 9h3.4"/>',
  tidy:'<path d="M4.4 8.6h15.2l-1.1 11a2 2 0 0 1-2 1.8H7.5a2 2 0 0 1-2-1.8z"/><path d="M3 8.6h18M9.4 8.6V5.4a1.6 1.6 0 0 1 1.6-1.6h2a1.6 1.6 0 0 1 1.6 1.6v3.2"/>',
  teeth:'<path d="M7 3.4c2 0 2.4 1.2 5 1.2s3-1.2 5-1.2a3 3 0 0 1 3 3.3c0 3.4-1.3 4.2-2 8.2-.5 3-1.1 5.5-2.6 5.5s-1.7-3.6-3.4-3.6-1.9 3.6-3.4 3.6-2.1-2.5-2.6-5.5c-.7-4-2-4.8-2-8.2A3 3 0 0 1 7 3.4z"/>',
  eat:'<path d="M6.4 3v7.4a2.4 2.4 0 0 0 4.8 0V3M8.8 10.4V21"/><path d="M17.2 21v-7.6a4 4 0 0 1-1.4-3.2V6.6a3.6 3.6 0 0 1 2.8-3.5V21z"/>',
  screenoff:'<rect x="2.6" y="4" width="18.8" height="13" rx="2.6"/><path d="M8 21h8M12 17v4"/><path d="M12 7.6v3.2M9.6 8.4a3.4 3.4 0 1 0 4.8 0"/>',
};
/* The drawn art wins wherever it exists, and the monoline glyph stands in where it
   does not — so the sheet is never a grid of broken images while a batch is still
   generating. `icons/index.json` is written by tools/cut_icons.py, which is the one
   list: the cut and the sheet cannot disagree about what got drawn. */
let ART=new Set();
function buildRemGrid(){
  $('eg-remGrid').innerHTML=REMINDERS.map(([k,label])=>`
    <div class="eg-cell ${S.reminder===k?'on':''}">
      <button class="eg-pick ${S.reminder===k?'on':''}" data-rem="${k}">
      ${k==='off' ? '<span class="eg-off">Off</span>'
        : ART.has(k) ? `<img src="/icons/${k}.png?v=${BUILD}" alt="${label}" loading="lazy">`
        : `<svg width="60%" height="60%" viewBox="0 0 24 24" fill="none" stroke="#2C3149"
             stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round">${GLYPH[k]||''}</svg>`}
    </button>${TICK}<div class="eg-plabel">${label}</div></div>`).join('');
}
buildRemGrid();
fetch('/icons/index.json?v='+BUILD).then(r=>r.json())
  .then(j=>{ ART=new Set((j.icons||[]).map(i=>i.slug)); buildRemGrid(); paintPlus() })
  .catch(()=>{});
$('eg-remGrid').onclick=e=>{ const b=e.target.closest('[data-rem]'); if(!b)return;
  S.reminder=b.dataset.rem; save();
  markSel($('eg-remGrid'),'.pick',b);
  paintPlus();
};
// the drawn icons carry their own generous margin, so they can run to the rim
$('eg-remGrid').classList.add('eg-artgrid');

/* the bubble shows WHAT was chosen, not THAT something was */
function paintPlus(){
  const on=S.reminder!=='off' && ART.has(S.reminder);
  $('eg-plus').classList.toggle('set',on);
  $('eg-plusGlyph').style.display=on?'none':'';
  $('eg-plusIcon').style.display=on?'':'none';
  if(on)$('eg-plusIcon').setAttribute('href','/icons/'+S.reminder+'.png?v='+BUILD);
}
paintPlus();

/* ---------- the kid's own characters ----------
   Andjroo, 2026-07-31: "the kid should be able to add as many characters as they
   want, and there should be a place to take a picture."
   ⚠️ THEIR OWN KEY, not S. A photo is orders of magnitude bigger than every setting
   put together, and localStorage fails by THROWING on quota — one photo too many
   inside `kidtimer2` and the write that also carries the timer, the background and
   the reminder is the one that fails. Split, so a full camera roll can never cost
   the parent their settings.
   ⚠️ 320px TALL, because that is the roster's own height (tools/cut_heroes.py) and
   the rig sizes a character by `eggH/artH`. Store a phone's 3024px photo and it
   would land in the shells a tenth of the size of every drawn one. */
const PLS=LS+'.photos';
const HERO_H=320;
let PHOTOS=[];
try{ PHOTOS=JSON.parse(localStorage.getItem(PLS)||'[]') }catch(e){ PHOTOS=[] }
const savePhotos=()=>{ try{ localStorage.setItem(PLS,JSON.stringify(PHOTOS)); return true }
                       catch(e){ console.warn('photo not saved: storage full'); return false } };

const CAMICON=`<svg width="46%" height="46%" viewBox="0 0 24 24" fill="none" stroke="#8C93A3"
   stroke-width="1.9" stroke-linejoin="round" stroke-linecap="round">
   <path d="M3 8.4h3.1l1.5-2.4h8.8l1.5 2.4H21a1.4 1.4 0 0 1 1.4 1.4v8.4A1.4 1.4 0 0 1 21 20H3a1.4 1.4 0 0 1-1.4-1.4V9.8A1.4 1.4 0 0 1 3 8.4z"/>
   <circle cx="12" cy="13.8" r="3.7"/></svg>`;

/* ---------- MANY CHARACTERS, ONE OF THEM COMES OUT ----------
   Andjroo, 2026-07-31: "I want the kid to be able to select multiple characters, so
   that way it's randomized as well." So this grid is the only multi-select one in the
   app: the sheet's own sub-line already said "who CAN come out of the egg", which is a
   set, and it had been behaving like a single choice.

   ⚠️ THE SET CAN NEVER BE EMPTY. Nothing selected means nothing can hatch, and the
   failure would land at the end of a real countdown a child has waited out. Tapping
   the last remaining one is a no-op rather than a fifth thing to handle at Start. */
function heroSet(){
  const live=new Set([...heroes.map(h=>h.id), ...PHOTOS.map(p=>p.id)]);
  // an id can go away: a photo the storage dropped, or art removed from the roster
  let sel=(S.heroes||[]).filter(id=>live.has(id));
  if(!sel.length)sel=[heroes[0]&&heroes[0].id].filter(Boolean);
  return sel;
}
function buildEggGrid(){
  const sel=new Set(heroSet());
  const all=[...heroes.map(h=>({id:h.id,name:h.name,src:'/rive-kit/individual-pngs/'+h.id+'.png',photo:false})),
             ...PHOTOS.map(p=>({id:p.id,name:p.name,src:p.src,photo:true}))];
  $('eg-eggGrid').innerHTML=all.map(h=>`
    <div class="eg-cell ${sel.has(h.id)?'on':''}">
      <button class="eg-pick ${h.photo?'eg-photopick ':''}${sel.has(h.id)?'on':''}" data-hero="${h.id}"
              role="checkbox" aria-checked="${sel.has(h.id)}">
      <img src="${h.src}" alt="${h.name}" loading="lazy">
    </button>${TICK}<div class="eg-plabel">${h.name}</div></div>`).join('')
    + `<div class="eg-cell"><button class="eg-pick" data-shoot aria-label="take a picture">
         ${CAMICON}</button><div class="eg-plabel">Take a photo</div></div>`;
  $('eg-dotEgg').style.display=sel.size?'block':'none';
}
$('eg-eggGrid').onclick=e=>{
  if(e.target.closest('[data-shoot]')){ $('eg-shoot').click(); return }
  const b=e.target.closest('[data-hero]'); if(!b)return;
  const id=b.dataset.hero, sel=heroSet(), i=sel.indexOf(id);
  if(i>=0){ if(sel.length===1)return; sel.splice(i,1) } else sel.push(id);
  S.heroes=sel; save();
  const on=sel.includes(id);
  b.classList.toggle('on',on); b.setAttribute('aria-checked',on);
  b.closest('.eg-cell').classList.toggle('on',on);
  $('eg-dotEgg').style.display=sel.length?'block':'none';
};
/* `capture` asks the phone for the camera and is ignored on a desktop, where the
   same input is a file picker — one control, both places, no branch. */
$('eg-shoot').onchange=e=>{
  const f=e.target.files&&e.target.files[0]; if(!f)return;
  const url=URL.createObjectURL(f), im=new Image();
  im.onload=()=>{
    const k=HERO_H/im.naturalHeight;
    const c=document.createElement('canvas');
    c.width=Math.max(1,Math.round(im.naturalWidth*k)); c.height=HERO_H;
    c.getContext('2d').drawImage(im,0,0,c.width,c.height);
    URL.revokeObjectURL(url);
    const id='photo-'+PHOTOS.length+'-'+Math.round(performance.now());
    const src=c.toDataURL('image/png');
    PHOTOS.push({id,name:'Photo '+(PHOTOS.length+1),src});
    if(!savePhotos())PHOTOS.pop();
    else{
      /* ⚠️ Registered with the rig BEFORE it joins the set — heroSet() drops ids the
         rig has never heard of, so ticking it first would tick it and lose it. */
      const add=(RIG&&RIG.addHero)?RIG.addHero(id,'Photo '+PHOTOS.length,src)
                                  :Promise.resolve(false);
      // taken FROM this sheet, so it is in the mix. Untick it like any other tile.
      Promise.resolve(add).then(()=>{
        S.heroes=[...heroSet(),id]; save(); buildEggGrid();
      });
    }
  };
  im.onerror=()=>URL.revokeObjectURL(url);
  im.src=url;
  e.target.value='';
};

$('eg-musicBody').innerHTML=`
  <div class="eg-lane"><h3>While the timer runs</h3><div class="eg-opts" id="eg-laneDuring"></div></div>
  <div class="eg-lane"><h3>When it ends</h3><div class="eg-opts" id="eg-laneEnd"></div></div>`;
function buildLane(id,list,key){
  $(id).innerHTML=list.map(([k,l])=>
    `<button class="eg-opt ${S[key]===k?'on':''}" data-v="${k}">${l}</button>`).join('');
  $(id).onclick=e=>{ const b=e.target.closest('[data-v]'); if(!b)return;
    S[key]=b.dataset.v; save();
    $(id).querySelectorAll('.eg-opt').forEach(o=>o.classList.toggle('on',o===b));
    $('eg-dotMusic').style.display=(S.during!=='none')?'block':'none';
    /* ⚠️ The choice is still SAVED. The lists are named and the effects are not made
       yet, so the honest behaviour is to remember what was picked and say the sound
       is not here — not to refuse the tap. Turning one off needs no apology. */
    if(b.dataset.v!=='none')toast('Coming soon');
  };
}
buildLane('laneDuring',DURING,'during'); buildLane('laneEnd',ENDING,'end');
$('eg-dotMusic').style.display=(S.during!=='none')?'block':'none';

/* The grid is filled out to whole rows of four so the sheet already has the shape it
   will have once the art lands, rather than re-flowing under Andjroo when it does. */
const BGSLOTS=Math.max(12,Math.ceil(BGS.length/4)*4);
$('eg-bgGrid').innerHTML=BGS.map(([k,l])=>`
  <div class="eg-cell"><button class="eg-bgpick ${S.bg===k?'on':''}" data-bg="${k}">
    <img src="/bg/${k}.jpg" alt="${l}"></button><div class="eg-plabel">${l}</div></div>`).join('')
  + Array.from({length:BGSLOTS-BGS.length},()=>
      `<div class="eg-cell"><div class="eg-bgslot"></div><div class="eg-plabel">&nbsp;</div></div>`).join('');
$('eg-bgGrid').onclick=e=>{ const b=e.target.closest('[data-bg]'); if(!b)return;
  S.bg=b.dataset.bg; save(); $('eg-bgImg').src='/bg/'+S.bg+'.jpg';
  $('eg-bgGrid').querySelectorAll('.eg-bgpick').forEach(p=>p.classList.toggle('on',p===b));
};
$('eg-bgImg').src='/bg/'+S.bg+'.jpg';

/* ---------- review strip ---------- */
document.querySelectorAll('[data-pie]').forEach(b=>{
  b.classList.toggle('on',b.dataset.pie===S.pie);
  b.onclick=()=>{ S.pie=b.dataset.pie; S.pieXY=null; save();
    document.querySelectorAll('[data-pie]').forEach(o=>o.classList.toggle('on',o===b));
    layout(); };   // the clock's own size depends on which one this is
});
// rolls too — it is the button Andjroo presses to look at the hatch, and a review
// control that skipped the roll would show him the same egg and the same animal
$('eg-dvHatch').onclick=()=>{ if(screen!=='run'){ rollPattern(); rollHero(); go('run'); RIG.go(3) }
                           else RIG.hatchNow() };
$('eg-dvReset').onclick=()=>{ conf.clear(); RIG.reset(); hatched=false; paused=false; go('set') };

/* ---------- boot ---------- */
addEventListener('resize',layout);
syncStart(); layout();
// the columns land on the saved time once they have a measured row height
requestAnimationFrame(()=>{ $('eg-colMin')._goto(S.min); $('eg-colSec')._goto(S.sec); });
window.TIMER={build:BUILD, go, sheet, state:()=>({screen,S}), conf};

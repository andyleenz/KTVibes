import {classicRemote,toastParts,emptyNote,secondsLeft} from './classic-remote.js';
import {$,el,connect,api,clock,throttle,prepLabel,syncRanges,REDUCED,thumbnail} from './shared.js';
let state,classicUi;
const SPRING='cubic-bezier(.38,1.21,.22,1)';
const haptic=pattern=>{try{navigator.vibrate?.(pattern);}catch{}};
function showImage(img,src){if(img.getAttribute('src')!==src){if(src)img.src=src;else img.removeAttribute('src');}img.hidden=!src;}
// One toast for every message; an action (Undo) keeps it up a little longer.
let toastTimer;
function toast(text,action,kind){
 // Classic dresses the same message as the machine's toast: a label key, the title in bold, a Korean line.
 if(document.body.dataset.theme==='classic'){const parts=toastParts(text,kind);$('toast-key').textContent=parts.key;$('toast-key').className=`toast-key classic-only ${parts.tone}`;$('toast-text').replaceChildren(...parts.body);$('toast').classList.toggle('err',kind==='err');}
 else $('toast-text').textContent=text;
 $('toast').style.setProperty('--toast-ms',`${action?6000:2600}ms`);$('toast-action').hidden=!action;
 if(action){$('toast-action').textContent=action.label;$('toast-action').onclick=()=>{$('toast').classList.remove('on');action.run();};}
 $('toast').classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('on'),action?6000:2600);
}
const send=connect('remote',render,message=>toast(message,undefined,'err'));
function render(next){
 const before=state;state=next;state.received=Date.now()/1000;
 // The header pill reports the TV, since that decides whether anything can play; banners under it say what to do.
 // (Classic keeps its own wording in the pill and no banners.)
 const tv=state.player_connected;
 $('connection').textContent=state.theme==='classic'?(!tv?'Open /tv on a device':state.player_audio?'Device ready':'Tap Enable sound on the device'):tv?'TV connected':'TV offline';
 $('connection').classList.toggle('warn',!state.player_audio);$('connection').classList.toggle('off',!tv);
 $('tv-lost').hidden=tv||!state.current;$('tv-mute').hidden=!tv||state.player_audio;
 document.body.dataset.theme=state.theme||'default';showNow(!before);showControls(before);showQueue(before);showClassic();classicUi?.render(state);
 const ready=[state.current,...state.upcoming].filter(i=>i?.status==='ready').map(i=>i.key).join();
 if(ready!==readyKeys){readyKeys=ready;loadRecent();loadLibrary();classicUi?.loadBook();}
 markQueued();
}
// Now playing: a card at the top, handing over to the dock once scrolled away.
function showNow(first){
 const c=state.current,art=c?thumbnail(c.id):'';
 showHero(!!c,first);$('hero').classList.toggle('paused',!state.playing);$('hero').classList.toggle('offline',!state.player_connected);$('hero-state').textContent=state.playing?'Now singing':'Paused';
 for(const id of ['hero-play','dock-play']){$(id).classList.toggle('playing',!!(c&&state.playing));$(id).setAttribute('aria-label',state.playing?'Pause':'Play');$(id).disabled=!c;}
 // The card keeps its last song while it folds away.
 for(const id of c?['hero-art','hero-glow','dock-art','sheet-art']:['dock-art','sheet-art'])showImage($(id),art);
 if(c){$('hero-title').textContent=c.title;$('hero-artist').textContent=c.artist;}$('hero-length').textContent=$('length').textContent=clock(c?.duration);
 $('dock-title').textContent=$('sheet-title').textContent=c?.title||'Nothing playing';$('dock-artist').textContent=c?.artist||'';
 showPosition();
}
// The card unfolds when a song starts on an empty stage and folds away when the stage empties:
// height, padding and margin open with a soft spring while the card fades and scales up.
let heroShown=false;
function showHero(on,first){
 if(on===heroShown)return;heroShown=on;
 const hero=$('hero');for(const animation of hero.getAnimations())animation.cancel();
 if(first||REDUCED.matches){hero.hidden=!on;return;}
 hero.hidden=false;
 const closed={height:'0px',paddingTop:'0px',paddingBottom:'0px',marginTop:'0px',opacity:0,transform:'scale(.94)'},open={height:`${hero.offsetHeight}px`,opacity:1,transform:'none'};
 const animation=on?hero.animate([closed,{opacity:1,offset:.6},open],{duration:600,easing:SPRING}):hero.animate([open,{opacity:0,offset:.5},closed],{duration:400,easing:'cubic-bezier(.4,0,.2,1)'});
 if(!on)animation.onfinish=()=>{if(!heroShown)hero.hidden=true;};
}
// Estimate the TV position between its two-second progress reports.
let scrubbing=false;
function showPosition(){
 if(!state)return;
 const live=state.current&&state.playing&&state.position>0?Date.now()/1000-state.received:0;
 const position=Math.min(state.position+live,state.current?.duration||0),fraction=state.current?.duration?position/state.current.duration:0;
 for(const id of ['hero-bar','dock-bar'])$(id).style.setProperty('--p',fraction);
 $('hero-position').textContent=clock(position);$('hero-bar').setAttribute('aria-valuetext',clock(position));
 if(!scrubbing){$('scrub').value=position;$('position').textContent=clock(position);syncRanges();}
}
setInterval(showPosition,500);
$('hero-bar').onclick=e=>{if(!state?.current)return;const box=e.currentTarget.getBoundingClientRect();send({action:'seek',position:Math.max(0,Math.min(1,(e.clientX-box.left)/box.width))*state.current.duration});};
$('hero-bar').onkeydown=e=>{const step={ArrowLeft:-5,ArrowRight:5}[e.key];if(step&&state?.current){e.preventDefault();send({action:'seek',position:state.position+step});}};
$('scrub').oninput=()=>{scrubbing=true;$('position').textContent=clock(Number($('scrub').value));};
$('scrub').onchange=()=>{scrubbing=false;send({action:'seek',position:Number($('scrub').value)});};
const playPause=()=>{haptic(8);send({action:state?.playing?'pause':'play'});};
$('hero-play').onclick=$('dock-play').onclick=playPause;
$('skip').onclick=()=>{haptic(12);send({action:'skip'});};
$('tv-retry').onclick=()=>location.reload();
// The dock hides while the card is on screen; when the card leaves, the dock rises and its art drops in.
let heroVisible=false;
new IntersectionObserver(([entry])=>{
 const was=heroVisible;heroVisible=entry.isIntersecting;$('dock').classList.toggle('away',heroVisible);
 if(was&&!heroVisible&&!REDUCED.matches){
  $('dock-art').animate([{transform:'translateY(-24px) scale(1.2)',opacity:0},{transform:'none',opacity:1}],{duration:450,delay:120,easing:'cubic-bezier(.34,1.3,.64,1)',fill:'backwards'});
  $('dock').querySelector('.info').animate([{opacity:0,transform:'translateX(-8px)'},{opacity:1,transform:'none'}],{duration:350,delay:200,easing:'ease-out',fill:'backwards'});
 }
},{rootMargin:'0px 0px -40px 0px'}).observe($('hero'));
$('dock-queue').onclick=()=>$('queue').scrollIntoView({behavior:REDUCED.matches?'auto':'smooth',block:'center'});
// Reactions float up on this phone and on the TV. Quick taps add up into one "×3" note.
for(const button of document.querySelectorAll('.react'))button.onclick=()=>{
 const emoji=button.dataset.emoji;send({action:'react',value:emoji});haptic(6);
 const box=button.getBoundingClientRect(),count=REDUCED.matches?1:5;
 for(let i=0;i<count;i++){
  const float=el('span',emoji,'float');float.style.left=`${box.left+box.width/2-15}px`;float.style.top=`${box.top}px`;document.body.append(float);
  const drift=(Math.random()-.5)*90,rise=160+Math.random()*120,spin=(Math.random()-.5)*50;
  float.animate([{transform:'scale(.4)',opacity:0},{transform:`translate(${drift*.3}px,-40px) scale(1.25) rotate(${spin*.3}deg)`,opacity:1,offset:.2},{transform:`translate(${drift}px,-${rise}px) scale(.9) rotate(${spin}deg)`,opacity:0}],
   {duration:REDUCED.matches?300:1100+Math.random()*400,delay:i*70,easing:'cubic-bezier(.2,.7,.3,1)',fill:'both'}).onfinish=()=>float.remove();
 }
 if(!REDUCED.matches)button.animate([{transform:'scale(1)'},{transform:'scale(1.3) rotate(-8deg)'},{transform:'scale(1)'}],{duration:400,easing:'cubic-bezier(.42,1.67,.21,.9)'});
 clearTimeout(button.timer);button.taps=(button.taps||0)+1;
 button.timer=setTimeout(()=>{toast(`Sent ${emoji}${button.taps>1?` ×${button.taps}`:''} to the device`);button.taps=0;},600);
};
// Controls sheet: mix, key, speed, TV display and lyric fixes.
function showControls(before){
 for(const id of ['skip','earlier','later','lyric-version','scrub','key-down','key-up'])$(id).disabled=!state.current;
 $('scrub').max=state.current?.duration||1;
 for(const [id,value] of [['vocal',state.vocal],['music',state.music],['speed',state.speed],['lyric-scale',state.lyric_scale]]){
  if(document.activeElement!==$(id)&&!gliding)$(id).value=value;$(`${id}-value`).textContent=`${Math.round(value*100)}%`;
 }
 for(const b of document.querySelectorAll('.presets button'))b.setAttribute('aria-pressed',Math.abs(b.dataset.vocal-state.vocal)<.005&&Math.abs(b.dataset.music-state.music)<.005);
 $('key-down').disabled||=state.key<=-6;$('key-up').disabled||=state.key>=6;
 if(state.key!==before?.key)rollKey(state.key,before?state.key-before.key:0);
 $('offset-value').textContent=`${state.offset>=0?'+':''}${state.offset.toFixed(1)}s`;
 for(const seg of SEGMENTED){
  for(const b of seg.querySelectorAll('button')){b.setAttribute('aria-pressed',b.dataset.value===state[seg.dataset.action]);if(seg.dataset.action==='guide')b.hidden=!(state.guides||[]).includes(b.dataset.value);}
  if(document.body.classList.contains('sheet-open')||state.theme==='classic')placePill(seg);  // openSheet measures the rest; in Classic the settings are a page
 }
 syncRanges();
}
function rollKey(key,direction){
 const roll=$('roll'),old=roll.lastElementChild,next=el('span',key>0?`+${key}`:String(key));
 // Quick taps: drop anything still rolling out, roll the newest number away.
 while(roll.firstElementChild!==old)roll.firstElementChild.remove();
 roll.append(next);
 if(direction&&!REDUCED.matches){
  const d=Math.sign(direction);
  old.animate([{transform:'none',opacity:1},{transform:`translateY(${-60*d}px) scale(.6)`,opacity:0}],{duration:350,easing:'cubic-bezier(.4,0,.2,1)',fill:'forwards'}).onfinish=()=>old.remove();
  next.animate([{transform:`translateY(${60*d}px) scale(.6)`,opacity:0},{transform:'none',opacity:1}],{duration:500,easing:'cubic-bezier(.34,1.56,.64,1)'});
 }else old.remove();
 $('key-note').classList.toggle('orig',key===0);$('key-note').textContent=key===0?'Original key':`${Math.abs(key)} semitone${Math.abs(key)>1?'s':''} ${key>0?'higher':'lower'}`;
}
$('key-down').onclick=()=>{haptic(8);send({action:'key',value:state.key-1});};
$('key-up').onclick=()=>{haptic(8);send({action:'key',value:state.key+1});};
$('key-reset').onclick=$('key-reset-link').onclick=()=>{send({action:'speed',value:1});send({action:'key',value:0});};
for(const [id,action] of [['vocal','vocal'],['music','music'],['speed','speed'],['lyric-scale','lyric_scale']]){const sendValue=throttle(value=>send({action,value}));$(id).oninput=()=>sendValue(Number($(id).value));}
// Presets set both sliders, gliding there so the change is visible; A cappella is the singer alone.
let gliding=false;
for(const b of document.querySelectorAll('.presets button'))b.onclick=()=>{
 const to=[Number(b.dataset.vocal),Number(b.dataset.music)],from=[Number($('vocal').value),Number($('music').value)],start=performance.now();
 haptic(6);send({action:'vocal',value:to[0]});send({action:'music',value:to[1]});
 if(REDUCED.matches)return;
 gliding=true;
 const step=now=>{
  const k=Math.min(1,(now-start)/350),e=1-(1-k)**3;
  $('vocal').value=from[0]+(to[0]-from[0])*e;$('music').value=from[1]+(to[1]-from[1])*e;syncRanges();
  if(k<1)requestAnimationFrame(step);else{gliding=false;if(state)showControls(state);}
 };
 requestAnimationFrame(step);
};
// Segmented: room display settings and the pronunciation guide.
const SEGMENTED=document.querySelectorAll('.seg');
function placePill(seg){
 const on=seg.querySelector('[aria-pressed=true]:not([hidden])'),pill=seg.querySelector('.pill');pill.hidden=!on;
 if(!on||!on.offsetWidth)return;
 pill.style.width=`${on.offsetWidth}px`;pill.style.transform=`translateX(${on.offsetLeft-3}px)`;
 // Slide only once the pill has a place, so it doesn't sweep in from the left on load.
 if(!seg.classList.contains('ready'))requestAnimationFrame(()=>seg.classList.add('ready'));
}
for(const seg of SEGMENTED)seg.onclick=e=>{const b=e.target.closest('button');if(b){haptic(6);send({action:seg.dataset.action,value:b.dataset.value});}};
// A control measured while hidden (the Classic settings tab, a closed sheet) gets its pill once it has a size.
addEventListener('resize',()=>SEGMENTED.forEach(placePill));
{const sized=new ResizeObserver(entries=>entries.forEach(entry=>placePill(entry.target)));SEGMENTED.forEach(seg=>sized.observe(seg));}
$('earlier').onclick=()=>send({action:'offset',delta:-0.5});$('later').onclick=()=>send({action:'offset',delta:0.5});
$('lyric-version').onclick=()=>state?.current&&pickLyrics(state.current);
function openSheet(){document.body.classList.add('sheet-open');$('sheet').inert=false;haptic(8);requestAnimationFrame(()=>SEGMENTED.forEach(placePill));}
function closeSheet(){document.body.classList.remove('sheet-open');$('sheet').inert=true;}
$('open-controls').onclick=$('dock-now').onclick=$('dock-settings').onclick=()=>document.body.dataset.theme==='classic'?classicUi.setTab('settings'):openSheet();
$('scrim').onclick=$('sheet-handle').onclick=closeSheet;
// Sound and Screen tabs split the sheet (Default only; Classic's 설정 page shows every group).
const PANES=document.querySelectorAll('.tabs2 button');
for(const b of PANES)b.onclick=()=>{haptic(6);$('sheet').dataset.pane=b.dataset.pane;for(const t of PANES)t.setAttribute('aria-selected',t===b);$('sheet').scrollTop=0;};
// Classic theme: room time in Settings. Classic is always two-line lyrics.
function showClassic(){const on=state.theme==='classic';$('room-time').hidden=!on;document.querySelector('[data-action=lyric_mode]').closest('.seg-row').hidden=on;roomLeft();}
function roomLeft(){if(!state?.room_ends)return;const left=secondsLeft(state),end=new Date(state.room_ends*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 if(state.theme==='classic'){const lcd=el('span',String(Math.ceil(left/60)).padStart(3,'0'),'lcd');lcd.dataset.ghost='888';$('room-left').replaceChildren(lcd,el('span','분','u'));$('room-time').classList.toggle('up',!left);$('room-end').textContent=left?`종료 예정\n${end}`:'시간 종료\nTIME\'S UP';return;}
 $('room-left').textContent=left?`${Math.ceil(left/60)}분 left`:'Time is up';$('room-end').textContent=`${end} 종료`;}
setInterval(roomLeft,1000);
for(const b of document.querySelectorAll('[data-minutes]'))b.onclick=()=>{haptic(6);send({action:'add_time',minutes:+b.dataset.minutes});};
addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('.lyric-sheet'))closeSheet();});
// Swipe a sheet down to dismiss it, as on iOS. A drag from the handle or the top of the sheet, or from anywhere
// once its content is scrolled to the top, carries the sheet with the finger while the scrim fades; letting go past
// 30% of its height, or with a downward flick, closes it, otherwise it springs back. Sliders keep their drags.
function dragToClose(panel,close,fade,scroller=panel,allowed=()=>true){
 let d=null;
 panel.addEventListener('pointerdown',e=>{
  if(d||e.pointerType==='mouse'&&e.button||!allowed()||e.target.closest('input[type=range]'))return;
  const top=e.clientY-panel.getBoundingClientRect().top<56||e.target.closest('.handle');
  if(!top&&scroller.scrollTop>0)return;
  d={id:e.pointerId,x:e.clientX,y0:e.clientY,y:0,on:false,last:{y:e.clientY,t:e.timeStamp}};d.prev=d.last;
 });
 panel.addEventListener('pointermove',e=>{
  if(e.pointerId!==d?.id)return;
  const dx=e.clientX-d.x,dy=e.clientY-d.y0;
  if(!d.on){
   if(dy<-6||Math.abs(dx)>8&&Math.abs(dx)>Math.abs(dy)){d=null;return;}  // scrolling up or sideways: not a dismiss
   if(dy<6)return;
   d.on=true;try{panel.setPointerCapture(e.pointerId);}catch{}panel.style.transition='none';
  }
  d.prev=d.last;d.last={y:e.clientY,t:e.timeStamp};
  d.y=dy>0?dy:-12*(1-Math.exp(dy/40));  // upward only a little rubber band
  panel.style.transform=`translateY(${d.y}px)`;fade(1-Math.max(0,d.y)/panel.offsetHeight);
 });
 // Once the sheet is following the finger, the page (or the sheet's own content) must not scroll as well.
 panel.addEventListener('touchmove',e=>{if(d?.on)e.preventDefault();},{passive:false});
 const end=e=>{
  if(e.pointerId!==d?.id)return;const {on,y,last,prev}=d;d=null;if(!on)return;
  const speed=(last.y-prev.y)/Math.max(1,last.t-prev.t);
  panel.style.transition='';fade(null);
  if(y>panel.offsetHeight*.3||speed>.5&&y>0)close();else panel.style.transform='';
 };
 panel.addEventListener('pointerup',end);panel.addEventListener('pointercancel',end);
}
dragToClose($('sheet'),()=>{$('sheet').style.transform='';closeSheet();},f=>{$('scrim').style.transition=f==null?'':'none';$('scrim').style.opacity=f??'';},$('sheet'),()=>document.body.dataset.theme!=='classic');
// Queue. Rebuilt only when its songs or statuses change, so position reports never swap a button
// out from under a tap; preparation progress updates in place. A drag holds rebuilds until it ends.
let queueShape,dragging=null;
const RING=2*Math.PI*23;
const statusText=item=>{if(item.status==='ready')return 'Ready';if(item.status==='error')return 'Error preparing';const {percent}=prepLabel(item);return percent==null?'Preparing':`Preparing ${percent}%`;};
// Past five songs the Default queue folds the rest behind "Show N more".
const FOLD=5;let queueOpen=false;
// Classic shows the machine's Korean status beside it.
const STATUS_KO={queued:'다운로드 대기',downloading:'다운로드 중',separating:'보컬 분리 중',syncing:'가사 찾는 중',ready:'준비 완료',error:'준비 실패'};
const statusKo=(item,index)=>index===0&&item.status==='ready'?'다음곡':STATUS_KO[item.status]||'';
function showQueue(before){
 const count=state.upcoming.length,classic=state.theme==='classic';$('queue-count').textContent=$('dock-count').textContent=count;
 // Default hides an empty queue altogether; Classic keeps its 예약곡 board with its empty notice.
 $('queue-heading').hidden=$('queue').hidden=!count&&!classic;$('queue-songs').textContent=count===1?'1 song':`${count} songs`;
 if(before&&count>before.upcoming.length&&!REDUCED.matches)for(const id of ['queue-count','dock-count']){const c=$(id);c.classList.remove('bump');void c.offsetWidth;c.classList.add('bump');}
 const shape=JSON.stringify([!!state.current,...state.upcoming.map(i=>[i.key,i.title,i.artist,i.status,i.error])]);  // the empty notice reads differently while a song plays
 if(shape!==queueShape&&!dragging){
  // A song that turns ready while queued flashes its ring once.
  const preparing=new Set(before?.upcoming.filter(i=>i.status!=='ready').map(i=>i.key));
  // FLIP: remember where each row was, rebuild, then animate rows from their old spots.
  const tops=new Map([...$('queue').children].filter(row=>row.dataset.key).map(row=>[row.dataset.key,row.getBoundingClientRect().top]));
  queueShape=shape;
  $('queue').replaceChildren(...state.upcoming.map((item,index)=>queueRow(item,index,preparing.has(item.key))));
  if(!count)$('queue').append(emptyQueue());
  if(count<=FOLD)queueOpen=false;
  if(count>FOLD&&!queueOpen){
   const rest=state.upcoming.slice(FOLD),minutes=Math.round(state.upcoming.reduce((sum,i)=>sum+(i.duration||0),0)/60);
   for(const row of [...$('queue').children].slice(FOLD))row.classList.add('folded');
   const more=el('button',`Show ${rest.length} more${minutes?` · ${minutes} min in all`:''}`,'seeall default-only');
   more.onclick=()=>{haptic(6);queueOpen=true;queueShape=null;showQueue(state);};$('queue').append(more);
  }
  if(tops.size&&!REDUCED.matches)for(const row of $('queue').children){
   if(!row.dataset.key||row.classList.contains('folded'))continue;
   const was=tops.get(row.dataset.key),top=row.getBoundingClientRect().top;
   if(was===undefined)row.animate([{opacity:0,transform:'translateY(-12px) scale(.96)'},{opacity:1,transform:'none'}],{duration:450,easing:SPRING});
   else if(Math.abs(was-top)>1)row.animate([{transform:`translateY(${was-top}px)`},{transform:'none'}],{duration:500,easing:SPRING});
  }
 }
 for(const [index,item] of state.upcoming.entries()){
  const row=$('queue').querySelector(`[data-key="${item.key}"]`);if(!row)continue;
  row.querySelector('.status').textContent=statusText(item);row.querySelector('.status-ko').textContent=statusKo(item,index);row.querySelector('.prepbar')?.style.setProperty('--p',item.progress||0);
  const ring=row.querySelector('.ring');if(ring){ring.style.setProperty('--p',item.progress||0);ring.classList.toggle('busy',!item.progress&&item.status!=='ready');}
 }
}
// An empty queue invites the next song, with a button straight to the search box.
function emptyQueue(){
 const box=el('div',undefined,'empty'),icon=el('span',undefined,'empty-icon'),find=el('button','Find a song','empty-action');
 icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
 find.onclick=()=>{if(document.body.dataset.theme==='classic')classicUi.setTab('book');$('search-form').scrollIntoView({behavior:REDUCED.matches?'auto':'smooth',block:'center'});$('query').focus({preventScroll:true});};
 const lcd=el('span','00',`lcd classic-only${state.current?'':' dim'}`);lcd.dataset.ghost='88';
 box.append(lcd,icon,el('b','예약곡이 없어요','classic-only'),el('strong',state.current?'Nothing up next':'The queue is empty'),el('small',state.current?'Add a song and it plays when this one ends.':'Add a song and it starts right away.'),find);
 return box;
}
const GRIP='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
function queueRow(item,index,justReady){
 const row=el('article',undefined,`row ${item.status}`);row.dataset.key=item.key;
 const thumb=el('div',undefined,'thumb'),image=el('img',undefined,'art');image.src=thumbnail(item.id);image.alt='';thumb.append(image);
 // The ring shows while the song prepares, and once more as it turns ready.
 if(item.status!=='ready'&&item.status!=='error'||justReady&&item.status==='ready')thumb.insertAdjacentHTML('beforeend',`<svg class="ring" viewBox="0 0 52 52" style="--c:${RING}" aria-hidden="true"><circle class="track" cx="26" cy="26" r="23"/><circle class="fill" cx="26" cy="26" r="23"/></svg>`);
 if(justReady&&item.status==='ready')haptic(10);
 const info=el('div',undefined,'info'),line=el('p');if(item.number)line.append(el('span',String(item.number),'qnum classic-only'),' ');line.append(el('span',item.artist,'who'),...(justReady&&item.status==='ready'?[el('em','준비 완료','ready-lamp classic-only')]:[]),el('span',' · ','sep'),el('span',statusKo(item,index),'status-ko classic-only'),el('span',statusText(item),'status'));info.append(el('h3',item.title),line);
 if(item.status!=='ready'&&item.status!=='error'){const bar=el('div',undefined,'prepbar classic-only');bar.append(el('i'));info.append(bar);}
 if(item.error){const retry=el('button','Retry','retry');retry.onclick=()=>send({action:'retry',key:item.key});info.append(el('p',item.error,'error'),retry);}
 const remove=el('button','×','row-button');remove.setAttribute('aria-label',`Remove ${item.title}`);
 remove.onclick=()=>{send({action:'remove',key:item.key});toast(`Removed ${item.title}`,{label:'Undo',run:()=>send({action:'undo'})});};
 const grip=el('button',undefined,'row-button grip');grip.innerHTML=GRIP;grip.setAttribute('aria-label',`Move ${item.title}. Arrow keys move it up or down.`);
 grip.onkeydown=e=>{const to=index+({ArrowUp:-1,ArrowDown:1}[e.key]||0);if(to!==index&&to>=0&&to<state.upcoming.length){e.preventDefault();move(index,to);}};
 // Classic: 우선 moves a song to sing next, as on the machine.
 const first=el('button','우선','row-button first classic-only');first.setAttribute('aria-label',`Play ${item.title} next`);first.hidden=index===0;
 first.onclick=()=>{haptic(8);move(index,0);toast(`${item.title} 우선예약`);};
 row.append(el('span',String(index+1),'num'),thumb,info,first,remove,grip);
 dragHandlers(row,grip);
 // Default: a tap on the row opens the song's menu (a long press still lifts it to reorder).
 row.addEventListener('click',e=>{if(document.body.dataset.theme==='classic'||e.target.closest('button')||row.dataset.dragged){delete row.dataset.dragged;return;}haptic(6);queueMenu(item.key);});
 return row;
}
const MENU_ICONS={next:'<path d="M4 4.5v6l5-3zM13 7.5h7M4 14h16M4 19h16"/>',end:'<path d="M12 4v13M6 11l6 6 6-6M5 20h14"/>',lyrics:'<path d="M4 6h16M4 10h16M4 14h10M4 18h7"/>',remove:'<path d="M5 7h14M9 7V4.5h6V7M7 7l1 13h8l1-13"/>'};
// A queued song's menu, in a bottom sheet: play it next, send it to the end, fix its lyrics or take it out.
function queueMenu(key){
 const index=state.upcoming.findIndex(i=>i.key===key),item=state.upcoming[index];if(!item)return;
 const {panel,shut}=bottomSheet(),last=state.upcoming.length-1;
 const song=el('div',undefined,'menu-song'),art=el('img',undefined,'art'),text=el('div');art.src=thumbnail(item.id);art.alt='';text.append(el('b',item.title),el('small',item.artist));song.append(art,text);
 const actions=el('div',undefined,'menu-actions');actions.setAttribute('role','menu');
 const action=(icon,label,run,off)=>{const b=el('button');b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${MENU_ICONS[icon]}</svg>`;b.append(label);b.setAttribute('role','menuitem');b.disabled=!!off;if(off)b.classList.add('dim');b.onclick=()=>{haptic(8);shut();run();};actions.append(b);};
 // The queue may have changed while the menu was open, so each action finds the song again.
 const at=()=>state.upcoming.findIndex(i=>i.key===key);
 action('next','Play next',()=>{const i=at();if(i>0)move(i,0);},index===0);
 action('end','Move to the end',()=>{const i=at();if(i>=0)move(i,state.upcoming.length-1);},index===last);
 action('lyrics','Wrong lyrics or language',()=>pickLyrics(item));
 action('remove','Remove from queue',()=>{send({action:'remove',key});toast(`Removed ${item.title}`,{label:'Undo',run:()=>send({action:'undo'})});});
 panel.append(song,actions);
}
function move(from,to){const keys=state.upcoming.map(i=>i.key);keys.splice(to,0,...keys.splice(from,1));send({action:'reorder',keys});}
// Drag to reorder: the grip lifts a row at once; a long press anywhere else on it lifts it after 350 ms.
document.addEventListener('touchmove',e=>{if(dragging)e.preventDefault();},{passive:false});
function dragHandlers(row,grip){
 let press,startX,startY;
 grip.addEventListener('pointerdown',e=>{e.preventDefault();startDrag(row,e);});
 row.addEventListener('pointerdown',e=>{
  if(e.target.closest('button'))return;
  startX=e.clientX;startY=e.clientY;press=setTimeout(()=>startDrag(row,e),350);
 });
 const cancel=e=>{if(e.type!=='pointermove'||Math.hypot(e.clientX-startX,e.clientY-startY)>8)clearTimeout(press);};
 for(const type of ['pointermove','pointerup','pointercancel'])row.addEventListener(type,cancel);
}
function startDrag(row,e){
 if(dragging)return;
 const rows=[...$('queue').children].filter(r=>r.dataset.key),from=rows.indexOf(row),boxes=rows.map(r=>r.getBoundingClientRect());
 dragging={row,from,to:from,y:e.clientY,rows,boxes,height:boxes[from].height};
 row.classList.add('lifted');row.dataset.dragged='1';for(const r of rows)if(r!==row)r.classList.add('shifting');
 haptic(15);
 addEventListener('pointermove',onDrag);addEventListener('pointerup',endDrag,{once:true});addEventListener('pointercancel',endDrag,{once:true});
}
function onDrag(e){
 const d=dragging,dy=e.clientY-d.y;d.row.style.translate=`0 ${dy}px`;
 const middle=d.boxes[d.from].top+d.height/2+dy;
 let to=d.boxes.findIndex(box=>middle<box.top+box.height/2);if(to<0)to=d.rows.length-1;else if(to>d.from)to--;
 if(to!==d.to){
  d.to=to;haptic(5);
  d.rows.forEach((r,i)=>{if(r===d.row)return;const shift=d.from<to&&i>d.from&&i<=to?-d.height:d.from>to&&i<d.from&&i>=to?d.height:0;r.style.transform=shift?`translateY(${shift}px)`:'';});
 }
 // Scroll when dragging near the top or bottom edge.
 if(e.clientY<80)scrollBy(0,-8);else if(e.clientY>innerHeight-110)scrollBy(0,8);
}
function endDrag(){
 const d=dragging;removeEventListener('pointermove',onDrag);removeEventListener('pointerup',endDrag);removeEventListener('pointercancel',endDrag);
 const target=d.boxes[d.to].top-d.boxes[d.from].top+(d.to>d.from?d.boxes[d.to].height-d.height:0);
 const settle=d.row.animate([{translate:d.row.style.translate||'0 0'},{translate:`0 ${target}px`}],{duration:REDUCED.matches?1:260,easing:'cubic-bezier(.34,1.3,.64,1)',fill:'forwards'});
 settle.onfinish=()=>{
  dragging=null;
  if(d.to!==d.from){
   // Show the new order now; the server's answer then matches it, so nothing jumps.
   const order=state.upcoming.map(i=>i.key);order.splice(d.to,0,...order.splice(d.from,1));
   state={...state,upcoming:order.map(key=>state.upcoming.find(i=>i.key===key))};queueShape=null;
   move(d.from,d.to);
  }else queueShape=null;
  showQueue(state);
 };
}
// Songs already prepared on the server, newest first.
// Rebuilt only when the list itself changes, so a just-tapped song keeps its added/failed icon.
let readyKeys,recentShape;
async function loadRecent(){
 try{
  const songs=await api('/api/recent'),shape=songs.map(song=>song.id).join();
  if(shape===recentShape)return;
  recentShape=shape;$('recent').replaceChildren();
  songs.forEach(song=>showResult({...song,channel:song.artist,parsed:{artist:song.artist,title:song.title}},$('recent'),(row,next)=>swipeable(row,song,next)));
  if(!songs.length)$('recent').append(emptyNote('♪','아직 부른 노래가 없어요','Nothing sung yet.'));
 }catch{}
}
// "Added · #N" with Undo (which takes the song back out), or "singing now" if it went straight on stage.
function addedToast(item,path){
 if(state.current?.key===item?.key)return toast('Added · singing now');
 const at=state.upcoming.findIndex(i=>i.key===item?.key);
 toast(`Added · #${at>=0?at+1:path.endsWith('next')?1:state.upcoming.length+1}`,{label:'Undo',run:()=>send({action:'remove',key:item.key})});
}
// Default song rows, one builder for home, the library and both halves of search. A song already queued trades
// its + for "In queue · N" (and "Preparing" while it gets ready); ••• opens Play next, lyrics and Delete download.
const PLUS='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',MORE='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>';
function songRow(song){
 const row=el('div',undefined,'song-row'),art=el('img',undefined,'art'),text=el('div',undefined,'t'),sub=el('span');
 row.dataset.id=song.id;art.loading='lazy';art.alt='';art.src=song.thumbnail||thumbnail(song.id);
 sub.textContent=song.sub??[song.artist,song.duration?clock(song.duration):''].filter(Boolean).join(' · ');
 text.append(el('b',song.title),sub);
 const add=el('button',undefined,'ib add'),tag=el('span',undefined,'tag'),more=el('button',undefined,'ib dots');
 add.innerHTML=PLUS;add.setAttribute('aria-label',`Add ${song.title}`);more.innerHTML=MORE;more.setAttribute('aria-label',`More for ${song.title}`);tag.hidden=true;
 row.append(art,text,add,tag,more);row.song=song;row.plain=sub.textContent;
 const queue=async path=>{
  if(add.disabled)return;add.disabled=true;
  try{const item=await post(path,{id:song.id,...song.parsed});haptic([10,40,10]);flyToQueue(art);addedToast(item,path);}
  catch(error){toast(error.message,undefined,'err');}finally{add.disabled=false;}
 };
 add.onclick=()=>queue('/api/queue');text.onclick=art.onclick=()=>{if(add.hidden)return songSheet(song,queue);queue('/api/queue');};
 more.onclick=()=>{haptic(6);songSheet(song,queue);};
 markRow(row);
 return row;
}
// Where each song sits on stage or in the queue, refreshed whenever the queue changes.
let placed=new Map(),placedShape;
function markQueued(){
 const shape=JSON.stringify([state.current?.id,...state.upcoming.map(i=>[i.id,i.status])]);if(shape===placedShape)return;placedShape=shape;
 placed=new Map(state.upcoming.map((item,n)=>[item.id,{n:n+1,item}]));if(state.current)placed.set(state.current.id,{n:0,item:state.current});
 for(const row of document.querySelectorAll('.song-row'))markRow(row);
}
function markRow(row){
 const at=placed.get(row.dataset.id),[,text,add,tag]=row.children,sub=text.lastChild;
 add.hidden=!!at;tag.hidden=!at;tag.textContent=at?(at.n?`In queue · ${at.n}`:'Singing'):'';
 if(at&&at.item.status!=='ready'){sub.replaceChildren(`${row.song.artist||row.plain} · `,el('em',at.item.status==='error'?'Error preparing':'Preparing'));}
 else if(sub.textContent!==row.plain)sub.textContent=row.plain;
}
function songSheet(song,queue){
 const {panel,shut}=bottomSheet(),head=el('div',undefined,'menu-song'),art=el('img',undefined,'art'),text=el('div');
 art.src=song.thumbnail||thumbnail(song.id);art.alt='';text.append(el('b',song.title),el('small',song.artist||song.sub||''));head.append(art,text);
 const actions=el('div',undefined,'menu-actions');actions.setAttribute('role','menu');
 const action=(icon,label,run,cls)=>{const b=el('button',undefined,cls);b.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${MENU_ICONS[icon]}</svg>`;b.append(label);b.setAttribute('role','menuitem');b.onclick=()=>{haptic(8);shut();run();};actions.append(b);};
 action('next','Play next',()=>queue('/api/queue/next'));
 // Only a prepared song has lyrics to swap and a download to delete.
 if(song.prepared||song.cached){
  action('lyrics','Wrong lyrics or language',()=>pickLyrics(song));
  action('remove','Delete download',async()=>{
   try{await api(`/api/songs/${song.id}`,{method:'DELETE'});toast(`Deleted ${song.title}`);library=library.filter(s=>s.id!==song.id);for(const row of document.querySelectorAll(`.song-row[data-id="${song.id}"]`))row.remove();libraryRows.delete(song.id);showReady();showLibrary();showLocal();}
   catch(error){toast(error.message,undefined,'err');}
  },'dim');
 }
 panel.append(head,actions);
}
// The library: every prepared song (the songbook), fetched again whenever a song turns ready.
let library=[],libraryRows=new Map(),homeSort='recent',librarySort='recent';
const recency=s=>Math.max(s.played||0,s.prepared||0);
// A–Z groups: a letter for Latin titles (accents folded), one group for Hangul, one for kana and CJK, # for the rest.
const LETTERS=[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ','가','あ','#'];
function letterOf(title){
 const t=title.normalize('NFD').replace(/^[\s\p{P}\p{S}\p{M}]+/u,''),c=t.codePointAt(0)??0,ch=t[0]?.toUpperCase()??'';
 if(/[A-Z]/.test(ch))return ch;
 if(c>=0xAC00&&c<=0xD7A3||c>=0x1100&&c<=0x11FF||c>=0x3130&&c<=0x318F)return '가';
 if(c>=0x3040&&c<=0x30FF||c>=0x3400&&c<=0x9FFF||c>=0xF900&&c<=0xFAFF)return 'あ';
 return '#';
}
const collator=new Intl.Collator(undefined,{sensitivity:'base',numeric:true});
function sorted(sort){
 if(sort==='az')return [...library].sort((a,b)=>LETTERS.indexOf(a.letter)-LETTERS.indexOf(b.letter)||collator.compare(a.title,b.title));
 return [...library].sort((a,b)=>recency(b)-recency(a));
}
async function loadLibrary(){
 let songs;try{songs=await api('/api/songbook');}catch{return;}
 library=songs.map(s=>({...s,parsed:{artist:s.artist,title:s.title},letter:letterOf(s.title),find:`${s.title} ${s.artist}`.toLowerCase()}));
 libraryRows=new Map();showReady();showLibrary();showLocal();
}
function showReady(){
 const n=library.length;$('ready-block').hidden=!n;$('ready-count').textContent=n===1?'1 song':`${n} songs`;
 $('ready').replaceChildren(...sorted(homeSort).slice(0,5).map(songRow));
 $('ready-all').hidden=n<=5;$('ready-all').textContent=`See all ${n}`;
}
function chips(box,pick){for(const b of box.querySelectorAll('button'))b.onclick=()=>{haptic(6);for(const o of box.children)o.setAttribute('aria-pressed',o===b);pick(b.dataset.sort);};}
chips($('ready-chips'),sort=>{homeSort=sort;showReady();});
chips($('library-chips'),sort=>{librarySort=sort;showLibrary();$('library').scrollTop=0;});
// Rows are built once per songbook and only moved or hidden after that, so a thousand songs stay quick.
function showLibrary(){
 if($('library').hidden)return;
 const n=library.length,list=$('library-list'),az=librarySort==='az',frag=document.createDocumentFragment();
 $('library-count').textContent=n===1?'1 song':`${n} songs`;$('library-filter').placeholder=`Filter ${n} songs`;
 let letter;
 for(const song of sorted(librarySort)){
  if(az&&song.letter!==letter){letter=song.letter;const h=el('div',letter,'letter');h.dataset.letter=letter;frag.append(h);}
  let row=libraryRows.get(song.id);if(!row){row=songRow(song);libraryRows.set(song.id,row);}frag.append(row);
 }
 list.replaceChildren(frag);filterLibrary();
}
function filterLibrary(){
 const words=$('library-filter').value.trim().toLowerCase().split(/\s+/).filter(Boolean);
 for(const [id,row] of libraryRows)row.hidden=!words.every(w=>row.song.find.includes(w));
 const letters=[];
 for(const h of $('library-list').querySelectorAll('.letter')){
  let next=h.nextElementSibling,any=false;while(next&&!next.classList.contains('letter')){if(!next.hidden){any=true;break;}next=next.nextElementSibling;}
  h.hidden=!any;if(any)letters.push(h.dataset.letter);
 }
 $('library-rail').replaceChildren(...letters.map(l=>{const b=el('button',l);b.dataset.letter=l;b.tabIndex=-1;return b;}));
 $('library-rail').hidden=librarySort!=='az'||letters.length<2;
}
$('library-filter').oninput=filterLibrary;
// Slide a finger down the rail to scrub through the letters, as in Contacts.
{
 const rail=$('library-rail');let last;
 const jump=e=>{const b=document.elementFromPoint(e.clientX,e.clientY)?.closest('#library-rail button');if(!b||b===last)return;last?.classList.remove('on');last=b;b.classList.add('on');haptic(4);
  const h=$('library-list').querySelector(`.letter[data-letter="${CSS.escape(b.dataset.letter)}"]`);// A stuck header reports where it sticks, so measure from the first row under it.
  const row=h?.nextElementSibling;if(row)$('library').scrollTop=row.offsetTop-h.offsetHeight;};
 rail.addEventListener('pointerdown',e=>{try{rail.setPointerCapture(e.pointerId);}catch{}jump(e);});
 rail.addEventListener('pointermove',e=>{if(e.buttons||e.pointerType!=='mouse')jump(e);});
 const done=()=>{last?.classList.remove('on');last=null;};rail.addEventListener('pointerup',done);rail.addEventListener('pointercancel',done);
}
// The library opens as its own history entry, so the phone's Back button closes it.
function openLibrary(){
 $('library').hidden=false;document.body.classList.add('library-open');history.pushState({library:true},'');
 for(const o of $('library-chips').children)o.setAttribute('aria-pressed',o.dataset.sort===librarySort);
 showLibrary();$('library').scrollTop=0;
 if(!REDUCED.matches)$('library').animate([{opacity:0,transform:'translateY(24px)'},{opacity:1,transform:'none'}],{duration:320,easing:'cubic-bezier(.2,0,0,1)'});
}
function closeLibrary(){$('library').hidden=true;document.body.classList.remove('library-open');}
$('ready-all').onclick=openLibrary;
$('library-back').onclick=()=>history.state?.library?history.back():closeLibrary();
addEventListener('popstate',()=>{if(!$('library').hidden)closeLibrary();});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!$('library').hidden&&!document.querySelector('.lyric-sheet'))$('library-back').click();});
// Search: songs already prepared that match, filtered here as you type, sit above YouTube's results.
function showLocal(){
 const q=$('query').value.trim().toLowerCase(),on=!!q&&document.body.dataset.theme!=='classic';
 $('local-block').hidden=!on;if(!on)return;
 const words=q.split(/\s+/),hits=library.filter(s=>words.every(w=>s.find.includes(w))).sort((a,b)=>recency(b)-recency(a));
 $('local-count').textContent=hits.length||'';
 $('local').replaceChildren(...(hits.length?hits.slice(0,5).map(songRow):[el('div','No matches','empty2')]));
 if(hits.length>5){const all=el('button',`See all ${hits.length}`,'seeall');all.onclick=()=>{$('library-filter').value=$('query').value;librarySort='recent';openLibrary();};$('local').append(all);}
}
$('query').addEventListener('input',showLocal);
// Search in pages of 10; "More results" appends the next page.
let search={query:'',page:0,seen:new Set()},searchRun=0;
const post=(path,song)=>api(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title})});
// Result button states: add, added, failed.
const ICONS={add:'<path d="M12 5v14M5 12h14"/>',added:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',failed:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'};
function icon(node,name){node.className=`result-icon ${name}`;node.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;}
// Play next: a song going in at the top of the list.
const NEXT_ICON='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5v6l5-3zM13 7.5h7M4 14h16M4 19h16"/></svg>';
const pick=(row,next)=>{const box=el('div',undefined,'pick');box.append(row,next);return box;};
// One tap queues the song with the artist/title parsed from YouTube (or confirmed earlier, for recent songs);
// its play-next key puts it at the front instead (moving it up if it is already waiting).
function showResult(song,list=$('results'),wrap=pick,index=-1){
 const b=el('button',undefined,index<0?'result':'result enter');
 const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div');const title=el('strong',song.title);if(song.cached)title.append(el('span','READY','tag'));const note=el('small',undefined,'result-note classic-only');info.append(title,el('small',`${song.channel} · ${clock(song.duration)}`),note);const status=el('span');icon(status,'add');b.append(image,info,status);
 // Classic swaps the channel line for what happened to the add.
 const mark=(name,...text)=>{b.classList.remove('added','failed');b.classList.add(name);note.replaceChildren(...text);};
 const add=async(button,path,said,message)=>{
  button.disabled=true;
  try{
   const item=await post(path,{id:song.id,...song.parsed});icon(status,'added');mark('added',...said);haptic([10,40,10]);flyToQueue(image);
   // Default: where it landed in the queue, with Undo. Classic keeps its own wording (classic-remote.js reads it).
   if(document.body.dataset.theme==='classic')toast(message);else addedToast(item,path);
  }
  catch(error){icon(status,'failed');mark('failed',"Couldn't add. Try again");toast(error.message,undefined,'err');}finally{button.disabled=false;}
 };
 b.onclick=()=>{
  // A swipe ends in a click; an open row closes on tap instead of queueing.
  if(b.dataset.dragged){delete b.dataset.dragged;return;}if(b.parentElement?.classList.contains('open')){closeSwipe();return;}
  add(b,'/api/queue',[el('em','예약됨'),' · added'],`Added ${song.parsed.title}`);
 };
 const next=el('button',undefined,'play-next');next.innerHTML=NEXT_ICON;next.title='Play next';next.setAttribute('aria-label',`Play ${song.parsed.title} next`);
 next.onclick=()=>add(next,'/api/queue/next',[el('em','우선예약'),' · plays next'],`${song.parsed.title} plays next`);
 const box=wrap(b,next);if(index>=0)box.style.setProperty('--i',index);  // the key rises in with its row
 list.append(box);
}
// The thumbnail arcs into whichever queue count is on screen: the outer box moves across evenly,
// the inner one up or down with an overshooting ease, which together trace a curve.
function flyToQueue(source){
 if(REDUCED.matches)return;
 const from=source.getBoundingClientRect(),count=$('queue-count').getBoundingClientRect();
 const target=(document.body.dataset.theme==='classic'?document.querySelector('#tabs [data-tab=queue]'):count.top>60&&count.bottom<innerHeight-90||$('dock').classList.contains('away')?$('queue-count'):$('dock-count')).getBoundingClientRect();
 const outer=el('div'),inner=source.cloneNode();
 inner.style.cssText=`display:block;width:${from.width}px;height:${from.height}px;border-radius:8px;object-fit:cover;box-shadow:0 10px 30px #000a`;
 outer.style.cssText=`position:fixed;left:${from.left}px;top:${from.top}px;z-index:55;pointer-events:none`;
 outer.append(inner);document.body.append(outer);
 const dx=target.left+target.width/2-(from.left+from.width/2),dy=target.top+target.height/2-(from.top+from.height/2);
 outer.animate([{transform:'none'},{transform:`translateX(${dx}px)`}],{duration:650,easing:'cubic-bezier(.3,0,.7,1)',fill:'forwards'});
 inner.animate([{transform:'none',borderRadius:'8px'},{transform:`translateY(${dy}px) scale(.25) rotate(25deg)`,borderRadius:'50%'}],{duration:650,easing:dy>0?'cubic-bezier(.55,-0.5,.9,.5)':'cubic-bezier(.1,.5,.45,1.4)',fill:'forwards'}).onfinish=()=>outer.remove();
}
// Recent songs swipe left to reveal Delete; tapping it deletes the download.
const REVEAL=96;let openSwipe=null;
function closeSwipe(){if(!openSwipe)return;openSwipe.classList.remove('open');openSwipe.querySelector('.result').style.transform='';openSwipe=null;}
document.addEventListener('pointerdown',e=>{if(openSwipe&&!openSwipe.contains(e.target))closeSwipe();});
// Lyrics picker: every LRCLIB version that fits the song (languages, editions), with its first lines.
// A bottom sheet over the page (song menu, lyrics picker): tap outside, the handle or Escape closes it, or swipe it down.
function bottomSheet(onShut){
 const sheet=el('div',undefined,'lyric-sheet'),panel=el('div',undefined,'lyric-sheet-panel'),handle=el('button',undefined,'handle');
 handle.setAttribute('aria-label','Close');panel.append(handle);sheet.append(panel);document.body.append(sheet);
 let closing=false;
 const shut=()=>{
  if(closing)return;closing=true;onShut?.();removeEventListener('keydown',escape);
  const from=panel.style.transform||'none',time=REDUCED.matches?1:220;panel.style.transition='none';
  sheet.animate([{opacity:getComputedStyle(sheet).opacity},{opacity:0}],{duration:time,fill:'forwards'});
  panel.animate([{transform:from},{transform:'translateY(100%)'}],{duration:time,easing:'cubic-bezier(.4,0,1,1)',fill:'forwards'}).finished.then(()=>sheet.remove());
 };
 const escape=e=>{if(e.key==='Escape')shut();};addEventListener('keydown',escape);
 handle.onclick=shut;sheet.onclick=e=>{if(e.target===sheet)shut();};
 dragToClose(panel,shut,f=>{sheet.style.opacity=f??'';},{get scrollTop(){return panel.querySelector('.lyric-options')?.scrollTop||0;}});
 return {sheet,panel,shut};
}
async function pickLyrics(song){
 let hold;  // counts down a wait LRCLIB asked for
 const {panel,shut}=bottomSheet(()=>clearInterval(hold)),list=el('div',undefined,'lyric-options'),close=el('button','Close');
 close.onclick=shut;
 const head=el('div',undefined,'lyric-sheet-head'),name=el('strong');name.append(el('small','가사 선택 · LYRICS','classic-only'),'Lyrics · ',el('span',song.title));head.append(name,close);close.setAttribute('aria-label','Close');
 // Search LRCLIB by hand when the automatic lookup found nothing or the wrong song.
 const form=el('form',undefined,'lyric-search'),input=el('input'),go=el('button','Search');
 input.type='search';input.value=`${song.artist} ${song.title}`;input.placeholder='Artist and song title';input.setAttribute('aria-label','Search lyrics');go.type='submit';
 form.append(input,go);form.onsubmit=e=>{e.preventDefault();if(go.disabled)return;input.blur();show(input.value.trim());};
 panel.append(head,form,list);
 // Rate-limited or busy: Search counts the wait down and stays off until it is over, rather than being refused again.
 function holdOff(seconds){
  clearInterval(hold);let left=Math.ceil(seconds);
  const tick=()=>{go.disabled=left>0;go.textContent=left>0?`Wait ${left}s`:'Search';if(left--<=0)clearInterval(hold);};
  tick();hold=setInterval(tick,1000);
 }
 let latest=0;  // a slow earlier lookup must not replace newer results
 async function show(query){
  const mine=++latest;
  const wait=el('p',query?'Searching…':'Looking up every version…','muted lyric-wait'),bar=el('span',undefined,'pbar busy classic-only');
  for(let i=0;i<40;i++){const cell=el('i');cell.style.animationDelay=`${(i*.045).toFixed(3)}s`;bar.append(cell);}
  wait.append(el('span',query?'검색 중':'모든 가사 버전을 찾는 중','classic-only'),bar);list.replaceChildren(wait);
  try{
   const options=await api(`/api/songs/${song.id}/lyrics${query?`?q=${encodeURIComponent(query)}`:''}`);
   if(mine!==latest)return;
   const none=el('p',undefined,'muted lyric-none');none.append(el('b','싱크 가사를 못 찾았어요','classic-only'),query?'Nothing found. Try fewer words, or the title in its original language.':'No synced lyrics found automatically. Try a search above.');
   list.replaceChildren(...(options.length?[]:[none]));
   // One row per language (its best version) first; other editions sit behind "Show all". Searches list everything.
   const seen=new Set(),extra=[];
   for(const o of options){
    const first=!seen.has(o.language);seen.add(o.language);
    const b=el('button',undefined,'lyric-option'+(o.current?' current':'')),top=el('div');
    const gap=Math.abs(o.difference)>10?` · ${Math.abs(o.difference)}s ${o.difference>0?'longer':'shorter'} than this video`:'';
    const lines=el('span',undefined,'cnt classic-only'),figure=el('span',String(o.lines),'lcd');figure.dataset.ghost='88';lines.append(figure,'LINES',...(gap?[el('span',gap.slice(3),'gap')]:[]));
    top.append(el('b',o.language),el('span',[o.track,o.artist,o.album].filter(Boolean).join(' · ')),...(o.current?[el('em','In use')]:[]),lines);
    b.append(top,...o.preview.map(line=>el('small',line)),el('small',`${o.lines} lines${gap}`,'count'));
    b.onclick=async()=>{
     for(const other of list.children)other.disabled=true;b.classList.add('busy');
     try{await api(`/api/songs/${song.id}/lyrics`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.id})});toast(`Lyrics for ${song.title} set to ${o.track||o.language}`);shut();}
     catch(error){toast(error.message,undefined,'err');for(const other of list.children)other.disabled=false;b.classList.remove('busy');}
    };
    if(query||first||o.current)list.append(b);else extra.push(b);
   }
   if(extra.length){const all=el('button',undefined,'lyric-all');all.append(el('span',`${options.length}개 모두 보기 · `,'classic-only'),`Show all ${options.length} versions`);all.onclick=()=>{all.replaceWith(...extra);};list.append(all);}
  }catch(error){if(mine!==latest)return;list.replaceChildren(el('p',error.message,'error'));if(error.retryAfter)holdOff(error.retryAfter);}
 }
 show('');
}
// A ⋯ button on each recent song opens its advanced actions.
let openMenu=null;
function closeMenu(){openMenu?.remove();openMenu=null;}
document.addEventListener('pointerdown',e=>{if(openMenu&&!openMenu.contains(e.target)&&!e.target.closest('.song-more'))closeMenu();});
function songMenu(wrap,song,del){
 if(openMenu?.parentElement===wrap)return closeMenu();
 closeMenu();closeSwipe();
 const menu=el('div',undefined,'song-menu'),refetch=el('button'),remove=el('button',undefined,'danger'),label=el('div',undefined,'menu-head classic-only');
 if(song.number){const n=el('span',String(song.number),'lcd');n.dataset.ghost='88888';label.append(n);}label.append(song.title);
 refetch.innerHTML='<svg class="classic-only" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/></svg>';refetch.append(el('span','가사 고르기','classic-only'),'Lyrics…');
 remove.innerHTML='<svg class="classic-only" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';remove.append(el('span','다운로드 삭제','classic-only'),'Delete download');
 menu.setAttribute('role','menu');for(const item of [refetch,remove])item.setAttribute('role','menuitem');
 refetch.onclick=()=>{closeMenu();pickLyrics(song);};
 remove.onclick=()=>{closeMenu();del.click();};
 menu.append(label,refetch,remove);wrap.append(menu);openMenu=menu;refetch.focus();
}
function swipeable(row,song,next){
 const wrap=el('div',undefined,'swipe'),del=el('button','Delete','swipe-delete'),more=el('button','⋯','song-more');del.setAttribute('aria-label',`Delete ${song.title} from this device`);
 more.setAttribute('aria-label',`More actions for ${song.title}`);more.setAttribute('aria-haspopup','menu');more.onclick=()=>songMenu(wrap,song,del);
 wrap.append(row,del,...(next?[next]:[]),more);
 let start=null,dx=0,dragging=false;
 row.addEventListener('pointerdown',e=>{delete row.dataset.dragged;if(e.pointerType==='mouse'&&e.button)return;start={x:e.clientX,y:e.clientY,base:wrap.classList.contains('open')?-REVEAL:0};dx=start.base;dragging=false;});
 row.addEventListener('pointermove',e=>{
  if(!start)return;const mx=e.clientX-start.x,my=e.clientY-start.y;
  if(!dragging){if(Math.abs(my)>8&&Math.abs(my)>Math.abs(mx)){start=null;return;}if(Math.abs(mx)<8)return;dragging=true;row.setPointerCapture(e.pointerId);wrap.classList.add('dragging');if(openSwipe!==wrap)closeSwipe();}
  dx=Math.max(-REVEAL*1.3,Math.min(0,start.base+mx));row.style.transform=`translateX(${dx}px)`;
 });
 const end=()=>{
  if(!start)return;start=null;wrap.classList.remove('dragging');if(!dragging)return;
  row.dataset.dragged='1';
  if(dx<-REVEAL/2){wrap.classList.add('open');row.style.transform=`translateX(${-REVEAL}px)`;openSwipe=wrap;}
  else{wrap.classList.remove('open');row.style.transform='';if(openSwipe===wrap)openSwipe=null;}
 };
 row.addEventListener('pointerup',end);row.addEventListener('pointercancel',end);
 del.onclick=async()=>{
  del.disabled=true;
  try{
   await api(`/api/songs/${song.id}`,{method:'DELETE'});
   if(openSwipe===wrap)openSwipe=null;
   if(!REDUCED.matches)await wrap.animate([{height:`${wrap.offsetHeight}px`,opacity:1},{height:'0px',opacity:0,marginBottom:'-8px'}],{duration:300,easing:'cubic-bezier(.3,0,.8,.15)'}).finished;
   wrap.remove();recentShape=null;toast(`Deleted ${song.title}`);
   if(!$('recent').children.length)loadRecent();
  }catch(error){toast(error.message,undefined,'err');closeSwipe();}finally{del.disabled=false;}
 };
 return wrap;
}
async function loadPage(){
 const run=++searchRun,first=!search.page;
 $('more').disabled=true;if(first){$('results').dataset.state='loading';$('results-end').hidden=true;}
 // Placeholder rows hold the space while YouTube answers.
 $('more-head').hidden=document.body.dataset.theme==='classic';
 if(first)$('results').replaceChildren(...Array.from({length:3},()=>{const row=el('div',undefined,'skeleton');row.setAttribute('aria-hidden','true');row.innerHTML='<i></i><div><i></i><i></i></div>';return row;}));
 try{
  const results=(await api(`/api/search?q=${encodeURIComponent(search.query)}&page=${search.page}`)).filter(s=>!search.seen.has(s.id));
  if(run!==searchRun)return;
  if(first)$('results').replaceChildren();
  const classic=document.body.dataset.theme==='classic';
  results.forEach((s,i)=>{search.seen.add(s.id);if(classic)showResult(s,$('results'),undefined,i);else $('results').append(songRow({...s,artist:s.parsed?.artist,sub:`${s.channel} · ${clock(s.duration)}`}));});
  $('more').hidden=results.length===0||search.page>=9;$('results').dataset.state=search.seen.size?'':'none';
  $('results-end').hidden=!$('more').hidden||!search.seen.size;
  if(!search.seen.size)$('results').append(classic?emptyNote('없음','검색 결과가 없어요','No songs found. Try the title in its original language, or just the artist.'):el('div','No matches','empty2'));
  if(first)showResults();
 }catch(error){
  if(run!==searchRun)return;if(first){$('results').replaceChildren();$('results').dataset.state='';}
  if(first&&document.body.dataset.theme!=='classic')$('results').append(el('div','Search unavailable · offline','empty2 warn'));else toast(error.message,undefined,'err');
 }finally{$('more').disabled=false;}
}
// Autocomplete from YouTube's search box: type to see completions, tap or arrow+Enter to search one.
let suggestTimer,suggestRun=0,suggestIndex=-1;
function hideSuggestions(){$('suggestions').hidden=true;$('query').setAttribute('aria-expanded','false');suggestIndex=-1;}
function pickSuggestion(text){$('query').value=text;hideSuggestions();$('search-form').requestSubmit();}
function markSuggestion(index){const items=[...$('suggestions').children];suggestIndex=(index+items.length+1)%(items.length+1)-1;items.forEach((li,i)=>li.setAttribute('aria-selected',i===suggestIndex));}
$('query').oninput=()=>{
 clearTimeout(suggestTimer);const q=$('query').value.trim(),run=++suggestRun;$('clear').hidden=!$('query').value;
 if(!q)return hideSuggestions();
 suggestTimer=setTimeout(async()=>{
  const list=await api(`/api/suggest?q=${encodeURIComponent(q)}`).catch(()=>[]);
  if(run!==suggestRun||document.activeElement!==$('query'))return;
  $('suggestions').replaceChildren(...list.map(text=>{const li=el('li'),typed=text.toLowerCase().startsWith(q.toLowerCase())?text.slice(0,q.length):'';li.append(typed,el('b',text.slice(typed.length)));li.setAttribute('role','option');li.onpointerdown=e=>{e.preventDefault();pickSuggestion(text);};return li;}));
  suggestIndex=-1;$('suggestions').hidden=!list.length;$('query').setAttribute('aria-expanded',String(!!list.length));
 },150);
};
$('query').onkeydown=e=>{
 if($('suggestions').hidden)return;
 if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();markSuggestion(suggestIndex+(e.key==='ArrowDown'?1:-1));}
 else if(e.key==='Enter'&&suggestIndex>=0){e.preventDefault();pickSuggestion($('suggestions').children[suggestIndex].textContent);}
 else if(e.key==='Escape')hideSuggestions();
};
$('query').onblur=()=>setTimeout(hideSuggestions,100);
$('clear').onclick=()=>{$('query').value='';$('clear').hidden=true;searchRun++;$('results').replaceChildren();$('more').hidden=$('results-end').hidden=$('more-head').hidden=true;showLocal();$('query').focus();};
$('search-form').onsubmit=e=>{
 e.preventDefault();suggestRun++;hideSuggestions();search={query:$('query').value.trim(),page:0,seen:new Set()};$('more').hidden=true;loadPage();
 $('query').blur();showResults();  // drop the keyboard so results have the screen
};
// Search stays pinned but results don't: from further down, bring them up under the bar.
function showResults(){
 const gap=$('results').getBoundingClientRect().top-($('search-form').getBoundingClientRect().bottom+12);
 if(gap<0)scrollBy({top:gap,behavior:REDUCED.matches?'auto':'smooth'});
}
$('more').onclick=()=>{search.page++;loadPage();};
// Keep the page's end clear of the dock, whatever its height.
new ResizeObserver(()=>document.body.style.setProperty('--dock',`${$('dock').offsetHeight}px`)).observe($('dock'));
classicUi=classicRemote({send,toast,haptic,swipeable});if(state)classicUi.render(state);

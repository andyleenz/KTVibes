import {classicRemote,toastParts,emptyNote,secondsLeft} from './classic-remote.js';
import {$,el,connect,api,clock,throttle,prepLabel,syncRanges,REDUCED,thumbnail} from './shared.js';
let state,classicUi,openLyricsDialog,seekDrag=null,seekPending=null;
const SPRING='cubic-bezier(.38,1.21,.22,1)';
const haptic=pattern=>{try{navigator.vibrate?.(pattern);}catch{}};
function showImage(img,src){if(img.getAttribute('src')!==src){if(src)img.src=src;else img.removeAttribute('src');}img.hidden=!src;}
let updatePollTimer;
let availableUpdate=null;
function renderUpdateNotice(){
 const ready=!!(state?.player_connected&&state?.player_audio),show=!!(availableUpdate&&ready);
 updateButton.hidden=!show;$('connection').classList.toggle('has-update',show);
 if(!show&& !updatePopover.hidden){updatePopover.classList.remove('open');updatePopover.hidden=true;updatePopover.setAttribute('aria-hidden','true');updateButton.setAttribute('aria-expanded','false');}
}
async function refreshUpdateNotice(){
 try{
  const {update,update_check_complete}=await api('/api/config');
  const valid=update&&/^v?\d+(?:\.\d+){1,3}$/.test(update.version||'')&&update.url?.startsWith('https://github.com/JeffShih-wiwynn/KTVibes/releases/tag/');
  availableUpdate=valid?update:null;
  if(valid){
  $('update-version').textContent=update.version.startsWith('v')?update.version:`v${update.version}`;
  $('update-link').href=update.url;
  }
  renderUpdateNotice();
  clearTimeout(updatePollTimer);updatePollTimer=setTimeout(refreshUpdateNotice,update_check_complete?6*60*60*1000:5000);
 }catch{clearTimeout(updatePollTimer);updatePollTimer=setTimeout(refreshUpdateNotice,60_000);}
}
const updateButton=$('update-button'),updatePopover=$('update-popover');
let updateCloseTimer;
function openUpdatePopover(){
 clearTimeout(updateCloseTimer);updatePopover.hidden=false;updatePopover.setAttribute('aria-hidden','false');
 requestAnimationFrame(()=>updatePopover.classList.add('open'));updateButton.setAttribute('aria-expanded','true');
}
function closeUpdatePopover(){
 if(updatePopover.hidden)return;
 updatePopover.classList.remove('open');updatePopover.setAttribute('aria-hidden','true');updateButton.setAttribute('aria-expanded','false');
 clearTimeout(updateCloseTimer);updateCloseTimer=setTimeout(()=>{if(!updatePopover.classList.contains('open'))updatePopover.hidden=true;},260);
}
updateButton.onclick=()=>updatePopover.hidden?openUpdatePopover():closeUpdatePopover();
document.addEventListener('pointerdown',event=>{if(!event.target.closest('.update-wrap'))closeUpdatePopover();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!updatePopover.hidden){closeUpdatePopover();updateButton.focus();}});
refreshUpdateNotice();
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
 const before=state;state=next;state.received=Date.now()/1000;if(seekPending&&state.seek_id!==seekPending.seekId)seekPending=null;openLyricsDialog?.onState(before,state);
 // The header pill reports the TV, since that decides whether anything can play.
 $('connection-label').textContent=!state.player_connected?'Open /tv on a device':state.player_audio?'Device ready':'Tap Enable sound on the device';$('connection').classList.toggle('warn',!state.player_audio);$('connection').classList.toggle('off',!state.player_connected);renderUpdateNotice();
 document.body.dataset.theme=state.theme||'default';showNow(!before);showControls(before);showQueue(before);showClassic();classicUi?.render(state);syncResultCards();
 const ready=[state.current,...state.upcoming].filter(i=>i?.status==='ready').map(i=>i.key).join();
 if(ready!==readyKeys){readyKeys=ready;loadRecent();classicUi?.loadBook();}
}
// Now playing: a card at the top, handing over to the dock once scrolled away.
function showNow(first){
 const c=state.current,art=c?thumbnail(c.id):'';
 showHero(!!c,first);$('hero').classList.toggle('paused',!state.playing);$('hero-state').textContent=state.playing?'NOW SINGING':'PAUSED';
 for(const id of ['hero-play','dock-play']){$(id).classList.toggle('playing',!!(c&&state.playing));$(id).setAttribute('aria-label',state.playing?'Pause':'Play');$(id).disabled=!c;}
 $('hero-lyrics').disabled=$('dock-lyrics').disabled=!c;
 $('dock-now').setAttribute('aria-label',c?'Jump to currently playing song':'Open settings');
 // The card keeps its last song while it folds away.
 for(const id of c?['hero-art','hero-glow','dock-art']:['dock-art'])showImage($(id),art);
 if(c){$('hero-title').textContent=c.title;$('hero-artist').textContent=c.artist;}$('hero-length').textContent=clock(c?.duration);
 $('hero-offset').textContent=`${Number(state.offset)>=0?'+':''}${Number(state.offset||0).toFixed(1)}s`;$('hero-offset-earlier').disabled=$('hero-offset-later').disabled=!c;
 $('dock-title').textContent=c?.title||'Nothing playing';$('dock-artist').textContent=c?.artist||'';
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
function showPosition(){
 if(!state)return;
 const live=state.current&&state.playing&&state.position>0?Date.now()/1000-state.received:0;
 let position=Math.min(state.position+live,state.current?.duration||0);
 if(seekDrag?.mode==='horizontal')position=seekDrag.preview;
 else if(seekPending){if(state.current?.key!==seekPending.key||Date.now()>seekPending.expires)seekPending=null;else position=seekPending.position;}
 const fraction=state.current?.duration?position/state.current.duration:0;
 for(const id of ['hero-bar','dock-bar'])$(id).style.setProperty('--p',fraction);
 $('hero-bar').classList.toggle('scrubbing',seekDrag?.mode==='horizontal');
 $('hero-position').textContent=clock(position);$('hero-bar').setAttribute('aria-valuetext',clock(position));$('hero-bar').setAttribute('aria-valuenow',position);$('hero-bar').setAttribute('aria-valuemax',state.current?.duration||0);
}
setInterval(showPosition,500);
const seekBar=$('hero-bar');
seekBar.onpointerdown=e=>{
 if(!state?.current?.duration||(e.pointerType==='mouse'&&e.button!==0))return;
 const box=seekBar.getBoundingClientRect(),position=Math.min(state.position+(state.playing?Date.now()/1000-state.received:0),state.current.duration),thumb=box.left+(position/state.current.duration)*box.width;
 if(Math.abs(e.clientX-thumb)>22)return;
 seekDrag={id:e.pointerId,key:state.current.key,x:e.clientX,y:e.clientY,mode:'pending',preview:position};seekBar.setPointerCapture(e.pointerId);
};
seekBar.onpointermove=e=>{
 if(!seekDrag||seekDrag.id!==e.pointerId)return;
 const dx=e.clientX-seekDrag.x,dy=e.clientY-seekDrag.y;
 if(seekDrag.mode==='pending'&&Math.max(Math.abs(dx),Math.abs(dy))>=8){
  if(Math.abs(dx)>Math.abs(dy)*1.2)seekDrag.mode='horizontal';
  else if(Math.abs(dy)>Math.abs(dx)*1.2)seekDrag.mode='vertical';
 }
 if(seekDrag.mode==='horizontal'&&state.current?.key===seekDrag.key){const box=seekBar.getBoundingClientRect();seekDrag.preview=Math.max(0,Math.min(1,(e.clientX-box.left)/box.width))*state.current.duration;showPosition();}
};
seekBar.onpointerup=e=>{
 if(!seekDrag||seekDrag.id!==e.pointerId)return;
 const drag=seekDrag;seekDrag=null;
 if(drag.mode==='horizontal'&&state.current?.key===drag.key){seekPending={key:drag.key,position:drag.preview,seekId:state.seek_id,expires:Date.now()+1500};send({action:'seek',position:drag.preview});}
 showPosition();
};
seekBar.onpointercancel=e=>{if(seekDrag?.id===e.pointerId)seekDrag=null;showPosition();};
$('hero-bar').onkeydown=e=>{const step={ArrowLeft:-5,ArrowRight:5}[e.key];if(step&&state?.current){e.preventDefault();send({action:'seek',position:state.position+step});}};
for(const [id,delta] of [['hero-offset-earlier',-.5],['hero-offset-later',.5]])$(id).onclick=()=>{if(state?.current)send({action:'offset',delta});};
const playPause=()=>{haptic(8);send({action:state?.playing?'pause':'play'});};
$('hero-play').onclick=$('dock-play').onclick=playPause;
$('skip').onclick=()=>{haptic(12);send({action:'skip'});};
// The dock hides while the card is on screen; when the card leaves, the dock rises and its art drops in.
let heroVisible=false;
new IntersectionObserver(([entry])=>{
 const was=heroVisible;heroVisible=entry.isIntersecting;$('dock').classList.toggle('away',heroVisible);
 if(was&&!heroVisible&&!REDUCED.matches){
  $('dock-art').animate([{transform:'translateY(-24px) scale(1.2)',opacity:0},{transform:'none',opacity:1}],{duration:450,delay:120,easing:'cubic-bezier(.34,1.3,.64,1)',fill:'backwards'});
  $('dock').querySelector('.info').animate([{opacity:0,transform:'translateX(-8px)'},{opacity:1,transform:'none'}],{duration:350,delay:200,easing:'ease-out',fill:'backwards'});
 }
},{rootMargin:'0px 0px -40px 0px'}).observe($('hero'));
$('dock-now').onclick=()=>state?.current?$('hero').scrollIntoView({behavior:REDUCED.matches?'auto':'smooth',block:'center'}):openSheet();
$('dock-lyrics').onclick=()=>{if(state?.current)pickLyrics(state.current,{followCurrent:true});};
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
// Controls sheet: mix, key, speed and TV display.
function showControls(before){
 for(const id of ['skip','key-down','key-up'])$(id).disabled=!state.current;
 for(const [id,value] of [['vocal',state.vocal],['music',state.music],['speed',state.speed],['lyric-scale',state.lyric_scale]]){
  if(document.activeElement!==$(id)&&!gliding)$(id).value=value;$(`${id}-value`).textContent=`${Math.round(value*100)}%`;
 }
 for(const b of document.querySelectorAll('.presets button'))b.setAttribute('aria-pressed',Math.abs(b.dataset.vocal-state.vocal)<.005&&Math.abs(b.dataset.music-state.music)<.005);
 $('key-down').disabled||=state.key<=-6;$('key-up').disabled||=state.key>=6;
 if(state.key!==before?.key)rollKey(state.key,before?state.key-before.key:0);
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
$('key-reset').onclick=()=>{send({action:'speed',value:1});send({action:'key',value:0});};
function dragOnlyRange(input){
 const control=el('div',undefined,'range-control'),hit=el('div',undefined,'range-hit');
 input.before(control);control.append(input,hit);hit.setAttribute('aria-hidden','true');
 let gesture=null;
 const geometry=()=>{
  const rect=input.getBoundingClientRect(),classicMix=document.body.dataset.theme==='classic'&&input.closest('.mixline'),left=rect.left+(classicMix?52:2),width=Math.max(1,rect.width-(classicMix?62:4));
  return {left,width};
 };
 const ratio=()=>{const min=Number(input.min)||0,max=Number(input.max)||100;return Math.max(0,Math.min(1,(Number(input.value)-min)/(max-min||1)));};
 const update=x=>{
  const {left,width}=geometry(),min=Number(input.min)||0,max=Number(input.max)||100,step=Number(input.step)||0,value=min+Math.max(0,Math.min(1,(x-left)/width))*(max-min);
  input.value=String(step?min+Math.round((value-min)/step)*step:value);
  input.dispatchEvent(new Event('input',{bubbles:true}));
 };
 hit.onpointerdown=e=>{
  if(input.disabled||(e.pointerType==='mouse'&&e.button!==0))return;
  const {left,width}=geometry(),thumb=left+ratio()*width;
  if(Math.abs(e.clientX-thumb)>22)return;
  input.focus({preventScroll:true});gesture={id:e.pointerId,x:e.clientX,y:e.clientY,mode:'pending'};hit.setPointerCapture(e.pointerId);
 };
 hit.onpointermove=e=>{
  if(!gesture||gesture.id!==e.pointerId)return;
  const dx=e.clientX-gesture.x,dy=e.clientY-gesture.y;
  if(gesture.mode==='pending'&&Math.max(Math.abs(dx),Math.abs(dy))>=8){
   if(Math.abs(dx)>Math.abs(dy)*1.2)gesture.mode='horizontal';
   else if(Math.abs(dy)>Math.abs(dx)*1.2)gesture.mode='vertical';
  }
  if(gesture.mode==='horizontal')update(e.clientX);
 };
 const finish=e=>{if(gesture?.id===e.pointerId)gesture=null;};
 hit.onpointerup=finish;hit.onpointercancel=finish;
}
for(const id of ['vocal','music','speed','lyric-scale'])dragOnlyRange($(id));
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
$('hero-lyrics').onclick=()=>{if(state?.current)pickLyrics(state.current,{followCurrent:true});};
function openSheet(){document.body.classList.add('sheet-open');$('sheet').inert=false;haptic(8);requestAnimationFrame(()=>SEGMENTED.forEach(placePill));}
function closeSheet(){document.body.classList.remove('sheet-open');$('sheet').inert=true;}
$('open-controls').onclick=()=>document.body.dataset.theme==='classic'?classicUi.setTab('settings'):openSheet();
$('scrim').onclick=closeSheet;
let suppressHandleClick=false;
$('sheet-handle').onclick=()=>{if(suppressHandleClick){suppressHandleClick=false;return;}closeSheet();};
// Classic theme: room time in Settings. Classic is always two-line lyrics.
function showClassic(){const on=state.theme==='classic';$('room-time').hidden=!on;document.querySelector('[data-action=lyric_mode]').closest('.seg-row').hidden=on;roomLeft();}
function roomLeft(){if(!state?.room_ends)return;const left=secondsLeft(state),end=new Date(state.room_ends*1000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
 if(state.theme==='classic'){const lcd=el('span',String(Math.ceil(left/60)).padStart(3,'0'),'lcd');lcd.dataset.ghost='888';$('room-left').replaceChildren(lcd,el('span','분','u'));$('room-time').classList.toggle('up',!left);$('room-end').textContent=left?`종료 예정\n${end}`:'시간 종료\nTIME\'S UP';return;}
 $('room-left').textContent=left?`${Math.ceil(left/60)}분 left`:'Time is up';$('room-end').textContent=`${end} 종료`;}
setInterval(roomLeft,1000);
for(const b of document.querySelectorAll('[data-minutes]'))b.onclick=()=>{haptic(6);send({action:'add_time',minutes:+b.dataset.minutes});};
addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(openLyricsDialog)openLyricsDialog.close();else if(document.body.classList.contains('sheet-open'))closeSheet();});
// Drag only the handle to dismiss the settings sheet, leaving the content area free to scroll.
{
 const sheet=$('sheet'),handle=$('sheet-handle');let startY=null,movedHandle=false;
 handle.onpointerdown=e=>{if(document.body.dataset.theme==='classic'||(e.pointerType==='mouse'&&e.button!==0))return;e.preventDefault();startY=e.clientY;movedHandle=false;sheet.style.transition='none';handle.setPointerCapture(e.pointerId);};
 handle.onpointermove=e=>{if(startY===null)return;const distance=Math.max(0,e.clientY-startY);if(distance>8)movedHandle=true;sheet.style.transform=`translateY(${distance}px)`;};
 handle.onpointerup=e=>{if(startY===null)return;const distance=e.clientY-startY;startY=null;sheet.style.transition='';sheet.style.transform='';suppressHandleClick=movedHandle;if(movedHandle)setTimeout(()=>{suppressHandleClick=false;},300);if(distance>100)closeSheet();};
 handle.onpointercancel=()=>{startY=null;sheet.style.transition='';sheet.style.transform='';};
}
// Queue. Rebuilt only when its songs or statuses change, so position reports never swap a button
// out from under a tap; preparation progress updates in place. A drag holds rebuilds until it ends.
let queueShape,dragging=null,swipingQueue=null;
const QUEUE_PAGE_SIZE=10;
let queueVisibleCount=QUEUE_PAGE_SIZE;
const RING=2*(49+49-4*14.5)+2*Math.PI*14.5;
const RING_SEGMENT=RING*.22,RING_GAP=RING-RING_SEGMENT;
const statusText=item=>item.status==='ready'?'Ready':item.status==='error'?'Failed':prepLabel(item).text;
const queueRenderShape=()=>JSON.stringify([!!state.current,...state.upcoming.map(i=>[i.key,i.title,i.artist,i.status,i.error])]);
// Classic shows the machine's Korean status beside it.
const STATUS_KO={queued:'대기 중',downloading:'다운로드 중',separating:'보컬 분리 중',searching_synced_lyrics:'싱크 가사 검색 중',aligning_lyrics:'가사 싱크 조정 중',ready:'준비 완료',error:'준비 실패'};
const statusKo=(item,index)=>index===0&&item.status==='ready'?'다음곡':STATUS_KO[item.status]||'';
function showQueue(before){
 const count=state.upcoming.length;$('queue-count').textContent=$('dock-count').textContent=count;
 queueVisibleCount=Math.max(QUEUE_PAGE_SIZE,Math.min(queueVisibleCount,count||QUEUE_PAGE_SIZE));
 $('queue-collapse').hidden=queueVisibleCount<=QUEUE_PAGE_SIZE||count<=QUEUE_PAGE_SIZE;
 $('queue-collapse').setAttribute('aria-expanded',String(queueVisibleCount>QUEUE_PAGE_SIZE));
 const remaining=Math.max(0,count-queueVisibleCount),showCount=Math.min(QUEUE_PAGE_SIZE,remaining);
 $('queue-more').hidden=remaining===0;
 $('queue-more').textContent=`Show ${showCount} more · ${remaining} remaining`;
 if(before&&count>before.upcoming.length&&!REDUCED.matches)for(const id of ['queue-count','dock-count']){const c=$(id);c.classList.remove('bump');void c.offsetWidth;c.classList.add('bump');}
 const shape=queueRenderShape();  // lyrics-source updates are patched into their button without rebuilding rows
 if(shape!==queueShape&&!dragging&&!swipingQueue){
  if(openSwipe?.classList.contains('queue-swipe'))closeSwipe();
  // A song that turns ready while queued flashes its ring once.
  const preparing=new Set(before?.upcoming.filter(i=>i.status!=='ready').map(i=>i.key));
  // FLIP: remember where each row was, rebuild, then animate rows from their old spots.
  const tops=new Map([...$('queue').children].filter(row=>row.dataset.key).map(row=>[row.dataset.key,row.getBoundingClientRect().top]));
  queueShape=shape;
  $('queue').replaceChildren(...state.upcoming.slice(0,queueVisibleCount).map((item,index)=>queueRow(item,index,preparing.has(item.key))));
  if(!count)$('queue').append(emptyQueue());
  if(tops.size&&!REDUCED.matches)for(const row of $('queue').children){
   if(!row.dataset.key)continue;
   const was=tops.get(row.dataset.key),top=row.getBoundingClientRect().top;
   if(was===undefined)row.animate([{opacity:0,transform:'translateY(-12px) scale(.96)'},{opacity:1,transform:'none'}],{duration:450,easing:SPRING});
   else if(Math.abs(was-top)>1)row.animate([{transform:`translateY(${was-top}px)`},{transform:'none'}],{duration:500,easing:SPRING});
  }
 }
 for(const [index,item] of state.upcoming.entries()){
  const row=$('queue').querySelector(`.queue-swipe[data-key="${item.key}"]`);if(!row)continue;
  row.querySelector('.status').textContent=statusText(item);row.querySelector('.status-ko').textContent=statusKo(item,index);row.querySelector('.prepbar')?.style.setProperty('--p',item.progress||0);
  setQueueLyricsButton(row.querySelector('.lyrics-button'),item);
  const ring=row.querySelector('.ring');if(ring){ring.style.setProperty('--p',item.progress||0);ring.classList.toggle('busy',!item.progress&&item.status!=='ready');}
 }
}
$('queue-more').onclick=()=>{queueVisibleCount=Math.min(state.upcoming.length,queueVisibleCount+QUEUE_PAGE_SIZE);queueShape=null;showQueue(state);};
$('queue-collapse').onclick=()=>{queueVisibleCount=QUEUE_PAGE_SIZE;queueShape=null;showQueue(state);$('queue-heading').scrollIntoView({block:'start',behavior:REDUCED.matches?'auto':'smooth'});};
// An empty queue invites the next song, with a button straight to the search box.
function emptyQueue(){
 const box=el('div',undefined,'empty'),icon=el('span',undefined,'empty-icon'),find=el('button','Find a song','empty-action');
 icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
 find.onclick=()=>{if(document.body.dataset.theme==='classic')classicUi.setTab('book');$('search-form').scrollIntoView({behavior:REDUCED.matches?'auto':'smooth',block:'center'});$('query').focus({preventScroll:true});};
 const lcd=el('span','00',`lcd classic-only${state.current?'':' dim'}`);lcd.dataset.ghost='88';
 box.append(lcd,icon,el('b','예약곡이 없어요','classic-only'),el('strong',state.current?'Nothing up next':'The queue is empty'),el('small',state.current?'Add a song and it plays when this one ends.':'Add a song and it starts right away.'),find);
 return box;
}
const QUEUE_LYRICS_LABELS={processing:['Checking…','processing'],synced:['Synced','synced'],plain:['Plain','plain'],missing:['No lyrics','missing'],error:['Issue','error'],unknown:['Check lyrics','unknown']};
function queueLyricsState(item){
 const source=item.viewer_lyrics_source;
 if(source&&source!=='unknown')return source;
 if(item.lyrics_status==='processing')return 'processing';
 if(item.lyrics_status==='ready')return 'synced';
 if(item.lyrics_status==='error')return 'error';
 return 'unknown';
}
function setQueueLyricsButton(button,item){
 if(!button)return;
 const source=queueLyricsState(item),[label]=QUEUE_LYRICS_LABELS[source]||QUEUE_LYRICS_LABELS.unknown;
 button.textContent=label;button.dataset.lyricsSource=source;
 button.setAttribute('aria-label',`${label} lyrics for ${item.title}. Open lyrics viewer and settings.`);
}
function queueRow(item,index,justReady){
 const wrap=el('div',undefined,'swipe queue-swipe');wrap.dataset.key=item.key;
 const next=el('button','Next','queue-swipe-action queue-next');next.type='button';next.setAttribute('aria-label',`Move ${item.title} to play next`);next.onclick=()=>prioritizeQueueItem(item.key);
 const remove=el('button','Remove','queue-swipe-action queue-remove');remove.type='button';remove.setAttribute('aria-label',`Remove ${item.title} from the queue`);remove.onclick=()=>removeQueueItem(item);
 const row=el('article',undefined,`row ${item.status}`);
 const thumb=el('div',undefined,'thumb'),image=el('img',undefined,'art');image.src=thumbnail(item.id);image.alt='';image.draggable=false;thumb.append(image);
 // The ring shows while the song prepares, and once more as it turns ready.
 if(item.status!=='ready'&&item.status!=='error'||justReady&&item.status==='ready')thumb.insertAdjacentHTML('beforeend',`<svg class="ring" viewBox="0 0 52 52" style="--c:${RING};--segment:${RING_SEGMENT};--gap:${RING_GAP};--travel:${-RING}" aria-hidden="true"><path class="track" d="M26 1.5H36A14.5 14.5 0 0 1 50.5 16V36A14.5 14.5 0 0 1 36 50.5H16A14.5 14.5 0 0 1 1.5 36V16A14.5 14.5 0 0 1 16 1.5H26Z"/><path class="fill" d="M26 1.5H36A14.5 14.5 0 0 1 50.5 16V36A14.5 14.5 0 0 1 36 50.5H16A14.5 14.5 0 0 1 1.5 36V16A14.5 14.5 0 0 1 16 1.5H26Z"/></svg>`);
 if(justReady&&item.status==='ready')haptic(10);
 const info=el('div',undefined,'info'),line=el('p');if(item.number)line.append(el('span',String(item.number),'qnum classic-only'),' ');line.append(item.artist,...(justReady&&item.status==='ready'?[el('em','준비 완료','ready-lamp classic-only')]:[]),el('span',' · ','sep'),el('span',statusKo(item,index),'status-ko classic-only'),el('span',statusText(item),'status'));
 info.append(el('h3',item.title),line);
 if(item.status!=='ready'&&item.status!=='error'){const bar=el('div',undefined,'prepbar classic-only');bar.append(el('i'));info.append(bar);}
 if(item.error){const retry=el('button','Retry','retry');retry.onclick=()=>send({action:'retry',key:item.key});info.append(el('p',item.error,'error'),retry);}
 // Classic: 우선 moves a song to sing next, as on the machine.
 const first=el('button','우선','row-button first classic-only');first.setAttribute('aria-label',`Play ${item.title} next`);first.hidden=index===0;
 first.onclick=()=>{haptic(8);move(index,0);toast(`${item.title} 우선예약`);};
 const lyricsButton=el('button',undefined,'row-button lyrics-button');setQueueLyricsButton(lyricsButton,item);lyricsButton.onclick=()=>pickLyrics(item);
 const num=el('span',String(index+1),'num');num.tabIndex=0;num.setAttribute('role','group');num.setAttribute('aria-label',`Position ${index+1}. Focus and use the up or down arrow keys to reorder.`);
 num.onkeydown=e=>{const to=index+({ArrowUp:-1,ArrowDown:1}[e.key]||0);if(to!==index&&to>=0&&to<state.upcoming.length){e.preventDefault();move(index,to);}};
 row.append(num,thumb,info,lyricsButton,first);
 wrap.append(next,remove,row);
 queueSwipeHandlers(wrap,row,item.key);
 dragHandlers(wrap,row);
 return wrap;
}
function move(from,to){const keys=state.upcoming.map(i=>i.key);keys.splice(to,0,...keys.splice(from,1));send({action:'reorder',keys});}
function prioritizeQueueItem(key){
 const index=state.upcoming.findIndex(item=>item.key===key);if(index<=0)return;
 haptic(10);move(index,0);toast('Moved to next');
}
function removeQueueItem(item){
 const wrap=$(`.queue-swipe[data-key="${item.key}"]`);if(openSwipe===wrap)closeSwipe();
 send({action:'remove',key:item.key});toast(`Removed ${item.title}`,{label:'Undo',run:()=>send({action:'undo'})});
}
// Long-press a non-button part of a row for 350 ms to drag it to any position.
document.addEventListener('touchmove',e=>{if(dragging)e.preventDefault();},{passive:false});
function dragHandlers(wrap,row){
 let press,startX,startY;
 row.addEventListener('contextmenu',e=>e.preventDefault());
 row.addEventListener('pointerdown',e=>{
  if(e.target.closest('button'))return;
  startX=e.clientX;startY=e.clientY;press=setTimeout(()=>startDrag(wrap,e),350);
 });
 const cancel=e=>{if(e.type!=='pointermove'||Math.hypot(e.clientX-startX,e.clientY-startY)>8)clearTimeout(press);};
 for(const type of ['pointermove','pointerup','pointercancel'])row.addEventListener(type,cancel);
}
function queueSwipeHandlers(wrap,row,key){
 let start=null,dx=0,base=0,swiping=false,startedOnRemove=false;
 wrap.addEventListener('pointerdown',e=>{
  const action=e.target.closest('.queue-remove');
  if((e.target.closest('button')&&!action)||(e.pointerType==='mouse'&&e.button!==0))return;
  start={x:e.clientX,y:e.clientY};base=wrap.classList.contains('open')?-REVEAL:0;dx=base;swiping=false;
  startedOnRemove=!!action&&base<0;
 });
 wrap.addEventListener('pointermove',e=>{
  if(!start||dragging)return;
  const mx=e.clientX-start.x,my=e.clientY-start.y;
  if(!swiping){if(Math.abs(my)>8&&Math.abs(my)>Math.abs(mx)){start=null;return;}if(Math.abs(mx)<8)return;swiping=true;swipingQueue=wrap;wrap.setPointerCapture(e.pointerId);wrap.classList.add('dragging');if(openSwipe&&openSwipe!==wrap)closeSwipe();}
  dx=Math.max(-REVEAL*1.25,Math.min(REVEAL*1.25,base+mx));row.style.transform=`translateX(${dx}px)`;
 });
 const end=()=>{
  if(!start)return;start=null;wrap.classList.remove('dragging');if(!swiping){if(base<0&&!startedOnRemove)closeSwipe();finishQueueSwipe();return;}
  row.dataset.swiped='1';
  if(base<0){
   if(dx>-REVEAL/2){wrap.classList.remove('open');row.style.transform='';if(openSwipe===wrap)openSwipe=null;}
   else{wrap.classList.add('open');row.style.transform=`translateX(${-REVEAL}px)`;openSwipe=wrap;}
  }else if(dx<-REVEAL/2){row.style.transform=`translateX(${-REVEAL}px)`;wrap.classList.add('open');openSwipe=wrap;}
  else if(dx>REVEAL/2){row.style.transform='';prioritizeQueueItem(key);}
  else row.style.transform='';
  finishQueueSwipe();
 };
 const cancel=()=>{if(!start)return;start=null;wrap.classList.remove('dragging');row.style.transform=base<0?`translateX(${-REVEAL}px)`:'';finishQueueSwipe();};
 wrap.addEventListener('pointerup',end);wrap.addEventListener('pointercancel',cancel);
}
function finishQueueSwipe(){swipingQueue=null;if(!dragging&&queueShape!==queueRenderShape()){queueShape=null;showQueue(state);}}
function startDrag(row,e){
 if(dragging)return;
 if(row.classList.contains('queue-swipe')&&openSwipe===row)closeSwipe();
 if(e.pointerType==='touch'||e.pointerType==='pen'){try{row.setPointerCapture(e.pointerId);}catch{}}
 const rows=[...$('queue').children].filter(r=>r.dataset.key),from=rows.indexOf(row),boxes=rows.map(r=>r.getBoundingClientRect());
 dragging={row,from,to:from,y:e.clientY,rows,keys:rows.map(r=>r.dataset.key),allKeys:state.upcoming.map(item=>item.key),boxes,height:boxes[from].height};
 row.classList.add('lifted');for(const r of rows)if(r!==row)r.classList.add('shifting');
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
   const liveKeys=state.upcoming.map(item=>item.key);
   if(liveKeys.length!==d.allKeys.length||liveKeys.some((key,index)=>key!==d.allKeys[index])){queueShape=null;showQueue(state);toast('Queue changed while dragging. Please try again.',undefined,'err');return;}
   const order=[...d.keys];order.splice(d.to,0,...order.splice(d.from,1));
   // Only the visible prefix is draggable; keep every undisplayed song in its original order after it.
   const visible=new Set(d.keys),completeOrder=[...order,...d.allKeys.filter(key=>!visible.has(key))];
   const currentItems=new Map(state.upcoming.map(item=>[item.key,item]));
   if(completeOrder.length!==currentItems.size||completeOrder.some(key=>!currentItems.has(key))){queueShape=null;showQueue(state);toast('Queue changed while dragging. Please try again.',undefined,'err');return;}
   state={...state,upcoming:completeOrder.map(key=>currentItems.get(key))};queueShape=null;
   send({action:'reorder',keys:completeOrder});
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
  songs.forEach(song=>showResult({...song,channel:song.artist,parsed:{artist:song.artist,title:song.title}},$('recent'),row=>swipeable(row,song,{recentNext:true})));
  if(!songs.length)$('recent').append(emptyNote('♪','아직 부른 노래가 없어요','Nothing sung yet.'));
 }catch{}
}
// Search in pages of 10; "More results" appends the next page.
let search={query:'',page:0,seen:new Set()},searchRun=0;
const enqueue=song=>api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title})});
const enqueueNext=song=>api('/api/queue/next',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title})});
// Queue-copy counts include the current song and every non-failed upcoming item.
function queueCopies(id){return [state?.current,...(state?.upcoming||[])].filter(item=>item?.id===id&&item.status!=='error').length;}
function syncResultCard(button){
 if(!button?.dataset.videoId)return;
 const id=button.dataset.videoId,count=queueCopies(id),status=button.querySelector('.result-icon'),note=button.querySelector('.result-note');
 const confirming=button.dataset.confirm==='1';button.dataset.queueCount=String(count);
 if(confirming){icon(status,'confirm');button.setAttribute('aria-label',`Confirm adding ${button.dataset.title} to the queue again`);return;}
 if(count){button.classList.add('added');button.classList.remove('failed');
  if(count===1)icon(status,'added');else{status.className='result-icon count';status.textContent=String(count);}
  note?.replaceChildren(el('em',count===1?'예약됨':`${count}회 예약`),` · ${count===1?'queued':'copies queued'}`);
  button.setAttribute('aria-label',`${button.dataset.title}, ${count} ${count===1?'copy':'copies'} in the queue. Activate to add another copy.`);
 }else{
  button.classList.remove('added');if(!button.classList.contains('failed'))icon(status,'add');
  if(!button.classList.contains('failed'))note?.replaceChildren();
  button.setAttribute('aria-label',`Add ${button.dataset.title} to the queue`);
 }
}
function syncResultCards(){document.querySelectorAll('.result[data-video-id]').forEach(syncResultCard);}
function applyQueueItem(item,front=false){
 if(!state||!item?.key)return;
 const existingIndex=state.upcoming.findIndex(candidate=>candidate.key===item.key);
 if(state.current?.key===item.key||existingIndex>=0&&(!front||existingIndex===0))return;
 const upcoming=state.upcoming.filter(candidate=>candidate.key!==item.key);
 if(state.current?.key!==item.key)upcoming.splice(front?0:upcoming.length,0,item);
 render({...state,upcoming});
}
// Result button states: add, queued check/count, confirm another, or failed.
const ICONS={add:'<path d="M12 5v14M5 12h14"/>',added:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',confirm:'<path d="M12 5v14M5 12h14"/>',failed:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'};
function icon(node,name){node.className=`result-icon ${name}`;node.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;}
// One tap queues the song with the artist/title parsed from YouTube (or confirmed earlier, for recent songs).
function showResult(song,list=$('results'),wrap=row=>row,index=-1){
 const b=el('button',undefined,index<0?'result':'result enter');b.dataset.videoId=song.id;b.dataset.title=song.title;if(index>=0)b.style.setProperty('--i',index);
 const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div');const title=el('strong',song.title);if(song.cached)title.append(el('span','READY','tag'));const note=el('small',undefined,'result-note classic-only');info.append(title,el('small',`${song.channel} · ${clock(song.duration)}`),note);const status=el('span');icon(status,'add');b.append(image,info,status);
 b.onclick=async()=>{
  // A swipe ends in a click; an open row closes on tap instead of queueing.
  if(b.dataset.dragged){delete b.dataset.dragged;return;}if(b.parentElement?.classList.contains('open')){closeSwipe();return;}
  if(b.disabled)return;
  if(queueCopies(song.id)>0&&b.dataset.confirm!=='1'){
   b.dataset.confirm='1';syncResultCard(b);toast(`Add ${song.title} again? Tap the orange + to confirm.`);
   clearTimeout(b.confirmTimer);b.confirmTimer=setTimeout(()=>{delete b.dataset.confirm;syncResultCard(b);},4500);return;
  }
  clearTimeout(b.confirmTimer);delete b.dataset.confirm;
  b.disabled=true;
  try{const item=await enqueue({id:song.id,...song.parsed});applyQueueItem(item);haptic([10,40,10]);flyToQueue(image);toast(`Added ${song.parsed.title}`);}
  catch(error){icon(status,'failed');b.classList.add('failed');note.replaceChildren("Couldn't add. Try again");toast(error.message,undefined,'err');}finally{b.disabled=false;syncResultCard(b);}
 };
 list.append(wrap(b));syncResultCard(b);
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
// Recent and Queue rows share the one-open-swipe behavior.
const REVEAL=96;let openSwipe=null;
function closeSwipe(){if(!openSwipe)return;openSwipe.classList.remove('open');const surface=openSwipe.querySelector('.result,.row');if(surface)surface.style.transform='';openSwipe=null;}
document.addEventListener('pointerdown',e=>{if(openSwipe&&!openSwipe.contains(e.target))closeSwipe();});
function lyricsSearchTerms(artist,title){
 const terms=[],seen=new Set(),add=(value,selected=false)=>{value=String(value||'').trim();const key=value.normalize('NFKC').toLocaleLowerCase();if(value&&value.length<=100&&!seen.has(key)){seen.add(key);terms.push({value,selected});}};
 const quoted=/[「『【“"]([^」』】”"]+)[」』】”"]/gu,quotedValues=[...String(title||'').matchAll(quoted)].map(match=>match[1].trim());
 add(artist,true);quotedValues.forEach((value,index)=>add(value,index===0));
 if(!quotedValues.length)add(title,true);
 for(const part of String(title||'').split(/\s*[×x]\s*|\s*[|｜]\s*|\s+[—–-]\s+/u)){
  const remainder=part.replace(quoted,' ').replace(/[「」『』【】“”"]/gu,' ').replace(/\s+/g,' ').trim();
  if(!remainder||remainder.normalize('NFKC').toLocaleLowerCase()===String(artist||'').trim().normalize('NFKC').toLocaleLowerCase())continue;
  add(remainder);for(const word of remainder.split(/\s+/u))if(word.length>1)add(word);
 }
 return terms.slice(0,10);
}

// Shared two-tab reader/picker. The reader uses raw cached LRC/plain text, never TV timing data.
async function pickLyrics(song,{followCurrent=false}={}){
 if(openLyricsDialog)openLyricsDialog.close();
 let targetKey=song.key||null,follow=followCurrent,closed=false,viewToken=0,searchToken=0,searchLoaded=false,lastText=null,lastTextKey=null;
 const sheet=el('div',undefined,'lyric-sheet'),panel=el('div',undefined,'lyric-sheet-panel'),grip=el('button',undefined,'lyric-sheet-grip');grip.type='button';grip.setAttribute('aria-label','Close Lyrics panel');
 const tabs=el('div',undefined,'lyric-tabs'),viewTab=el('button','View'),chooseTab=el('button','Select Lyrics');viewTab.type=chooseTab.type='button';
 const viewPane=el('section',undefined,'lyric-view-pane'),viewStatus=el('p','Loading lyrics…','lyric-view-status'),reader=el('pre',undefined,'lyric-reader');
 const viewControls=el('div',undefined,'lyric-view-controls');
 const fontControls=el('div',undefined,'lyric-font-controls'),smaller=el('button','A−'),larger=el('button','A+');smaller.type=larger.type='button';smaller.setAttribute('aria-label','Decrease lyrics font size');larger.setAttribute('aria-label','Increase lyrics font size');
 let fontSize=17;try{fontSize=Math.max(13,Math.min(30,Number(localStorage.getItem('ktvibes-lyrics-font-size'))||17));}catch{}
 const setFont=()=>reader.style.fontSize=`${fontSize}px`;setFont();
 const choosePane=el('section',undefined,'lyric-choose-pane'),chooseStatus=el('p',undefined,'lyric-choose-status muted'),form=el('form',undefined,'lyric-search'),input=el('input'),go=el('button','Search'),termPicker=el('div',undefined,'lyric-search-terms'),preview=el('div',undefined,'lyric-preview'),list=el('div',undefined,'lyric-options'),chooseActions=el('div',undefined,'lyric-choose-actions'),unavailable=el('button','No suitable lyrics','lyric-unavailable');
 unavailable.type='button';chooseActions.append(unavailable);
 input.type='search';input.placeholder='Artist, title, or search terms';input.setAttribute('aria-label','Search lyrics');go.type='submit';form.append(input,go);
 let searchTerms=[],searchCooldownTimer=null;
 const syncSearchTermButtons=()=>{const query=input.value.toLocaleLowerCase();for(const button of termPicker.querySelectorAll('button')){const value=button.dataset.term,key=value.toLocaleLowerCase(),active=query.includes(key);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}};
 const setSearchTermTarget=target=>{
  searchTerms=lyricsSearchTerms(target?.artist,target?.title);termPicker.replaceChildren();
  if(!searchTerms.length){termPicker.hidden=true;input.value=`${target?.artist||''} ${target?.title||''}`.trim();return;}
  termPicker.hidden=false;
  for(const term of searchTerms){const chip=el('button',term.value,'lyric-search-term');chip.type='button';chip.dataset.term=term.value;chip.setAttribute('aria-pressed','false');chip.onclick=()=>{
    const query=input.value,needle=term.value,lower=query.toLocaleLowerCase(),key=needle.toLocaleLowerCase(),at=lower.indexOf(key);
    if(at>=0){input.value=`${query.slice(0,at)} ${query.slice(at+needle.length)}`.replace(/\s+/g,' ').trim();}
    else input.value=[query.trim(),needle].filter(Boolean).join(' ');
    syncSearchTermButtons();
   };termPicker.append(chip);}
  input.value=searchTerms.filter(term=>term.selected).map(term=>term.value).join(' ');syncSearchTermButtons();
 };
 setSearchTermTarget(song);input.addEventListener('input',syncSearchTermButtons);
 fontControls.append(smaller,larger);viewControls.append(fontControls);viewPane.append(viewControls,viewStatus,reader);
 tabs.append(viewTab,chooseTab);panel.append(grip,tabs,viewPane,choosePane);sheet.append(panel);document.body.append(sheet);
 const shut=()=>{if(closed)return;closed=true;viewToken++;searchToken++;clearTimeout(searchCooldownTimer);sheet.classList.add('out');sheet.addEventListener('animationend',()=>sheet.remove(),{once:true});if(openLyricsDialog?.sheet===sheet)openLyricsDialog=null;};
 let gripStart=null,gripMoved=false;
 grip.onclick=()=>{if(gripMoved){gripMoved=false;return;}shut();};
 grip.onpointerdown=e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();gripStart=e.clientY;gripMoved=false;panel.style.transition='none';grip.setPointerCapture(e.pointerId);};
 grip.onpointermove=e=>{if(gripStart===null)return;const distance=Math.max(0,e.clientY-gripStart);if(distance>8)gripMoved=true;panel.style.transform=`translateY(${distance}px)`;};
 grip.onpointerup=e=>{if(gripStart===null)return;const distance=e.clientY-gripStart;gripStart=null;panel.style.transition='';panel.style.transform='';if(distance>100)shut();};
 grip.onpointercancel=()=>{gripStart=null;panel.style.transition='';panel.style.transform='';};
 sheet.onclick=e=>{if(e.target===sheet)shut();};
 const setTab=tab=>{const viewing=tab==='view';viewPane.hidden=!viewing;choosePane.hidden=viewing;viewTab.classList.toggle('active',viewing);chooseTab.classList.toggle('active',!viewing);viewTab.setAttribute('aria-selected',String(viewing));chooseTab.setAttribute('aria-selected',String(!viewing));if(!viewing&&!searchLoaded){searchLoaded=true;show(input.value.trim());}};
 viewTab.onclick=()=>setTab('view');chooseTab.onclick=()=>setTab('choose');setTab('view');
 const liveTarget=()=>targetKey?(state?.current?.key===targetKey?state.current:state?.upcoming?.find(item=>item.key===targetKey)):null;
 const pickerTarget=()=>liveTarget()||(!targetKey&&!follow?song:null);
 const eligibleQueue=()=>state?.upcoming?.find(item=>item.key===targetKey&&item.status==='ready');
 const isCurrent=()=>!!(state?.current&&targetKey&&state.current.key===targetKey);
 function refreshControls(){const pending=state?.upcoming?.find(item=>item.key===targetKey),current=isCurrent(),editable=!!(eligibleQueue()||current||pending||(!targetKey&&!follow&&song.id));form.hidden=!editable;const preparing=!!(pending&&pending.status!=='ready');chooseStatus.textContent=preparing?'Plain lyrics can be saved while this song prepares. Synced selection is available when ready.':'';chooseStatus.hidden=!preparing;}
 async function loadView(){
  const key=targetKey,mine=++viewToken;if(!key){viewStatus.textContent='Open Lyrics from the current song or a queued song to read lyrics.';reader.textContent='';return;}
  const target=liveTarget();if(!target){viewStatus.textContent=reader.textContent?'Song is no longer in the queue.':'Song is no longer available.';return;}
  viewStatus.textContent='Loading lyrics…';
  try{
   const data=await api(`/api/lyrics/view/${encodeURIComponent(key)}`);if(closed||mine!==viewToken||key!==targetKey)return;
   if(!liveTarget()){viewStatus.textContent=reader.textContent?'Song is no longer in the queue.':'Song is no longer available.';return;}
   if(data.status==='ready'){
    const text=String(data.text||'');const changed=lastTextKey!==key||lastText!==text;
    if(changed){reader.textContent=text;if(lastTextKey!==key||lastText!==text)reader.scrollTop=0;lastText=text;lastTextKey=key;}
    viewStatus.textContent=data.source==='plain'?'Plain lyrics':'Synced lyrics';
   }else if(data.status==='missing'){if(!reader.textContent)viewStatus.textContent='No lyrics found. Try Select Lyrics to search.';else viewStatus.textContent='Could not refresh lyrics; showing the previous text.';}
   else{if(!reader.textContent)viewStatus.textContent='Could not load lyrics. Check your connection and try again.';else viewStatus.textContent='Connection issue; showing the previous text.';}
  }catch(error){if(closed||mine!==viewToken||key!==targetKey)return;if(!reader.textContent)viewStatus.textContent=`Could not load lyrics: ${error.message}`;else viewStatus.textContent='Connection issue; showing the previous text.';}
 }
 smaller.onclick=()=>{fontSize=Math.max(13,fontSize-1);setFont();try{localStorage.setItem('ktvibes-lyrics-font-size',fontSize);}catch{}};
 larger.onclick=()=>{fontSize=Math.min(30,fontSize+1);setFont();try{localStorage.setItem('ktvibes-lyrics-font-size',fontSize);}catch{}};
 async function loadPreview(){const item=eligibleQueue();if(!item)return;try{const data=await api(`/api/queue/${encodeURIComponent(targetKey)}/lyrics`);if(closed||!eligibleQueue())return;preview.replaceChildren(...(data.lyrics||[]).map(line=>el('p',line.text||'')));}catch(error){preview.replaceChildren(el('p',error.message,'error'));}}
 form.onsubmit=e=>{e.preventDefault();input.blur();show(input.value.trim());};
 async function show(query){
  if(go.disabled)return;
  chooseActions.hidden=true;
  const mine=++searchToken,target=pickerTarget(),searchedKey=targetKey;if(!target||!(eligibleQueue()||isCurrent()||state?.upcoming?.some(item=>item.key===targetKey)||(!targetKey&&!follow&&song.id)))return;
  const wait=el('p',query?'Searching…':'Looking up every version…','muted lyric-wait'),bar=el('span',undefined,'pbar busy classic-only');for(let i=0;i<40;i++){const cell=el('i');cell.style.animationDelay=`${(i*.045).toFixed(3)}s`;bar.append(cell);}wait.append(el('span',query?'검색 중':'모든 가사 버전을 찾는 중','classic-only'),bar);list.replaceChildren(wait);
  try{
   let data;
   if(searchedKey)data=await api(`/api/lyrics/choices/${encodeURIComponent(searchedKey)}?q=${encodeURIComponent(query||`${target.artist} ${target.title}`)}`);
   else{const legacy=await api(`/api/songs/${target.id}/lyrics${query?`?q=${encodeURIComponent(query)}`:''}`);data={synced_active:legacy.some(item=>item.current),results:legacy.map(item=>({id:item.id,track:item.track,artist:item.artist,album:item.album,difference:item.difference,formats:{synced:{available:true,current:item.current,language:item.language,lines:item.lines,preview:item.preview},plain:{available:false,selected:false,active:false,preview:[],lines:0}}}))};}
   if(closed||mine!==searchToken||searchedKey!==targetKey||!pickerTarget())return;
   chooseActions.hidden=!searchedKey;
   unavailable.textContent=data.selection_format==='none'?'Marked as unavailable':'No suitable lyrics';unavailable.disabled=data.selection_format==='none';
   const options=data.results||[];const none=el('p',undefined,'muted lyric-none');none.append(el('b','No suitable lyrics found','classic-only'),query?'Try fewer words, or use the song title in its original script.':'Search LRCLIB for synced or plain lyrics.');list.replaceChildren(...(options.length?[]:[none]));
   for(const o of options){
    const kinds=['synced','plain'].filter(kind=>o.formats[kind].available),selectedSynced=!!o.formats.synced.current,
     selectedPlain=!!(o.formats.plain.selected&&o.formats.plain.active),selected=selectedSynced||selectedPlain,
     track=o.track||'LRCLIB record',trackKey=String(track).trim().toLocaleLowerCase(),
     metadataParts=[o.artist,o.album].filter(Boolean).map(value=>String(value).trim()).filter((value,index,values)=>{const key=value.toLocaleLowerCase();return key!==trackKey&&values.findIndex(item=>item.toLocaleLowerCase()===key)===index;}),
     card=el('article',undefined,'lyric-option'+(selected?' current':'')),top=el('div',undefined,'lyric-card-head');
    top.append(el('b',track));if(metadataParts.length)top.append(el('span',metadataParts.join(' · ')));card.append(top);
    const formats=el('div',undefined,'lyric-formats');for(const kind of kinds)formats.append(el('span',kind==='synced'?'Synced':'Plain','lyric-format'));
    if(o.difference!==null&&o.difference!==undefined&&o.difference!==0)formats.append(el('span',`${Math.abs(o.difference)}s ${o.difference>0?'longer':'shorter'}`,'lyric-format lyric-duration'));
    card.append(formats);
    const block=el('div',undefined,'lyric-card-preview');for(const kind of kinds){const preview=el('div',undefined,'lyric-format-preview');if(kinds.length>1)preview.append(el('span',kind==='synced'?'Synced preview':'Plain preview'));for(const line of o.formats[kind].preview||[])preview.append(el('small',line));block.append(preview);}card.append(block);
    const actions=el('div',undefined,'lyric-card-actions');for(const kind of kinds){const active=kind==='synced'?selectedSynced:selectedPlain,label=active?'Selected':kinds.length>1?`Use ${kind==='synced'?'Synced':'Plain'}`:'Select',select=el('button',label);select.type='button';select.disabled=active||(kind==='synced'&&!!state?.upcoming?.some(item=>item.key===targetKey&&item.status!=='ready'));if(!active)select.onclick=()=>saveChoice(select,o,kind,target);actions.append(select);}if(kinds.length)card.append(actions);list.append(card);
   }
  }catch(error){if(mine===searchToken){chooseActions.hidden=true;const isBusy=error.status===503||error.message.includes('LRCLIB is temporarily busy'),isLimited=error.status===429||error.message.includes('LRCLIB is limiting lyric searches'),retryAfter=Math.max(1,Math.min(60,Math.ceil(error.retryAfter||(isLimited?Number(error.message.match(/wait (\d+) seconds/)?.[1])||5:1)))),message=el('p',isBusy?'LRCLIB is temporarily busy. Please wait 1 second, then try again.':isLimited?`LRCLIB is limiting lyric searches. Please wait ${retryAfter} seconds, then try again.`:'Lyrics search failed. Please try again.','error');list.replaceChildren(message);if(isBusy||isLimited){go.disabled=true;clearTimeout(searchCooldownTimer);searchCooldownTimer=setTimeout(()=>{if(!closed&&mine===searchToken)go.disabled=false;},retryAfter*1000);}}}
 }
 async function saveChoice(button,option,kind,target){
  const key=targetKey;if(button.disabled||button.dataset.saving)return;
  const destination=kind==='plain'?(key?`/api/lyrics/plain/${encodeURIComponent(key)}`:null):state?.current?.key===key&&key?`/api/songs/${target.id}/lyrics`:eligibleQueue()?`/api/queue/${encodeURIComponent(key)}/lyrics`:!key&&!follow?`/api/songs/${target.id}/lyrics`:null;
  if(!destination){toast('This song is no longer available for lyrics settings.',undefined,'err');return;}
  const buttons=[...list.querySelectorAll('button')];buttons.forEach(item=>item.disabled=true);button.dataset.saving='1';button.classList.add('busy');
  try{
   const result=await api(destination,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:option.id})});
   if(closed||key!==targetKey)return;
   toast(`${kind==='plain'?'Plain':'Synced'} lyrics selected for ${target.title}.`);
   await loadView();searchLoaded=false;if(kind==='synced'||result.source==='plain'||result.source==='synced')setTab('view');
  }catch(error){toast(error.message,undefined,'err');}
  finally{delete button.dataset.saving;button.classList.remove('busy');if(!closed){buttons.forEach(item=>item.disabled=false);refreshControls();}}
 }
 unavailable.onclick=async()=>{
  if(unavailable.disabled||!targetKey)return;
  unavailable.disabled=true;unavailable.classList.add('busy');
  try{
   await api(`/api/lyrics/unavailable/${encodeURIComponent(targetKey)}`,{method:'POST'});
   if(closed)return;
   unavailable.textContent='Marked as unavailable';toast('Marked as no suitable lyrics.');await loadView();
  }catch(error){toast(error.message,undefined,'err');unavailable.disabled=false;}
  finally{unavailable.classList.remove('busy');}
 };
 choosePane.append(chooseStatus,form,termPicker,preview,list,chooseActions);chooseActions.hidden=true;refreshControls();if(eligibleQueue())loadPreview();loadView();
 openLyricsDialog={sheet,close:shut,onState(before,next){
  if(follow&&next?.current?.key!==targetKey){targetKey=next?.current?.key||null;name.lastChild.textContent=next?.current?.title||'Lyrics';setSearchTermTarget(next?.current);lastText=null;lastTextKey=null;reader.textContent='';loadView();searchLoaded=false;if(!choosePane.hidden){searchLoaded=true;show(input.value.trim());}}
  const oldTarget=targetKey&&(before?.current?.key===targetKey?before.current:before?.upcoming?.find(item=>item.key===targetKey));
  const newTarget=targetKey&&(next?.current?.key===targetKey?next.current:next?.upcoming?.find(item=>item.key===targetKey));
  if(oldTarget&&newTarget&&((oldTarget.lyrics_status!==newTarget.lyrics_status&&newTarget.lyrics_status==='ready')||oldTarget.lyrics_rev!==newTarget.lyrics_rev)){loadView();searchLoaded=false;if(!choosePane.hidden){searchLoaded=true;show(input.value.trim());}}
  const present=targetKey&&(next?.current?.key===targetKey||next?.upcoming?.some(item=>item.key===targetKey));
  if(!follow&&!present)viewStatus.textContent=reader.textContent?'Song is no longer in the queue; showing the lyrics already loaded.':'Song is no longer in the queue.';
  else if(!follow&&present&&before&&!(before.current?.key===targetKey||before.upcoming?.some(item=>item.key===targetKey))){viewStatus.textContent='';loadView();}
  refreshControls();
 }};
}
// Classic Songbook rows retain their advanced menu; Recent uses a direct Queue Next action.
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
async function queueSongNext(song,button,image){
 if(button.disabled)return;button.disabled=true;
 try{
  const result=await enqueueNext({id:song.id,artist:song.artist,title:song.title});
  if(result.added||result.moved)applyQueueItem(result.item,true);
  if(result.already_next)toast(`${song.title} is already next`);
  else if(result.moved)toast(`Moved ${song.title} to next`);
  else{toast(`Added ${song.title} as next`);flyToQueue(image);}
  haptic(10);
 }catch(error){toast(error.message,undefined,'err');}
 finally{button.disabled=false;}
}
function swipeable(row,song,{recentNext=false}={}){
 const wrap=el('div',undefined,'swipe'),del=el('button','Delete','swipe-delete');del.setAttribute('aria-label',`Delete ${song.title} from this device`);
 let action;
 if(recentNext){
  action=el('button',undefined,'recent-next');action.type='button';action.setAttribute('aria-label',`Add ${song.title} to play next`);action.title='Play next';
  action.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14l9-7-9-7zM19 5v14"/></svg>';
  action.onclick=()=>queueSongNext(song,action,row.querySelector('img'));
 }else{
  action=el('button','⋯','song-more');action.setAttribute('aria-label',`More actions for ${song.title}`);action.setAttribute('aria-haspopup','menu');action.onclick=()=>songMenu(wrap,song,del);
 }
 wrap.append(row,del,action);
 let start=null,dx=0,dragging=false;
 const swipeStart=recentNext?16:8;
 row.addEventListener('pointerdown',e=>{delete row.dataset.dragged;if(e.pointerType==='mouse'&&e.button)return;start={x:e.clientX,y:e.clientY,base:wrap.classList.contains('open')?-REVEAL:0};dx=start.base;dragging=false;});
 row.addEventListener('pointermove',e=>{
  if(!start)return;const mx=e.clientX-start.x,my=e.clientY-start.y;
  if(!dragging){if(Math.abs(my)>8&&Math.abs(my)>Math.abs(mx)){start=null;return;}if(Math.abs(mx)<swipeStart||Math.abs(mx)<Math.abs(my)*1.2)return;dragging=true;row.setPointerCapture(e.pointerId);wrap.classList.add('dragging');if(openSwipe!==wrap)closeSwipe();}
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
 if(first)$('results').replaceChildren(...Array.from({length:5},()=>{const row=el('div',undefined,'skeleton');row.setAttribute('aria-hidden','true');row.innerHTML='<i></i><div><i></i><i></i></div>';return row;}));
 try{
  const results=(await api(`/api/search?q=${encodeURIComponent(search.query)}&page=${search.page}`)).filter(s=>!search.seen.has(s.id));
  if(run!==searchRun)return;
  if(first)$('results').replaceChildren();
  results.forEach((s,i)=>{search.seen.add(s.id);showResult(s,$('results'),row=>row,i);});
  $('more').hidden=results.length===0||search.page>=9;$('results').dataset.state=search.seen.size?'':'none';
  $('results-end').hidden=!$('more').hidden||!search.seen.size;
  if(!search.seen.size)$('results').append(emptyNote('없음','검색 결과가 없어요','No songs found. Try the title in its original language, or just the artist.'));
  if(first)showResults();
 }catch(error){if(run!==searchRun)return;if(first){$('results').replaceChildren();$('results').dataset.state='';}toast(error.message,undefined,'err');}finally{$('more').disabled=false;}
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
$('clear').onclick=()=>{$('query').value='';$('clear').hidden=true;searchRun++;$('results').replaceChildren();$('more').hidden=$('results-end').hidden=true;$('query').focus();};
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

import {createSwipeState} from './swipe-state.js';
import {createLyricsPanel} from './remote-lyrics.js';
import {createRemoteQueue} from './remote-queue.js';
import {createRemoteStatus} from './remote-status.js';
import {renderRequester} from './requester.js';
import {identityForQueue} from './remote-identities.js';
import {classicRemote,toastParts,emptyNote,secondsLeft} from './classic-remote.js';
import {$,el,connect,api,clock,throttle,syncRanges,REDUCED,thumbnail} from './shared.js';
let state,classicUi,seekDrag=null,seekPending=null;
const SPRING='cubic-bezier(.38,1.21,.22,1)';
const haptic=pattern=>{try{navigator.vibrate?.(pattern);}catch{}};
function showImage(img,src){if(img.getAttribute('src')!==src){if(src)img.src=src;else img.removeAttribute('src');}img.hidden=!src;}
const remoteStatus = createRemoteStatus();
const swipes = createSwipeState();
const lyricsPanel = createLyricsPanel({getState: () => state, toast});
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
const send = connect('remote', {
 onState: render,
 onError: message => toast(message, undefined, 'err'),
 onOpen: remoteStatus.onOpen,
 onClose: remoteStatus.onClose
});
const queue = createRemoteQueue({
 getState: () => state, setState: next => { state = next; },
 send, toast, haptic, swipes, pickLyrics: lyricsPanel.open,
 openSongbook: () => classicUi?.setTab('book')
});
function render(next){
 const before=state;state=next;state.received=Date.now()/1000;if(seekPending&&state.seek_id!==seekPending.seekId)seekPending=null;lyricsPanel.onState(before,state);
 // The header pill reports the TV, since that decides whether anything can play.
 remoteStatus.render(state);
 document.body.dataset.theme=state.theme||'default';showNow(!before);showControls(before);queue.render(before);showClassic();classicUi?.render(state);syncResultCards();
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
 renderRequester($('hero-requester'),c);renderRequester($('dock-requester'),c,true);
 if(c?.requester?.name)$('dock-now').setAttribute('aria-label',`Jump to currently playing song. Requested by ${c.requester.name}`);
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
$('dock-lyrics').onclick=()=>{if(state?.current)lyricsPanel.open(state.current,{followCurrent:true});};
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
$('hero-lyrics').onclick=()=>{if(state?.current)lyricsPanel.open(state.current,{followCurrent:true});};
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
addEventListener('keydown',e=>{if(e.key!=='Escape')return;if(lyricsPanel.isOpen)lyricsPanel.close();else if(document.body.classList.contains('sheet-open'))closeSheet();});
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
// Songs already prepared on the server, newest first.
// Rebuilt only when the list itself changes, so a just-tapped song keeps its added/failed icon.
let readyKeys,recentShape;
async function loadRecent(){
 try{
  const songs=await api('/api/recent'),shape=songs.map(song=>song.id).join();
  if(shape===recentShape)return;
  recentShape=shape;$('recent').replaceChildren();
  songs.forEach(song=>showResult({...song,channel:song.artist,parsed:{artist:song.artist,title:song.title}},$('recent'),row=>swipeable(row,song)));
  if(!songs.length)$('recent').append(emptyNote('♪','아직 부른 노래가 없어요','Nothing sung yet.'));
 }catch{}
}
// Search in pages of 10; "More results" appends the next page.
let search={query:'',page:0,seen:new Set()},searchRun=0;
const enqueue=async song=>api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title,identity_id:await identityForQueue()})});
const enqueueNext=async song=>api('/api/queue/next',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title,identity_id:await identityForQueue()})});
// Queue-copy counts include the current song and every non-failed upcoming item.
function queueCopies(id){return [state?.current,...(state?.upcoming||[])].filter(item=>item?.id===id&&item.status!=='error').length;}
function syncResultCard(button){
 if(!button?.dataset.videoId)return;
 const id=button.dataset.videoId,count=queueCopies(id),add=button.querySelector('.result-add'),status=button.querySelector('.result-icon'),note=button.querySelector('.result-note');
 const confirming=button.dataset.confirm==='1';button.dataset.queueCount=String(count);
 if(confirming){icon(status,'confirm');add.setAttribute('aria-label',`Confirm adding ${button.dataset.title} to the queue again`);return;}
 if(count){button.classList.add('added');button.classList.remove('failed');
  if(count===1)icon(status,'added');else{status.className='result-icon count';status.textContent=String(count);}
  note?.replaceChildren(el('em',count===1?'예약됨':`${count}회 예약`),` · ${count===1?'queued':'copies queued'}`);
  add.setAttribute('aria-label',`${button.dataset.title}, ${count} ${count===1?'copy':'copies'} in the queue. Activate to add another copy.`);
 }else{
  button.classList.remove('added');if(!button.classList.contains('failed'))icon(status,'add');
  if(!button.classList.contains('failed'))note?.replaceChildren();
  add.setAttribute('aria-label',`Add ${button.dataset.title} to the queue`);
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
// Explicit row actions queue the song or move it to the front of the queue.
function showResult(song,list=$('results'),wrap=row=>row,index=-1){
 const b=el('div',undefined,`result${index>=0?' enter':''}`);b.dataset.videoId=song.id;b.dataset.title=song.title;if(index>=0)b.style.setProperty('--i',index);
 const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div',undefined,'result-info');const title=el('strong',song.title);if(song.cached)title.append(el('span','READY','tag'));const note=el('small',undefined,'result-note classic-only');info.append(title,el('small',`${song.channel} · ${clock(song.duration)}`),note);
 const actions=el('div',undefined,'result-actions'),add=el('button',undefined,'result-add'),status=el('span');add.type='button';add.setAttribute('aria-label',`Add ${song.title} to the queue`);icon(status,'add');add.append(status);add.onclick=async()=>{
  if(b.parentElement?.classList.contains('open')){swipes.close();return;}
  if(add.disabled)return;
  if(queueCopies(song.id)>0&&b.dataset.confirm!=='1'){
   b.dataset.confirm='1';syncResultCard(b);toast(`Add ${song.title} again? Tap the plus button to confirm.`);
   clearTimeout(b.confirmTimer);b.confirmTimer=setTimeout(()=>{delete b.dataset.confirm;syncResultCard(b);},4500);return;
  }
  clearTimeout(b.confirmTimer);delete b.dataset.confirm;add.disabled=true;
  try{const item=await enqueue({id:song.id,...song.parsed});applyQueueItem(item);haptic([10,40,10]);flyToQueue(image);toast(`Added ${song.parsed.title}`);}
  catch(error){icon(status,'failed');b.classList.add('failed');note.replaceChildren("Couldn't add. Try again");toast(error.message,undefined,'err');}finally{add.disabled=false;syncResultCard(b);}
 };
 const next=el('button',undefined,'recent-next');next.type='button';next.setAttribute('aria-label',`Add ${song.title} to play next`);next.title='Play next';next.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14l9-7-9-7zM19 5v14"/></svg>';next.onclick=()=>queueSongNext({id:song.id,...song.parsed},next,image);
 actions.append(add,next);b.append(image,info,actions);list.append(wrap(b));syncResultCard(b);
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
// Classic Songbook rows retain their advanced menu; Recent uses a direct Queue Next action.
let openMenu=null;
function closeMenu(){openMenu?.remove();openMenu=null;}
document.addEventListener('pointerdown',e=>{if(openMenu&&!openMenu.contains(e.target)&&!e.target.closest('.song-more'))closeMenu();});
function songMenu(wrap,song,del){
 if(openMenu?.parentElement===wrap)return closeMenu();
 closeMenu();swipes.close();
 const menu=el('div',undefined,'song-menu'),refetch=el('button'),remove=el('button',undefined,'danger'),label=el('div',undefined,'menu-head classic-only');
 if(song.number){const n=el('span',String(song.number),'lcd');n.dataset.ghost='88888';label.append(n);}label.append(song.title);
 refetch.innerHTML='<svg class="classic-only" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16M4 10h16M4 14h10M4 18h7"/></svg>';refetch.append(el('span','가사 고르기','classic-only'),'Lyrics…');
 remove.innerHTML='<svg class="classic-only" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6"/></svg>';remove.append(el('span','다운로드 삭제','classic-only'),'Delete download');
 menu.setAttribute('role','menu');for(const item of [refetch,remove])item.setAttribute('role','menuitem');
 refetch.onclick=()=>{closeMenu();lyricsPanel.open(song);};
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
function swipeable(row,song){
 const wrap=el('div',undefined,'swipe'),del=el('button','Delete','swipe-delete');del.setAttribute('aria-label',`Delete ${song.title} from this device`);
 wrap.append(row,del);
 let start=null,dx=0,dragging=false;
 const swipeStart=8;
 row.addEventListener('pointerdown',e=>{delete row.dataset.dragged;if(e.pointerType==='mouse'&&e.button)return;start={x:e.clientX,y:e.clientY,base:wrap.classList.contains('open')?-swipes.distance:0};dx=start.base;dragging=false;});
 row.addEventListener('pointermove',e=>{
  if(!start)return;const mx=e.clientX-start.x,my=e.clientY-start.y;
  if(!dragging){if(Math.abs(my)>8&&Math.abs(my)>Math.abs(mx)){start=null;return;}if(Math.abs(mx)<swipeStart||Math.abs(mx)<Math.abs(my)*1.2)return;dragging=true;row.setPointerCapture(e.pointerId);wrap.classList.add('dragging');if(swipes.current!==wrap)swipes.close();}
  dx=Math.max(-swipes.distance*1.3,Math.min(0,start.base+mx));row.style.transform=`translateX(${dx}px)`;
 });
 const end=()=>{
  if(!start)return;start=null;wrap.classList.remove('dragging');if(!dragging)return;
  row.dataset.dragged='1';
  if(dx<-swipes.distance/2){wrap.classList.add('open');row.style.transform=`translateX(${-swipes.distance}px)`;swipes.current=wrap;}
  else{wrap.classList.remove('open');row.style.transform='';if(swipes.current===wrap)swipes.current=null;}
 };
 row.addEventListener('pointerup',end);row.addEventListener('pointercancel',end);
 del.onclick=async()=>{
  del.disabled=true;
  try{
   await api(`/api/songs/${song.id}`,{method:'DELETE'});
   if(swipes.current===wrap)swipes.current=null;
   if(!REDUCED.matches)await wrap.animate([{height:`${wrap.offsetHeight}px`,opacity:1},{height:'0px',opacity:0,marginBottom:'-8px'}],{duration:300,easing:'cubic-bezier(.3,0,.8,.15)'}).finished;
   wrap.remove();recentShape=null;toast(`Deleted ${song.title}`);
   if(!$('recent').children.length)loadRecent();
  }catch(error){toast(error.message,undefined,'err');swipes.close();}finally{del.disabled=false;}
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

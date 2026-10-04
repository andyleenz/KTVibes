import {$,el,connect,api,clock,throttle,prepLabel,syncRanges,REDUCED,thumbnail} from './shared.js';
let state;
const SPRING='cubic-bezier(.38,1.21,.22,1)';
const haptic=pattern=>{try{navigator.vibrate?.(pattern);}catch{}};
function showImage(img,src){if(img.getAttribute('src')!==src){if(src)img.src=src;else img.removeAttribute('src');}img.hidden=!src;}
// One toast for every message; an action (Undo) keeps it up a little longer.
let toastTimer;
function toast(text,action){
 $('toast-text').textContent=text;$('toast-action').hidden=!action;
 if(action){$('toast-action').textContent=action.label;$('toast-action').onclick=()=>{$('toast').classList.remove('on');action.run();};}
 $('toast').classList.add('on');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('on'),action?6000:2600);
}
const send=connect('remote',render,toast);
function render(next){
 const before=state;state=next;state.received=Date.now()/1000;
 // The header pill reports the TV, since that decides whether anything can play.
 $('connection').textContent=!state.player_connected?'Open /tv on a device':state.player_audio?'Device ready':'Tap Enable sound on the device';$('connection').classList.toggle('warn',!state.player_audio);
 showNow(!before);showControls(before);showQueue(before);
 const ready=[state.current,...state.upcoming].filter(i=>i?.status==='ready').map(i=>i.key).join();
 if(ready!==readyKeys){readyKeys=ready;loadRecent();}
}
// Now playing: a card at the top, handing over to the dock once scrolled away.
function showNow(first){
 const c=state.current,art=c?thumbnail(c.id):'';
 showHero(!!c,first);$('hero').classList.toggle('paused',!state.playing);$('hero-state').textContent=state.playing?'NOW SINGING':'PAUSED';
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
  if(document.body.classList.contains('sheet-open'))placePill(seg);  // openSheet measures the rest
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
 $('key-note').textContent=key===0?'Original key':`${Math.abs(key)} semitone${Math.abs(key)>1?'s':''} ${key>0?'higher':'lower'}`;
}
$('key-down').onclick=()=>{haptic(8);send({action:'key',value:state.key-1});};
$('key-up').onclick=()=>{haptic(8);send({action:'key',value:state.key+1});};
$('key-reset').onclick=()=>{send({action:'speed',value:1});send({action:'key',value:0});};
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
addEventListener('resize',()=>SEGMENTED.forEach(placePill));
$('earlier').onclick=()=>send({action:'offset',delta:-0.5});$('later').onclick=()=>send({action:'offset',delta:0.5});
$('lyric-version').onclick=()=>state?.current&&pickLyrics(state.current);
function openSheet(){document.body.classList.add('sheet-open');$('sheet').inert=false;haptic(8);requestAnimationFrame(()=>SEGMENTED.forEach(placePill));}
function closeSheet(){document.body.classList.remove('sheet-open');$('sheet').inert=true;}
$('open-controls').onclick=$('dock-now').onclick=openSheet;
$('scrim').onclick=$('sheet-handle').onclick=closeSheet;
addEventListener('keydown',e=>{if(e.key==='Escape'&&!document.querySelector('.lyric-sheet'))closeSheet();});
// Drag the sheet down by its top to dismiss it.
{
 const sheet=$('sheet');let startY=null;
 sheet.addEventListener('pointerdown',e=>{if(sheet.scrollTop>0||e.target.closest('input,button:not(.handle)'))return;startY=e.clientY;sheet.style.transition='none';});
 addEventListener('pointermove',e=>{if(startY!==null)sheet.style.transform=`translateY(${Math.max(0,e.clientY-startY)}px)`;});
 addEventListener('pointerup',e=>{if(startY===null)return;const moved=e.clientY-startY;startY=null;sheet.style.transition='';sheet.style.transform='';if(moved>100)closeSheet();});
}
// Queue. Rebuilt only when its songs or statuses change, so position reports never swap a button
// out from under a tap; preparation progress updates in place. A drag holds rebuilds until it ends.
let queueShape,dragging=null;
const RING=2*Math.PI*23;
const statusText=item=>item.status==='ready'?'Ready':item.status==='error'?'Failed':prepLabel(item).text;
function showQueue(before){
 const count=state.upcoming.length;$('queue-count').textContent=$('dock-count').textContent=count;
 if(before&&count>before.upcoming.length&&!REDUCED.matches)for(const id of ['queue-count','dock-count']){const c=$(id);c.classList.remove('bump');void c.offsetWidth;c.classList.add('bump');}
 const shape=JSON.stringify(state.upcoming.map(i=>[i.key,i.title,i.artist,i.status,i.error]));
 if(shape!==queueShape&&!dragging){
  // A song that turns ready while queued flashes its ring once.
  const preparing=new Set(before?.upcoming.filter(i=>i.status!=='ready').map(i=>i.key));
  // FLIP: remember where each row was, rebuild, then animate rows from their old spots.
  const tops=new Map([...$('queue').children].filter(row=>row.dataset.key).map(row=>[row.dataset.key,row.getBoundingClientRect().top]));
  queueShape=shape;
  $('queue').replaceChildren(...state.upcoming.map((item,index)=>queueRow(item,index,preparing.has(item.key))));
  if(!count)$('queue').append(emptyQueue());
  if(tops.size&&!REDUCED.matches)for(const row of $('queue').children){
   if(!row.dataset.key)continue;
   const was=tops.get(row.dataset.key),top=row.getBoundingClientRect().top;
   if(was===undefined)row.animate([{opacity:0,transform:'translateY(-12px) scale(.96)'},{opacity:1,transform:'none'}],{duration:450,easing:SPRING});
   else if(Math.abs(was-top)>1)row.animate([{transform:`translateY(${was-top}px)`},{transform:'none'}],{duration:500,easing:SPRING});
  }
 }
 for(const item of state.upcoming){
  const row=$('queue').querySelector(`[data-key="${item.key}"]`);if(!row)continue;
  row.querySelector('.status').textContent=statusText(item);
  const ring=row.querySelector('.ring');if(ring){ring.style.setProperty('--p',item.progress||0);ring.classList.toggle('busy',!item.progress&&item.status!=='ready');}
 }
}
// An empty queue invites the next song, with a button straight to the search box.
function emptyQueue(){
 const box=el('div',undefined,'empty'),icon=el('span',undefined,'empty-icon'),find=el('button','Find a song','empty-action');
 icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
 find.onclick=()=>{$('search-form').scrollIntoView({behavior:REDUCED.matches?'auto':'smooth',block:'center'});$('query').focus({preventScroll:true});};
 box.append(icon,el('strong',state.current?'Nothing up next':'The queue is empty'),el('small',state.current?'Add a song and it plays when this one ends.':'Add a song and it starts right away.'),find);
 return box;
}
const GRIP='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
function queueRow(item,index,justReady){
 const row=el('article',undefined,`row ${item.status}`);row.dataset.key=item.key;
 const thumb=el('div',undefined,'thumb'),image=el('img',undefined,'art');image.src=thumbnail(item.id);image.alt='';thumb.append(image);
 // The ring shows while the song prepares, and once more as it turns ready.
 if(item.status!=='ready'&&item.status!=='error'||justReady&&item.status==='ready')thumb.insertAdjacentHTML('beforeend',`<svg class="ring" viewBox="0 0 52 52" style="--c:${RING}" aria-hidden="true"><circle class="track" cx="26" cy="26" r="23"/><circle class="fill" cx="26" cy="26" r="23"/></svg>`);
 if(justReady&&item.status==='ready')haptic(10);
 const info=el('div',undefined,'info'),line=el('p',`${item.artist} · `);line.append(el('span',statusText(item),'status'));info.append(el('h3',item.title),line);
 if(item.error){const retry=el('button','Retry','retry');retry.onclick=()=>send({action:'retry',key:item.key});info.append(el('p',item.error,'error'),retry);}
 const remove=el('button','×','row-button');remove.setAttribute('aria-label',`Remove ${item.title}`);
 remove.onclick=()=>{send({action:'remove',key:item.key});toast(`Removed ${item.title}`,{label:'Undo',run:()=>send({action:'undo'})});};
 const grip=el('button',undefined,'row-button grip');grip.innerHTML=GRIP;grip.setAttribute('aria-label',`Move ${item.title}. Arrow keys move it up or down.`);
 grip.onkeydown=e=>{const to=index+({ArrowUp:-1,ArrowDown:1}[e.key]||0);if(to!==index&&to>=0&&to<state.upcoming.length){e.preventDefault();move(index,to);}};
 row.append(el('span',String(index+1),'num'),thumb,info,remove,grip);
 dragHandlers(row,grip);
 return row;
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
  songs.forEach(song=>showResult({...song,channel:song.artist,parsed:{artist:song.artist,title:song.title}},$('recent'),row=>swipeable(row,song)));
  if(!songs.length)$('recent').append(el('p','Nothing sung yet.','empty'));
 }catch{}
}
// Search in pages of 10; "More results" appends the next page.
let search={query:'',page:0,seen:new Set()},searchRun=0;
const enqueue=song=>api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title})});
// Result button states: add, added, failed.
const ICONS={add:'<path d="M12 5v14M5 12h14"/>',added:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',failed:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'};
function icon(node,name){node.className=`result-icon ${name}`;node.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;}
// One tap queues the song with the artist/title parsed from YouTube (or confirmed earlier, for recent songs).
function showResult(song,list=$('results'),wrap=row=>row,index=-1){
 const b=el('button',undefined,index<0?'result':'result enter');if(index>=0)b.style.setProperty('--i',index);
 const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div');const title=el('strong',song.title);if(song.cached)title.append(el('span','READY','tag'));info.append(title,el('small',`${song.channel} · ${clock(song.duration)}`));const status=el('span');icon(status,'add');b.append(image,info,status);
 b.onclick=async()=>{
  // A swipe ends in a click; an open row closes on tap instead of queueing.
  if(b.dataset.dragged){delete b.dataset.dragged;return;}if(b.parentElement?.classList.contains('open')){closeSwipe();return;}
  b.disabled=true;
  try{await enqueue({id:song.id,...song.parsed});icon(status,'added');haptic([10,40,10]);flyToQueue(image);toast(`Added ${song.parsed.title}`);}
  catch(error){icon(status,'failed');toast(error.message);}finally{b.disabled=false;}
 };
 list.append(wrap(b));
}
// The thumbnail arcs into whichever queue count is on screen: the outer box moves across evenly,
// the inner one up or down with an overshooting ease, which together trace a curve.
function flyToQueue(source){
 if(REDUCED.matches)return;
 const from=source.getBoundingClientRect(),count=$('queue-count').getBoundingClientRect();
 const target=(count.top>60&&count.bottom<innerHeight-90||$('dock').classList.contains('away')?$('queue-count'):$('dock-count')).getBoundingClientRect();
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
async function pickLyrics(song){
 const sheet=el('div',undefined,'lyric-sheet'),panel=el('div',undefined,'lyric-sheet-panel'),list=el('div',undefined,'lyric-options'),close=el('button','Close');
 const shut=()=>{sheet.classList.add('out');sheet.addEventListener('animationend',()=>sheet.remove(),{once:true});};
 close.onclick=shut;sheet.onclick=e=>{if(e.target===sheet)shut();};
 const head=el('div',undefined,'lyric-sheet-head');head.append(el('strong',`Lyrics · ${song.title}`),close);
 // Search LRCLIB by hand when the automatic lookup found nothing or the wrong song.
 const form=el('form',undefined,'lyric-search'),input=el('input'),go=el('button','Search');
 input.type='search';input.value=`${song.artist} ${song.title}`;input.placeholder='Artist and song title';input.setAttribute('aria-label','Search lyrics');go.type='submit';
 form.append(input,go);form.onsubmit=e=>{e.preventDefault();input.blur();show(input.value.trim());};
 panel.append(head,form,list);sheet.append(panel);document.body.append(sheet);
 let latest=0;  // a slow earlier lookup must not replace newer results
 async function show(query){
  const mine=++latest;
  list.replaceChildren(el('p',query?'Searching…':'Looking up every version…','muted'));
  try{
   const options=await api(`/api/songs/${song.id}/lyrics${query?`?q=${encodeURIComponent(query)}`:''}`);
   if(mine!==latest)return;
   list.replaceChildren(...(options.length?[]:[el('p',query?'Nothing found. Try fewer words, or the title in its original language.':'No synced lyrics found automatically. Try a search above.','muted')]));
   // One row per language (its best version) first; other editions sit behind "Show all". Searches list everything.
   const seen=new Set(),extra=[];
   for(const o of options){
    const first=!seen.has(o.language);seen.add(o.language);
    const b=el('button',undefined,'lyric-option'+(o.current?' current':'')),top=el('div');
    const gap=Math.abs(o.difference)>10?` · ${Math.abs(o.difference)}s ${o.difference>0?'longer':'shorter'} than this video`:'';
    top.append(el('b',o.language),el('span',[o.track,o.artist,o.album].filter(Boolean).join(' · ')),...(o.current?[el('em','In use')]:[]));
    b.append(top,...o.preview.map(line=>el('small',line)),el('small',`${o.lines} lines${gap}`,'count'));
    b.onclick=async()=>{
     for(const other of list.children)other.disabled=true;b.classList.add('busy');
     try{await api(`/api/songs/${song.id}/lyrics`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:o.id})});toast(`Lyrics for ${song.title} set to ${o.track||o.language}`);shut();}
     catch(error){toast(error.message);for(const other of list.children)other.disabled=false;b.classList.remove('busy');}
    };
    if(query||first||o.current)list.append(b);else extra.push(b);
   }
   if(extra.length){const all=el('button',`Show all ${options.length} versions`,'lyric-all');all.onclick=()=>{all.replaceWith(...extra);};list.append(all);}
  }catch(error){if(mine===latest)list.replaceChildren(el('p',error.message,'error'));}
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
 const menu=el('div',undefined,'song-menu'),refetch=el('button','Lyrics…'),remove=el('button','Delete download','danger');
 menu.setAttribute('role','menu');for(const item of [refetch,remove])item.setAttribute('role','menuitem');
 refetch.onclick=()=>{closeMenu();pickLyrics(song);};
 remove.onclick=()=>{closeMenu();del.click();};
 menu.append(refetch,remove);wrap.append(menu);openMenu=menu;refetch.focus();
}
function swipeable(row,song){
 const wrap=el('div',undefined,'swipe'),del=el('button','Delete','swipe-delete'),more=el('button','⋯','song-more');del.setAttribute('aria-label',`Delete ${song.title} from this device`);
 more.setAttribute('aria-label',`More actions for ${song.title}`);more.setAttribute('aria-haspopup','menu');more.onclick=()=>songMenu(wrap,song,del);
 wrap.append(row,del,more);
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
  }catch(error){toast(error.message);closeSwipe();}finally{del.disabled=false;}
 };
 return wrap;
}
async function loadPage(){
 const run=++searchRun,first=!search.page;
 $('more').disabled=true;
 // Placeholder rows hold the space while YouTube answers.
 if(first)$('results').replaceChildren(...Array.from({length:5},()=>{const row=el('div',undefined,'skeleton');row.setAttribute('aria-hidden','true');row.innerHTML='<i></i><div><i></i><i></i></div>';return row;}));
 try{
  const results=(await api(`/api/search?q=${encodeURIComponent(search.query)}&page=${search.page}`)).filter(s=>!search.seen.has(s.id));
  if(run!==searchRun)return;
  if(first)$('results').replaceChildren();
  results.forEach((s,i)=>{search.seen.add(s.id);showResult(s,$('results'),row=>row,i);});
  $('more').hidden=results.length===0||search.page>=9;
  if(!search.seen.size)$('results').append(el('p','No songs found. Try the title in its original language, or just the artist.','empty'));
  if(first)showResults();
 }catch(error){if(run!==searchRun)return;if(first)$('results').replaceChildren();toast(error.message);}finally{$('more').disabled=false;}
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
  $('suggestions').replaceChildren(...list.map(text=>{const li=el('li',text);li.setAttribute('role','option');li.onpointerdown=e=>{e.preventDefault();pickSuggestion(text);};return li;}));
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
$('clear').onclick=()=>{$('query').value='';$('clear').hidden=true;searchRun++;$('results').replaceChildren();$('more').hidden=true;$('query').focus();};
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

import {$,el,connect,api,clock,throttle,prepLabel,syncRanges} from './shared.js';
let state;
// After the first visit, skip the welcome hero and go straight to search.
try{if(localStorage.getItem('ktvibes.visited'))document.body.classList.add('returning');localStorage.setItem('ktvibes.visited','1');}catch{}
const GUIDE_NAMES={off:'Off',latin:'Romanization',hangul:'한글'};
// Messages also flash in the dock, since the status line is usually scrolled off screen.
let noteTimer;
const message=text=>{$('message').textContent=text;$('now-artist').textContent=text;clearTimeout(noteTimer);noteTimer=setTimeout(()=>{noteTimer=null;showDock();},3000);};
const send=connect('remote',render,message);
function render(next){
 state=next;
 // The header pill reports the TV, since that decides whether anything can play.
 $('connection').textContent=!state.player_connected?'Open /tv on your TV':state.player_audio?'TV ready':'Tap Enable sound on TV';$('connection').classList.toggle('warn',!state.player_audio);
 $('play').classList.toggle('playing',!!state.playing);$('play').setAttribute('aria-label',state.playing?'Pause':'Play');
 for(const id of ['play','skip','earlier','later'])$(id).disabled=!state.current;
 $('guide').textContent=`${GUIDE_NAMES[state.guide]} ⟳`;state.received=Date.now()/1000;if(document.activeElement!==$('lyric-scale'))$('lyric-scale').value=state.lyric_scale;$('lyric-scale-value').textContent=`${Math.round(state.lyric_scale*100)}%`;$('scrub').max=state.current?.duration||1;$('scrub').disabled=!state.current;$('length').textContent=clock(state.current?.duration);showPosition();if(document.activeElement!==$('vocal'))$('vocal').value=state.vocal;
 $('vocal-value').textContent=`${Math.round(state.vocal*100)}%`;if(document.activeElement!==$('speed'))$('speed').value=state.speed;$('speed-value').textContent=`${Math.round(state.speed*100)}%`;$('key-value').textContent=state.key>0?`+${state.key}`:`${state.key}`;$('key-down').disabled=state.key<=-6;$('key-up').disabled=state.key>=6;$('offset-value').textContent=`${state.offset>=0?'+':''}${state.offset.toFixed(1)}s`;syncRanges();
 showDock();
 showQueue();showUndo();
 const ready=[state.current,...state.upcoming].filter(i=>i?.status==='ready').map(i=>i.key).join();
 if(ready!==readyKeys){readyKeys=ready;loadRecent();}
}
// Rebuild the queue only when its songs or statuses change, so position reports never swap
// a button out from under a tap; preparation progress updates in place.
let queueShape,badges=new Map();
const SPRING='cubic-bezier(.38,1.21,.22,1)',REDUCED=matchMedia('(prefers-reduced-motion: reduce)');
function showQueue(){
 $('queue-count').textContent=state.upcoming.length+(state.current?1:0);
 const shape=JSON.stringify([state.current?.key,state.current?.title,...state.upcoming.map(i=>[i.key,i.title,i.artist,i.status,i.step,i.error])]);
 if(shape!==queueShape){
  // FLIP: remember where each row was, rebuild, then animate rows from their old spots.
  const before=new Map([...$('queue').children].filter(row=>row.dataset.key).map(row=>[row.dataset.key,row.getBoundingClientRect().top]));
  queueShape=shape;badges=new Map();$('queue').replaceChildren();
  // The song on stage heads the queue.
  if(state.current){
   const row=el('article',undefined,'queue-row current');row.dataset.key=state.current.key;const mark=el('span',undefined,'number');mark.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
   const info=el('div',undefined,'song-info');info.append(el('h3',state.current.title),el('p',state.current.artist),el('span','Now playing','badge ready'));
   row.append(mark,info);$('queue').append(row);  // Skip lives in the player below.
  }
  const move=(from,to)=>{const keys=state.upcoming.map(i=>i.key);keys.splice(to,0,...keys.splice(from,1));send({action:'reorder',keys});};
  state.upcoming.forEach((item,index)=>{
   const row=el('article',undefined,'queue-row');row.dataset.key=item.key;row.append(el('span',String(index+1).padStart(2,'0'),'number'));
   const badge=el('span',undefined,`badge ${item.status}`);badges.set(item.key,badge);
   const info=el('div',undefined,'song-info');info.append(el('h3',item.title),el('p',item.artist),badge);
   if(item.error){const retry=el('button','Retry','retry');retry.onclick=()=>send({action:'retry',key:item.key});info.append(el('p',item.error,'error'),retry);}
   row.append(info);
   const buttons=el('div',undefined,'queue-actions');
   for(const [label,to,name] of [['⤒',0,'to play next'],['↑',index-1,'up'],['↓',index+1,'down']]){const b=el('button',label);b.setAttribute('aria-label',`Move ${item.title} ${name}`);b.disabled=to<0||to>=state.upcoming.length||to===index;b.onclick=()=>move(index,to);buttons.append(b);}
   const remove=el('button','×');remove.setAttribute('aria-label',`Remove ${item.title}`);remove.onclick=()=>{undoTitle=item.title;send({action:'remove',key:item.key});};buttons.append(remove);row.append(buttons);$('queue').append(row);
  });
  if(!state.upcoming.length&&!state.current)$('queue').append(el('p','Nothing queued.','empty'));
  if(before.size&&!REDUCED.matches)for(const row of $('queue').children){
   if(!row.dataset.key)continue;
   const was=before.get(row.dataset.key),top=row.getBoundingClientRect().top;
   if(was===undefined)row.animate([{opacity:0,transform:'translateY(-12px) scale(.96)'},{opacity:1,transform:'none'}],{duration:450,easing:SPRING});
   else if(Math.abs(was-top)>1)row.animate([{transform:`translateY(${was-top}px)`},{transform:'none'}],{duration:500,easing:SPRING});
  }
 }
 for(const item of state.upcoming){const badge=badges.get(item.key);if(badge)badge.textContent=item.status==='ready'||item.status==='error'?item.status:prepLabel(item).text;}
}
// Undo a removal from this phone for as long as the server keeps it.
let undoTitle=null,undoTimer;
function showUndo(){
 const undo=state.undo,left=undo?(undo.until-state.server_time)*1000:0;
 if(!undo||undo.title!==undoTitle||left<=0){$('toast').hidden=true;return;}
 $('toast-text').textContent=`Removed ${undo.title}`;$('toast').hidden=false;
 clearTimeout(undoTimer);undoTimer=setTimeout(()=>{undoTitle=null;$('toast').hidden=true;},Math.min(left,6000));
}
$('toast-undo').onclick=()=>{undoTitle=null;$('toast').hidden=true;send({action:'undo'});};
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
// Search in pages of 10; "Load more" appends the next page.
let search={query:'',page:0,seen:new Set()};
const enqueue=song=>api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title})});
// Result button states: add, added, failed.
const ICONS={add:'<path d="M12 5v14M5 12h14"/>',added:'<path d="M5 12.5l4.5 4.5L19 7.5"/>',failed:'<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/>'};
function icon(node,name){node.className=`result-icon ${name}`;node.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;}
// One tap queues the song with the artist/title parsed from YouTube (or confirmed earlier, for recent songs).
function showResult(song,list=$('results'),wrap=row=>row){
 const b=el('button',undefined,'result');const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div');const title=el('strong',song.title);if(song.cached)title.append(el('span','READY','tag'));info.append(title,el('small',`${song.channel} · ${clock(song.duration)}`));const status=el('span');icon(status,'add');b.append(image,info,status);
 b.onclick=async()=>{
  // A swipe ends in a click; an open row closes on tap instead of queueing.
  if(b.dataset.dragged){delete b.dataset.dragged;return;}if(b.parentElement?.classList.contains('open')){closeSwipe();return;}
  b.disabled=true;try{await enqueue({id:song.id,...song.parsed});icon(status,'added');message(`Added ${song.parsed.title}.`);}catch(error){icon(status,'failed');message(error.message);}finally{b.disabled=false;}};
 list.append(wrap(b));
}
// Recent songs swipe left to reveal Delete; tapping it deletes the download.
const REVEAL=96;let openSwipe=null;
function closeSwipe(){if(!openSwipe)return;openSwipe.classList.remove('open');openSwipe.querySelector('.result').style.transform='';openSwipe=null;}
document.addEventListener('pointerdown',e=>{if(openSwipe&&!openSwipe.contains(e.target))closeSwipe();});
function swipeable(row,song){
 const wrap=el('div',undefined,'swipe'),del=el('button','Delete','swipe-delete');del.setAttribute('aria-label',`Delete ${song.title} from this device`);
 wrap.append(row,del);
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
   wrap.remove();recentShape=null;message(`Deleted ${song.title}.`);
   if(!$('recent').children.length)loadRecent();
  }catch(error){message(error.message);closeSwipe();}finally{del.disabled=false;}
 };
 return wrap;
}
async function loadPage(){
 const button=search.page?$('more'):$('search-button');button.disabled=true;message(search.page?'Loading more…':'Searching YouTube…');
 try{
  const results=(await api(`/api/search?q=${encodeURIComponent(search.query)}&page=${search.page}`)).filter(s=>!search.seen.has(s.id));
  results.forEach(s=>{search.seen.add(s.id);showResult(s);});
  $('more').hidden=results.length===0||search.page>=9;
  message(search.seen.size?'':'No songs found.');
  if(!search.page)showResults();
 }catch(error){message(error.message);}finally{button.disabled=false;}
}
$('search-form').onsubmit=e=>{
 e.preventDefault();search={query:$('query').value.trim(),page:0,seen:new Set()};$('results').replaceChildren();$('more').hidden=true;loadPage();
 $('query').blur();showResults();  // drop the keyboard so results have the screen
};
// Search stays pinned but results don't: from further down, bring them up under the bar.
// Runs again once results render, since scroll anchoring keeps the view on the content below them.
function showResults(){
 const first=$('message').textContent?$('message'):$('results');
 const gap=first.getBoundingClientRect().top-($('search-form').getBoundingClientRect().bottom+parseFloat(getComputedStyle(first).marginTop));
 if(gap<0)scrollBy({top:gap,behavior:REDUCED.matches?'auto':'smooth'});
}
$('more').onclick=()=>{search.page++;loadPage();};
$('play').onclick=()=>send({action:state?.playing?'pause':'play'});$('skip').onclick=()=>send({action:'skip'});
$('earlier').onclick=()=>send({action:'offset',delta:-0.5});$('later').onclick=()=>send({action:'offset',delta:0.5});const sendVocal=throttle(value=>send({action:'vocal',value})),sendScale=throttle(value=>send({action:'lyric_scale',value}));
$('vocal').oninput=()=>sendVocal(Number($('vocal').value));
const sendSpeed=throttle(value=>send({action:'speed',value}));$('speed').oninput=()=>sendSpeed(Number($('speed').value));
$('key-down').onclick=()=>send({action:'key',value:state.key-1});$('key-up').onclick=()=>send({action:'key',value:state.key+1});$('key-reset').onclick=()=>{send({action:'speed',value:1});send({action:'key',value:0});};
$('lyric-scale').oninput=()=>sendScale(Number($('lyric-scale').value));
// Estimate the TV position between its two-second progress reports.
let scrubbing=false;
function showPosition(){
 if(!state||scrubbing)return;
 const live=state.current&&state.playing&&state.position>0?Date.now()/1000-state.received:0;
 const position=Math.min(state.position+live,state.current?.duration||0);
 $('scrub').value=position;syncRanges();$('position').textContent=clock(position);
 const fraction=state.current?.duration?position/state.current.duration:0;$('mini-progress').style.width=`${fraction*100}%`;$('mini-progress').parentElement.style.setProperty('--p',fraction);
}
setInterval(showPosition,500);
$('scrub').oninput=()=>{scrubbing=true;$('position').textContent=clock(Number($('scrub').value));};
$('scrub').onchange=()=>{scrubbing=false;send({action:'seek',position:Number($('scrub').value)});};
$('guide').onclick=()=>send({action:'guide',value:'cycle'});
// The sticky dock holds every playback control: play/skip always in reach, the rest one tap away.
function showDock(){
 $('now-title').textContent=state?.current?.title||'Nothing playing';
 const thumb=state?.current?`https://i.ytimg.com/vi/${state.current.id}/mqdefault.jpg`:'';if($('now-thumb').getAttribute('src')!==thumb){if(thumb)$('now-thumb').src=thumb;else $('now-thumb').removeAttribute('src');}$('now-thumb').hidden=!thumb;
 if(!noteTimer)$('now-artist').textContent=state?.current?.artist||'';
}
function openDock(open){$('mini').classList.toggle('open',open);$('mini-panel').inert=!open;$('mini-more').setAttribute('aria-expanded',open);try{localStorage.setItem('ktvibes.dock-open',open?'1':'');}catch{}}
try{openDock(!!localStorage.getItem('ktvibes.dock-open'));}catch{}
$('mini-more').onclick=()=>openDock(!$('mini').classList.contains('open'));
// Restoring the saved state on load shouldn't animate; later toggles do.
requestAnimationFrame(()=>requestAnimationFrame(()=>$('mini').classList.add('animate')));
// Keep the page's end clear of the dock, whatever its height.
new ResizeObserver(()=>document.body.style.setProperty('--dock',`${$('mini').offsetHeight}px`)).observe($('mini'));

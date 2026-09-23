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
 $('play').textContent=state.playing?'Pause':'Play';
 for(const id of ['play','skip','earlier','later'])$(id).disabled=!state.current;
 $('guide').textContent=`${GUIDE_NAMES[state.guide]} ⟳`;state.received=Date.now()/1000;if(document.activeElement!==$('lyric-scale'))$('lyric-scale').value=state.lyric_scale;$('lyric-scale-value').textContent=`${Math.round(state.lyric_scale*100)}%`;$('scrub').max=state.current?.duration||1;$('scrub').disabled=!state.current;$('length').textContent=clock(state.current?.duration);showPosition();if(document.activeElement!==$('vocal'))$('vocal').value=state.vocal;
 $('vocal-value').textContent=`${Math.round(state.vocal*100)}%`;$('offset-value').textContent=`${state.offset>=0?'+':''}${state.offset.toFixed(1)}s`;syncRanges();
 showDock();
 showQueue();showUndo();
 const ready=[state.current,...state.upcoming].filter(i=>i?.status==='ready').map(i=>i.key).join();
 if(ready!==readyKeys){readyKeys=ready;loadRecent();}
}
// Rebuild the queue only when its songs or statuses change, so position reports never swap
// a button out from under a tap; preparation progress updates in place.
let queueShape,badges=new Map();
function showQueue(){
 $('queue-count').textContent=state.upcoming.length+(state.current?1:0);
 const shape=JSON.stringify([state.current?.key,state.current?.title,...state.upcoming.map(i=>[i.key,i.title,i.artist,i.status,i.step,i.error])]);
 if(shape!==queueShape){
  queueShape=shape;badges=new Map();$('queue').replaceChildren();
  // The song on stage heads the queue.
  if(state.current){
   const row=el('article',undefined,'queue-row current'),mark=el('span',undefined,'number');mark.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z"/></svg>';
   const info=el('div',undefined,'song-info');info.append(el('h3',state.current.title),el('p',state.current.artist),el('span','Now playing','badge ready'));
   row.append(mark,info);$('queue').append(row);  // Skip lives in the player below.
  }
  const move=(from,to)=>{const keys=state.upcoming.map(i=>i.key);keys.splice(to,0,...keys.splice(from,1));send({action:'reorder',keys});};
  state.upcoming.forEach((item,index)=>{
   const row=el('article',undefined,'queue-row');row.append(el('span',String(index+1).padStart(2,'0'),'number'));
   const badge=el('span',undefined,`badge ${item.status}`);badges.set(item.key,badge);
   const info=el('div',undefined,'song-info');info.append(el('h3',item.title),el('p',item.artist),badge);
   if(item.error){const retry=el('button','Retry','retry');retry.onclick=()=>send({action:'retry',key:item.key});info.append(el('p',item.error,'error'),retry);}
   row.append(info);
   const buttons=el('div',undefined,'queue-actions');
   for(const [label,to,name] of [['⤒',0,'to play next'],['↑',index-1,'up'],['↓',index+1,'down']]){const b=el('button',label);b.setAttribute('aria-label',`Move ${item.title} ${name}`);b.disabled=to<0||to>=state.upcoming.length||to===index;b.onclick=()=>move(index,to);buttons.append(b);}
   const remove=el('button','×');remove.setAttribute('aria-label',`Remove ${item.title}`);remove.onclick=()=>{undoTitle=item.title;send({action:'remove',key:item.key});};buttons.append(remove);row.append(buttons);$('queue').append(row);
  });
  if(!state.upcoming.length&&!state.current)$('queue').append(el('p','Nothing queued.','empty'));
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
  songs.forEach(song=>showResult({...song,channel:song.artist,parsed:{artist:song.artist,title:song.title}},$('recent')));
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
function showResult(song,list=$('results')){
 const b=el('button',undefined,'result');const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div');const title=el('strong',song.title);if(song.cached)title.append(el('span','READY','tag'));info.append(title,el('small',`${song.channel} · ${clock(song.duration)}`));const status=el('span');icon(status,'add');b.append(image,info,status);
 b.onclick=async()=>{b.disabled=true;try{await enqueue({id:song.id,...song.parsed});icon(status,'added');message(`Added ${song.parsed.title}.`);}catch(error){icon(status,'failed');message(error.message);}finally{b.disabled=false;}};
 list.append(b);
}
async function loadPage(){
 const button=search.page?$('more'):$('search-button');button.disabled=true;message(search.page?'Loading more…':'Searching YouTube…');
 try{
  const results=(await api(`/api/search?q=${encodeURIComponent(search.query)}&page=${search.page}`)).filter(s=>!search.seen.has(s.id));
  results.forEach(s=>{search.seen.add(s.id);showResult(s);});
  $('more').hidden=results.length===0||search.page>=9;
  message(search.seen.size?'':'No songs found.');
 }catch(error){message(error.message);}finally{button.disabled=false;}
}
$('search-form').onsubmit=e=>{e.preventDefault();search={query:$('query').value.trim(),page:0,seen:new Set()};$('results').replaceChildren();$('more').hidden=true;loadPage();};
$('more').onclick=()=>{search.page++;loadPage();};
$('play').onclick=()=>send({action:state?.playing?'pause':'play'});$('skip').onclick=()=>send({action:'skip'});
$('earlier').onclick=()=>send({action:'offset',delta:-0.5});$('later').onclick=()=>send({action:'offset',delta:0.5});const sendVocal=throttle(value=>send({action:'vocal',value})),sendScale=throttle(value=>send({action:'lyric_scale',value}));
$('vocal').oninput=()=>sendVocal(Number($('vocal').value));
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
 if(!noteTimer)$('now-artist').textContent=state?.current?.artist||'';
}
function openDock(open){$('mini-panel').hidden=!open;$('mini-more').setAttribute('aria-expanded',open);try{localStorage.setItem('ktvibes.dock-open',open?'1':'');}catch{}}
try{openDock(!!localStorage.getItem('ktvibes.dock-open'));}catch{}
$('mini-more').onclick=()=>openDock($('mini-panel').hidden);
// Keep the page's end clear of the dock, whatever its height.
new ResizeObserver(()=>document.body.style.setProperty('--dock',`${$('mini').offsetHeight}px`)).observe($('mini'));

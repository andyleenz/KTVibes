import {$,el,connect,api,clock} from './shared.js';
let state;
const GUIDE_NAMES={off:'Off',latin:'Romanization',hangul:'한글'};
// Messages also flash in the mini-player, since the status line is off screen when it shows.
let noteTimer;
const message=text=>{$('message').textContent=text;$('mini-note').textContent=text;clearTimeout(noteTimer);noteTimer=setTimeout(()=>{noteTimer=null;showMini();},3000);};
const send=connect('remote',render,message);
function render(next){
 state=next;$('now-title').textContent=state.current?.title||'The stage is yours';$('now-artist').textContent=state.current?.artist||'Queue a song to get started.';
 $('player-status').textContent=state.player_connected?'TV CONNECTED':'OPEN /TV TO START SINGING';$('play').textContent=state.playing?'Pause':'Play';
 $('guide').textContent=`${GUIDE_NAMES[state.guide]} ⟳`;state.received=Date.now()/1000;if(document.activeElement!==$('lyric-scale'))$('lyric-scale').value=state.lyric_scale;$('lyric-scale-value').textContent=`${Math.round(state.lyric_scale*100)}%`;$('scrub').max=state.current?.duration||1;$('scrub').disabled=!state.current;$('length').textContent=clock(state.current?.duration);showPosition();if(document.activeElement!==$('vocal'))$('vocal').value=state.vocal;
 $('vocal-value').textContent=`${Math.round(state.vocal*100)}%`;$('offset-value').textContent=`${state.offset>=0?'+':''}${state.offset.toFixed(1)}s`;
 showMini();
 $('queue-count').textContent=state.upcoming.length;$('queue').replaceChildren();
 state.upcoming.forEach((item,index)=>{
  const row=el('article',undefined,'queue-row');row.append(el('span',String(index+1).padStart(2,'0'),'number'));
  const info=el('div',undefined,'song-info');info.append(el('h3',item.title),el('p',item.artist),el('span',item.status,`badge ${item.status}`));if(item.error)info.append(el('p',item.error,'error'));row.append(info);
  const buttons=el('div',undefined,'queue-actions');for(const [label,delta] of [['↑',-1],['↓',1]]){const b=el('button',label);b.setAttribute('aria-label',`Move ${item.title} ${delta<0?'up':'down'}`);b.disabled=index+delta<0||index+delta>=state.upcoming.length;b.onclick=()=>{const keys=state.upcoming.map(i=>i.key);[keys[index],keys[index+delta]]=[keys[index+delta],keys[index]];send({action:'reorder',keys});};buttons.append(b);}
  const remove=el('button','×');remove.setAttribute('aria-label',`Remove ${item.title}`);remove.onclick=()=>send({action:'remove',key:item.key});buttons.append(remove);row.append(buttons);$('queue').append(row);
 });
 if(!state.upcoming.length)$('queue').append(el('p','A great setlist starts with one song.','empty'));
 const ready=[state.current,...state.upcoming].filter(i=>i?.status==='ready').map(i=>i.key).join();
 if(ready!==readyKeys){readyKeys=ready;loadRecent();}
}
// Songs already prepared on the server, newest first.
let readyKeys;
async function loadRecent(){
 try{
  const songs=await api('/api/recent');$('recent').replaceChildren();
  songs.forEach(song=>showResult({...song,channel:song.artist,parsed:{artist:song.artist,title:song.title}},$('recent')));
  if(!songs.length)$('recent').append(el('p','Songs you sing will show up here.','empty'));
 }catch{}
}
// Search in pages of 10; "Load more" appends the next page.
let search={query:'',page:0,seen:new Set()};
const enqueue=song=>api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:song.id,artist:song.artist,title:song.title})});
// One tap queues the song with the artist/title parsed from YouTube (or confirmed earlier, for recent songs).
function showResult(song,list=$('results')){
 const b=el('button',undefined,'result');const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div');info.append(el('strong',song.title),el('small',`${song.channel} · ${clock(song.duration)}`));b.append(image,info,el('span','+'));
 b.onclick=async()=>{b.disabled=true;try{await enqueue({id:song.id,...song.parsed});b.lastChild.textContent='✓';message(`Added ${song.parsed.title} to your setlist.`);}catch(error){b.lastChild.textContent='!';message(error.message);}finally{b.disabled=false;}};
 list.append(b);
}
async function loadPage(){
 const button=search.page?$('more'):$('search-button');button.disabled=true;message(search.page?'Loading more…':'Searching YouTube…');
 try{
  const results=(await api(`/api/search?q=${encodeURIComponent(search.query)}&page=${search.page}`)).filter(s=>!search.seen.has(s.id));
  results.forEach(s=>{search.seen.add(s.id);showResult(s);});
  $('more').hidden=results.length===0||search.page>=9;
  message(search.seen.size?'Choose a song to add it to your setlist.':'No songs found. Try another title.');
 }catch(error){message(error.message);}finally{button.disabled=false;}
}
$('search-form').onsubmit=e=>{e.preventDefault();search={query:$('query').value.trim(),page:0,seen:new Set()};$('results').replaceChildren();$('more').hidden=true;loadPage();};
$('more').onclick=()=>{search.page++;loadPage();};
$('play').onclick=()=>send({action:state?.playing?'pause':'play'});$('skip').onclick=()=>send({action:'skip'});
$('earlier').onclick=()=>send({action:'offset',delta:-0.5});$('later').onclick=()=>send({action:'offset',delta:0.5});$('vocal').oninput=()=>send({action:'vocal',value:Number($('vocal').value)});
$('lyric-scale').oninput=()=>send({action:'lyric_scale',value:Number($('lyric-scale').value)});
// Estimate the TV position between its two-second progress reports.
let scrubbing=false;
function showPosition(){
 if(!state||scrubbing)return;
 const live=state.current&&state.playing&&state.position>0?Date.now()/1000-state.received:0;
 const position=Math.min(state.position+live,state.current?.duration||0);
 $('scrub').value=position;$('position').textContent=clock(position);
}
setInterval(showPosition,500);
$('scrub').oninput=()=>{scrubbing=true;$('position').textContent=clock(Number($('scrub').value));};
$('scrub').onchange=()=>{scrubbing=false;send({action:'seek',position:Number($('scrub').value)});};
$('guide').onclick=()=>send({action:'guide',value:'cycle'});
// Sticky controls once "Now on stage" scrolls out of view.
let stageVisible=true;
function showMini(){
 $('mini').hidden=stageVisible||!state?.current;document.body.classList.toggle('has-mini',!$('mini').hidden);
 $('mini-title').textContent=state?.current?.title||'';$('mini-play').textContent=state?.playing?'Pause':'Play';
 if(!noteTimer)$('mini-note').textContent=state?.current?.artist||'';
}
new IntersectionObserver(([entry])=>{stageVisible=entry.isIntersecting;showMini();}).observe(document.querySelector('.now'));
$('mini-play').onclick=()=>$('play').click();$('mini-skip').onclick=()=>$('skip').click();

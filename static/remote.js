import {$,el,connect,api,clock} from './shared.js';
let state,selected;
const message=text=>$('message').textContent=text;
const send=connect('remote',render,message);
function render(next){
 state=next;$('now-title').textContent=state.current?.title||'The stage is yours';$('now-artist').textContent=state.current?.artist||'Queue a song to get started.';
 $('player-status').textContent=state.player_connected?'TV CONNECTED':'OPEN /TV TO START SINGING';$('play').textContent=state.playing?'Pause':'Play';
 $('pinyin').checked=state.pinyin;state.received=Date.now()/1000;if(document.activeElement!==$('lyric-scale'))$('lyric-scale').value=state.lyric_scale;$('lyric-scale-value').textContent=`${Math.round(state.lyric_scale*100)}%`;$('scrub').max=state.current?.duration||1;$('scrub').disabled=!state.current;$('length').textContent=clock(state.current?.duration);showPosition();if(document.activeElement!==$('vocal'))$('vocal').value=state.vocal;
 $('vocal-value').textContent=`${Math.round(state.vocal*100)}%`;$('offset-value').textContent=`${state.offset>=0?'+':''}${state.offset.toFixed(1)}s`;
 $('queue-count').textContent=state.upcoming.length;$('queue').replaceChildren();
 state.upcoming.forEach((item,index)=>{
  const row=el('article',undefined,'queue-row');row.append(el('span',String(index+1).padStart(2,'0'),'number'));
  const info=el('div',undefined,'song-info');info.append(el('h3',item.title),el('p',item.artist),el('span',item.status,`badge ${item.status}`));if(item.error)info.append(el('p',item.error,'error'));row.append(info);
  const buttons=el('div',undefined,'queue-actions');for(const [label,delta] of [['↑',-1],['↓',1]]){const b=el('button',label);b.setAttribute('aria-label',`Move ${item.title} ${delta<0?'up':'down'}`);b.disabled=index+delta<0||index+delta>=state.upcoming.length;b.onclick=()=>{const keys=state.upcoming.map(i=>i.key);[keys[index],keys[index+delta]]=[keys[index+delta],keys[index]];send({action:'reorder',keys});};buttons.append(b);}
  const remove=el('button','×');remove.setAttribute('aria-label',`Remove ${item.title}`);remove.onclick=()=>send({action:'remove',key:item.key});buttons.append(remove);row.append(buttons);$('queue').append(row);
 });
 if(!state.upcoming.length)$('queue').append(el('p','A great setlist starts with one song.','empty'));
}
$('search-form').onsubmit=async e=>{e.preventDefault();$('search-button').disabled=true;message('Searching YouTube…');try{const results=await api(`/api/search?q=${encodeURIComponent($('query').value.trim())}`);$('results').replaceChildren();for(const song of results){const b=el('button',undefined,'result');const image=el('img');image.src=song.thumbnail;image.alt='';const info=el('div');info.append(el('strong',song.title),el('small',`${song.channel} · ${clock(song.duration)}`));b.append(image,info,el('span','+'));b.onclick=()=>{selected=song;$('artist').value=song.parsed.artist;$('title').value=song.parsed.title;$('edit-error').textContent='';$('edit').showModal();};$('results').append(b);}message(results.length?'Choose a song to add it to your setlist.':'No songs found. Try another title.');}catch(error){message(error.message);}finally{$('search-button').disabled=false;}};
$('add-form').onsubmit=async e=>{e.preventDefault();$('add-button').disabled=true;try{await api('/api/queue',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:selected.id,artist:$('artist').value.trim(),title:$('title').value.trim()})});$('edit').close();message('Added to your setlist.');}catch(error){$('edit-error').textContent=error.message;}finally{$('add-button').disabled=false;}};
$('cancel').onclick=()=>$('edit').close();$('play').onclick=()=>send({action:state?.playing?'pause':'play'});$('skip').onclick=()=>send({action:'skip'});
$('earlier').onclick=()=>send({action:'offset',delta:-0.5});$('later').onclick=()=>send({action:'offset',delta:0.5});$('vocal').oninput=()=>send({action:'vocal',value:Number($('vocal').value)});
$('pinyin').onchange=()=>send({action:'pinyin',value:$('pinyin').checked});
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

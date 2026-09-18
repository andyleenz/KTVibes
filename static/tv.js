import {$,el,connect,api,clock} from './shared.js';
const music=$('instrumental'),voice=$('vocals'),video=$('backdrop');
video.muted=true;
let state,currentKey=null,context,musicGain,voiceGain,enabled=false,activeLine=-1,starting=false,generation=0,lastReport=0,seekTo=null,serverSkew=0,buffering=false,videoStarting=false,lyricsPositioned=false,lastSeek=0;
const error=text=>$('tv-error').textContent=text;
const send=connect('tv',render,error);
api('/api/config').then(c=>$('remote-url').textContent=c.remote_url).catch(e=>error(e.message));
function render(next){
 state=next;document.body.classList.toggle('pinyin',!!state.pinyin);document.body.style.setProperty('--lyric-scale',state.lyric_scale??1);serverSkew=state.server_time-Date.now()/1000;$('vocal').value=state.vocal;if(voiceGain)voiceGain.gain.value=state.vocal;
 const queued=state.upcoming.filter(i=>i.status!=='error');
 $('on-deck').replaceChildren(...queued.slice(0,3).map(i=>{const row=el('li');row.append(el('b',i.title),el('span',` ${i.artist}`),...(i.status==='ready'?[]:[el('small',` ${i.status}`)]));return row;}));
 if(queued.length>3)$('on-deck').append(el('li',`+${queued.length-3} more`,'more'));
 if(!queued.length)$('on-deck').append(el('li','Queue a song from your phone','more'));
 $('now-card').hidden=!state.current;
 // The idle screen already shows a large QR code.
 $('corner-join').hidden=!state.current;
 if((state.current?.key||null)!==currentKey){
  generation++;music.pause();voice.pause();video.pause();starting=false;buffering=false;videoStarting=false;currentKey=state.current?.key||null;activeLine=-1;lyricsPositioned=false;lastSeek=state.seek_id;$('lyrics').replaceChildren();$('lyrics').scrollTo({top:0,behavior:'instant'});error('');
  if(state.current){
   const item=state.current;
   video.hidden=!item.video;$('video-shade').hidden=!item.video;document.body.classList.toggle('has-video',!!item.video);
   if(item.video){video.src=`/media/${item.id}/video.mp4`;video.load();}else{video.removeAttribute('src');video.load();}
   seekTo=state.position||0;music.src=`/media/${item.id}/no_vocals.wav`;voice.src=`/media/${item.id}/vocals.wav`;music.load();voice.load();
   $('song-title').textContent=item.title;$('song-artist').textContent=item.artist;$('next-title').textContent=item.title;$('next-artist').textContent=item.artist;
   item.lyrics.forEach(line=>{const p=el('p',line.units?undefined:line.text||'♪','lyric');p.dir='auto';for(const [text,,,reading] of line.units||[]){const span=el('span',undefined,reading?'unit ruby':'unit');if(reading){const ruby=el('ruby',text);ruby.append(el('rt',reading));span.append(ruby);}else span.textContent=text;p.append(span);}$('lyrics').append(p);});$('no-lyrics').hidden=!!item.lyrics.length;$('lyrics').hidden=!item.lyrics.length;$('duration').textContent=clock(item.duration);
  }else{video.pause();video.removeAttribute('src');video.load();video.hidden=true;$('video-shade').hidden=true;document.body.classList.remove('has-video');music.removeAttribute('src');voice.removeAttribute('src');music.load();voice.load();$('elapsed').textContent='0:00';$('duration').textContent='0:00';$('progress').style.width='0%';}
 }
 if(state.current&&state.seek_id!==lastSeek){
  lastSeek=state.seek_id;
  if(music.readyState&&seekTo===null){music.currentTime=voice.currentTime=state.position;if(state.current.video&&video.readyState)video.currentTime=state.position;}else seekTo=state.position;
  lyricsPositioned=false;
 }
 if(!state.playing){music.pause();voice.pause();video.pause();}
}
$('enable-button').onclick=async()=>{
 try{
  if(!context){context=new AudioContext();musicGain=context.createGain();voiceGain=context.createGain();context.createMediaElementSource(music).connect(musicGain).connect(context.destination);context.createMediaElementSource(voice).connect(voiceGain).connect(context.destination);musicGain.gain.value=1;voiceGain.gain.value=state?.vocal??0.1;}
  await context.resume();enabled=true;$('enable').hidden=true;$('audio-error').textContent='';
 }catch(e){$('audio-error').textContent=e.message;}
};
$('fullscreen').onclick=()=>{const result=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();result.catch(e=>error(e.message));};
$('vocal').oninput=()=>send({action:'vocal',value:Number($('vocal').value)});
music.onwaiting=()=>{buffering=true;voice.pause();video.pause();};
music.onplaying=()=>{buffering=false;if(enabled&&state?.playing&&currentKey){voice.currentTime=music.currentTime;voice.play().catch(()=>error('Guide vocals could not resume. Pause and play to retry.'));}};
music.onended=()=>{voice.pause();video.pause();send({action:'ended',key:currentKey});};
for(const audio of [music,voice])audio.onerror=()=>{if(currentKey)error('Audio could not load. Check the server or skip this song.');};
video.onerror=()=>{video.hidden=true;$('video-shade').hidden=true;document.body.classList.remove('has-video');};
async function start(){
 if(starting||!music.paused||music.ended||music.readyState<3||voice.readyState<3)return;
 const token=generation;starting=true;
 try{
  if(seekTo!==null){music.currentTime=seekTo;seekTo=null;}
  voice.currentTime=music.currentTime;
  await Promise.all([music.play(),voice.play()]);
  if(token===generation&&!state?.playing){music.pause();voice.pause();video.pause();}
 }catch(e){
  console.warn('Playback start failed',e.name,e.message);
  if(token===generation&&e.name==='NotAllowedError'){music.pause();voice.pause();enabled=false;$('enable').hidden=false;$('audio-error').textContent='Tap Enable sound to resume playback.';}
 }finally{if(token===generation)starting=false;}
}
function frame(now){
 if(state){
  const waiting=state.current&&(Date.now()/1000+serverSkew)<state.transition_until;
  $('idle').hidden=!!state.current;$('up-next').hidden=!waiting;$('performance').hidden=!state.current||waiting;
  if(waiting)$('countdown').textContent=Math.ceil(state.transition_until-(Date.now()/1000+serverSkew));
  video.hidden=!state.current?.video||!!waiting||!!video.error;
  $('video-shade').hidden=video.hidden;
  if(state.current&&!waiting&&enabled&&state.playing)start();
  if(state.current?.video&&!waiting&&!buffering&&!music.paused&&state.playing&&video.readyState>=3){
   if(Math.abs(video.currentTime-music.currentTime)>0.12)video.currentTime=music.currentTime;
   if(video.paused&&!video.ended&&!videoStarting){videoStarting=true;const token=generation;video.play().catch(()=>{if(token===generation)video.hidden=true;}).finally(()=>{if(token===generation)videoStarting=false;});}
  }else if(!video.paused)video.pause();
  if(state.current){
   if(!music.paused&&!voice.paused&&Math.abs(voice.currentTime-music.currentTime)>0.08)voice.currentTime=music.currentTime;
   const time=music.currentTime+state.offset;const lines=state.current.lyrics;let index=-1;
   for(let i=0;i<lines.length&&lines[i].t<=time;i++)index=i;
   // The countdown hides this panel: wait for layout before measuring a line.
   // Each song starts at the beginning, without inheriting the previous scroll.
   if(!waiting&&(!lyricsPositioned||index!==activeLine)){
    const firstPosition=!lyricsPositioned;
    activeLine=index;
    const container=$('lyrics');
    [...container.children].forEach((line,i)=>{line.classList.toggle('active',i===index);line.classList.toggle('past',i<index);});
    const line=container.children[index];
    container.scrollTo({
     top:line?Math.max(0,line.offsetTop-container.clientHeight/2+line.clientHeight/2):0,
     behavior:firstPosition?'instant':'smooth'
    });
    lyricsPositioned=true;
   }
   const units=lines[index]?.units,spans=$('lyrics').children[index]?.children;
   // KTV wipe: each character/word fills left to right over its sung interval.
   if(units&&spans)units.forEach(([,from,to],i)=>spans[i]?.style.setProperty('--p',Math.max(0,Math.min(1,(time-from)/Math.max(.05,to-from)))));
   $('elapsed').textContent=clock(music.currentTime);$('progress').style.width=`${Math.min(100,music.currentTime/(state.current.duration||1)*100)}%`;
   if(now-lastReport>2000&&!music.paused){lastReport=now;send({action:'progress',key:currentKey,position:music.currentTime});}
  }
 }
 requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.querySelector('.track').onclick=e=>{
 if(!state?.current)return;
 const box=e.currentTarget.getBoundingClientRect();
 send({action:'seek',position:(e.clientX-box.left)/box.width*state.current.duration});
};

import {$,el,connect,api,clock,throttle,prepLabel,syncRanges} from './shared.js';
const music=$('instrumental'),voice=$('vocals'),video=$('backdrop');
video.muted=true;
let breather=0,guide,state,lyrics=[],firstLine=-1,stemGain=1,currentKey=null,context,musicGain,voiceGain,shifter,enabled=false,activeLine=-1,starting=false,generation=0,lastReport=0,seekTo=null,serverSkew=0,buffering=false,videoStarting=false,lyricsPositioned=false,lastSeek=0;
const error=text=>$('tv-error').textContent=text;
// This screen remembers its own display settings and restores them each time it (re)connects.
const SETTINGS='ktvibes.tv-settings';let restoring=false;
// On (re)connect, also tell the server whether sound is on, so remotes know if playback can start.
// Many music videos have black bars baked into the frame; sample a few frames, find the bars,
// then zoom past them so the picture itself fills the screen. The smallest bars seen win, so a dark scene can't over-crop.
const probe=document.createElement('canvas');probe.width=160;probe.height=90;const probeContext=probe.getContext('2d',{willReadFrequently:true});
function fillFrame(v){
 let bars,samples=0,lastSample=0;
 const reset=()=>{bars=null;samples=0;lastSample=0;v.style.transform='';};
 const apply=()=>{
  if(!bars||!v.videoWidth)return;
  const W=innerWidth,H=innerHeight,w=v.videoWidth,h=v.videoHeight,cw=w*(1-bars.left-bars.right),ch=h*(1-bars.top-bars.bottom);
  const full=Math.max(W/w,H/h),crop=Math.max(W/cw,H/ch)*1.01,scale=crop/full;
  const dx=(bars.right-bars.left)/2*w*crop,dy=(bars.bottom-bars.top)/2*h*crop;
  v.style.transform=scale>1.01?`translate(${dx}px,${dy}px) scale(${scale})`:'';
 };
 const sample=()=>{
  try{probeContext.drawImage(v,0,0,160,90);}catch{return;}
  const {data}=probeContext.getImageData(0,0,160,90),dark=(x0,y0,x1,y1)=>{for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){const i=(y*160+x)*4;if(data[i]+data[i+1]+data[i+2]>72)return false;}return true;};
  let top=0,bottom=0,left=0,right=0;
  while(top<45&&dark(0,top,160,top+1))top++;while(bottom<45&&dark(0,89-bottom,160,90-bottom))bottom++;
  while(left<80&&dark(left,0,left+1,90))left++;while(right<80&&dark(159-right,0,160-right,90))right++;
  if(top+bottom>60||left+right>110)return;  // a mostly black frame (fade, title card) says nothing about the bars
  const found={top:top/90,bottom:bottom/90,left:left/160,right:right/160};
  bars=bars?Object.fromEntries(Object.keys(found).map(k=>[k,Math.min(bars[k],found[k])])):found;samples++;apply();
 };
 v.addEventListener('loadstart',reset);
 v.addEventListener('timeupdate',()=>{if(samples<8&&v.currentTime-lastSample>1.5||v.currentTime<lastSample){lastSample=v.currentTime;sample();}});
 addEventListener('resize',apply);
}
fillFrame(video);
// An empty stage loops random cached music videos, muted, behind the idle screen.
const ambient=$('ambient');ambient.muted=true;fillFrame(ambient);let ambientIds=[],ambientOn=false;
function nextAmbient(){
 if(!ambientOn||!ambientIds.length){ambient.hidden=true;return;}
 const last=ambient.dataset.id,choices=ambientIds.length>1?ambientIds.filter(id=>id!==last):ambientIds,id=choices[Math.floor(Math.random()*choices.length)];
 ambient.dataset.id=id;ambient.src=`/media/${id}/video.mp4`;ambient.play().then(()=>{if(ambientOn)ambient.hidden=false;}).catch(()=>ambient.hidden=true);
}
function setAmbient(on){
 if(on===ambientOn)return;ambientOn=on;
 if(!on){ambient.pause();ambient.hidden=true;ambient.removeAttribute('src');ambient.load();return;}
 // Refetch each time the stage empties, so songs downloaded since join the rotation.
 api('/api/ambient').then(ids=>{ambientIds=ids;nextAmbient();}).catch(()=>{});
}
ambient.onended=nextAmbient;
ambient.onerror=()=>{if(!ambientOn)return;ambientIds=ambientIds.filter(id=>id!==ambient.dataset.id);nextAmbient();};
const send=connect('tv',render,error,()=>{restoring=true;send({action:'audio',value:enabled});});
function saved(){try{return JSON.parse(localStorage.getItem(SETTINGS))||{};}catch{return {};}}
function remember(s){try{localStorage.setItem(SETTINGS,JSON.stringify({lyric_scale:s.lyric_scale,vocal:s.vocal,guide:s.guide}));}catch{}}
function restore(s){const mine=saved();for(const [action,value] of [['lyric_scale',mine.lyric_scale],['vocal',mine.vocal],['guide',mine.guide]])if(value!==undefined&&value!==s[action])send({action,value});}
api('/api/config').then(c=>$('remote-url').textContent=c.remote_url).catch(e=>error(e.message));
function render(next){
 state=next;if(restoring){restoring=false;restore(state);}else remember(state);if(state.guide!==guide){if(guide!==undefined)showGuideBadge(state.guide);guide=state.guide;document.body.dataset.guide=guide;}showChanges(state);showQueueChange(state);document.body.style.setProperty('--lyric-scale',state.lyric_scale??1);serverSkew=state.server_time-Date.now()/1000;$('vocal').value=state.vocal;syncRanges();applyGain();
 const queued=state.upcoming.filter(i=>i.status!=='error');
 $('on-deck').replaceChildren(...queued.slice(0,3).map(i=>{const row=el('li');row.append(el('b',i.title),el('span',` ${i.artist}`),...(i.status==='ready'?[]:[el('small',` ${prepLabel(i).text}`)]));return row;}));
 if(queued.length>3)$('on-deck').append(el('li',`+${queued.length-3} more`,'more'));
 if(!queued.length)$('on-deck').append(el('li','Nothing queued','more'));
 showPrep(queued);setAmbient(!state.current);
 $('now-card').hidden=!state.current;
 // The idle screen already shows a large QR code.
 $('corner-join').hidden=!state.current;
 $('tv-bottom').hidden=!state.current;
 if((state.current?.key||null)!==currentKey){
  generation++;music.pause();voice.pause();video.pause();starting=false;buffering=false;videoStarting=false;currentKey=state.current?.key||null;activeLine=-1;lyricsPositioned=false;lastSeek=state.seek_id;$('lyrics').replaceChildren();$('lyrics').scrollTo({top:0,behavior:'instant'});error('');
  if(state.current){
   const item=state.current;
   video.hidden=!item.video;$('video-shade').hidden=!item.video;document.body.classList.toggle('has-video',!!item.video);
   if(item.video){video.src=`/media/${item.id}/video.mp4`;video.load();}else{video.removeAttribute('src');video.load();}
   lyrics=item.lyrics||[];firstLine=lyrics.findIndex(line=>line.text);stemGain=item.gain||1;applyGain();seekTo=state.position||0;music.src=`/media/${item.id}/no_vocals.flac`;voice.src=`/media/${item.id}/vocals.flac`;music.load();voice.load();
   $('song-title').textContent=item.title;$('song-artist').textContent=item.artist;$('next-title').textContent=$('card-title').textContent=item.title;$('next-artist').textContent=$('card-artist').textContent=item.artist;
   lyrics.forEach(line=>{const p=el('p',line.units?undefined:line.text||'♪','lyric');p.dir='auto';for(const [text,,,latin,hangul] of line.units||[]){const span=el('span',undefined,latin||hangul?'unit ruby':'unit');if(latin||hangul){const word=text.trimEnd(),ruby=el('ruby',word),rt=el('rt');rt.append(el('span',latin||'','latin'),el('span',hangul||'','hangul'));ruby.append(rt);span.append(ruby);p.append(span,text.slice(word.length));}else{span.textContent=text;p.append(span);}}$('lyrics').append(p);});$('no-lyrics').hidden=!!lyrics.length;$('lyrics').hidden=!lyrics.length;$('duration').textContent=clock(item.duration);
  }else{lyrics=[];firstLine=-1;video.pause();video.removeAttribute('src');video.load();video.hidden=true;$('video-shade').hidden=true;document.body.classList.remove('has-video');music.removeAttribute('src');voice.removeAttribute('src');music.load();voice.load();$('elapsed').textContent='0:00';$('duration').textContent='0:00';$('progress').parentElement.style.setProperty('--p',0);}
 }
 if(state.current&&state.seek_id!==lastSeek){
  lastSeek=state.seek_id;
  if(music.readyState&&seekTo===null){music.currentTime=voice.currentTime=state.position;if(state.current.video&&video.readyState)video.currentTime=state.position;}else seekTo=state.position;
  lyricsPositioned=false;
 }
 if(!state.playing){music.pause();voice.pause();video.pause();}
}
// Stems are stored scaled down to fit FLAC; the gain restores their original level.
// Speed changes tempo only (the browser keeps pitch); the key shift is applied by the worklet.
function applyTempo(){const speed=state?.speed??1;for(const media of [music,voice,video]){media.defaultPlaybackRate=speed;if(media.playbackRate!==speed)media.playbackRate=speed;}if(shifter)shifter.parameters.get('ratio').value=2**((state?.key??0)/12);}
function applyGain(){applyTempo();if(!musicGain)return;musicGain.gain.value=(state?.music??1)*stemGain;voiceGain.gain.value=(state?.vocal??0.1)*stemGain;}
$('enable-button').onclick=async()=>{
 try{
  if(!context){
   context=new AudioContext();musicGain=context.createGain();voiceGain=context.createGain();
   // Both stems run through one pitch shifter for key changes; without worklets, play at the original key.
   let out=context.destination;
   try{await context.audioWorklet.addModule('/static/pitch.js');shifter=new AudioWorkletNode(context,'pitch-shifter',{outputChannelCount:[2]});shifter.connect(out);out=shifter;}catch(e){console.warn('Key change unavailable',e);}
   context.createMediaElementSource(music).connect(musicGain).connect(out);context.createMediaElementSource(voice).connect(voiceGain).connect(out);applyGain();
  }
  await context.resume();enabled=true;send({action:'audio',value:true});$('enable').hidden=true;$('audio-error').textContent='';
 }catch(e){$('audio-error').textContent=e.message;}
};
$('fullscreen').onclick=()=>{const result=document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen();result.catch(e=>error(e.message));};
const sendVocal=throttle(value=>send({action:'vocal',value}));
$('vocal').oninput=()=>sendVocal(Number($('vocal').value));
music.onwaiting=()=>{buffering=true;voice.pause();video.pause();};
music.onplaying=()=>{buffering=false;if(enabled&&state?.playing&&currentKey){voice.currentTime=music.currentTime;voice.play().catch(()=>error('Vocals could not resume. Pause and play to retry.'));}};
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
  if(token===generation&&e.name==='NotAllowedError'){music.pause();voice.pause();enabled=false;send({action:'audio',value:false});$('enable').hidden=false;$('audio-error').textContent='Tap Enable sound to resume playback.';}
 }finally{if(token===generation)starting=false;}
}
const COUNT_IN=4;  // seconds before the first line that the lyrics appear
function frame(now){
 if(state){
  const waiting=state.current&&(Date.now()/1000+serverSkew)<state.transition_until;
  $('idle').hidden=!!state.current;$('up-next').hidden=!waiting;$('performance').hidden=!state.current||waiting;
  // Between songs, the bar drains over the breather.
  if(waiting){const left=state.transition_until-(Date.now()/1000+serverSkew);breather=Math.max(breather,left);$('breather-bar').style.width=`${left/breather*100}%`;}else breather=0;
  if(!state.current||waiting)document.body.classList.remove('intro');
  document.body.classList.toggle('between',!!waiting);
  video.hidden=!state.current?.video||!!waiting||!!video.error;
  $('video-shade').hidden=video.hidden;
  if(state.current&&!waiting&&enabled&&state.playing)start();
  if(state.current?.video&&!waiting&&!buffering&&!music.paused&&state.playing&&video.readyState>=3){
   if(Math.abs(video.currentTime-music.currentTime)>0.12)video.currentTime=music.currentTime;
   if(video.paused&&!video.ended&&!videoStarting){videoStarting=true;const token=generation;video.play().catch(()=>{if(token===generation)video.hidden=true;}).finally(()=>{if(token===generation)videoStarting=false;});}
  }else if(!video.paused)video.pause();
  if(state.current){
   if(!music.paused&&!voice.paused&&Math.abs(voice.currentTime-music.currentTime)>0.08)voice.currentTime=music.currentTime;
   const time=music.currentTime+state.offset;const lines=lyrics;let index=-1;
   // Lines switch on their sung words (start), so a stamp never cuts off the previous line's last word.
   for(let i=0;i<lines.length&&(lines[i].start??lines[i].t)<=time;i++)index=i;
   // The breather hides this panel: wait for layout before measuring a line.
   // Each song starts at the beginning, without inheriting the previous scroll.
   if(!waiting&&(!lyricsPositioned||index!==activeLine)){
    const firstPosition=!lyricsPositioned;
    activeLine=index;
    const container=$('lyrics');
    [...container.children].forEach((line,i)=>{line.classList.toggle('active',i===index);line.classList.toggle('past',i<index);});
    // Before the first line is sung, keep it centered, ready for the count-in.
    const line=container.children[index>=0?index:firstLine];
    container.scrollTo({
     top:line?Math.max(0,line.offsetTop-container.clientHeight/2+line.clientHeight/2):0,
     behavior:firstPosition?'instant':'smooth'
    });
    lyricsPositioned=true;
   }
   // Karaoke count-in: lyrics stay hidden through the intro, then dots count down to the first line.
   const remaining=firstLine>=0?(lines[firstLine].start??lines[firstLine].t)-time:0;
   // Title card over the intro, like a karaoke machine: it fades before the count-in dots,
   // and a song whose lyrics start almost at once skips it.
   const cardEnd=firstLine>=0?Math.min(12,time+remaining-COUNT_IN-0.5):8;
   document.body.classList.toggle('intro',!waiting&&cardEnd>=3&&time<cardEnd);
   $('lyrics').classList.toggle('waiting',remaining>COUNT_IN);
   const lead=$('lyrics').children[firstLine],dots=remaining>0&&remaining<=COUNT_IN?'●'.repeat(Math.min(3,Math.ceil(remaining))):'';
   if(lead&&lead.dataset.dots!==dots)lead.dataset.dots=dots;
   const units=lines[index]?.units,spans=$('lyrics').children[index]?.children;
   // KTV wipe: each character/word fills left to right over its sung interval.
   if(units&&spans)units.forEach(([,from,to],i)=>spans[i]?.style.setProperty('--p',Math.max(0,Math.min(1,(time-from)/Math.max(.05,to-from)))));
   $('elapsed').textContent=clock(music.currentTime);$('progress').parentElement.style.setProperty('--p',Math.min(1,music.currentTime/(state.current.duration||1)));
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
const GUIDE_BADGES={off:['–','Guide off'],latin:['Aa','Romanization'],hangul:['가','한글']};
let badgeTimer;
function showGuideBadge(mode){const [icon,label]=GUIDE_BADGES[mode];showBadge(icon,'Pronunciation',label);}
// Any adjustment from a remote flashes on screen, so the room sees what changed.
// The meter shows where the value sits in its range; centred ones (key, timing) fill out from the middle.
const pct=v=>`${Math.round(v*100)}%`,signed=(v,digits=0)=>`${v>0?'+':v<0?'−':''}${Math.abs(v).toFixed(digits)}`,BADGES={
 music:v=>['♫','Music',pct(v),[0,v]],vocal:v=>['🎤','Vocals',pct(v),[0,v]],
 speed:v=>['⏱','Speed',pct(v),[0,v-0.5]],
 key:v=>[v>0?'♯':v<0?'♭':'♮','Key',signed(v),[.5,.5+v/12]],
 offset:v=>['⇆','Lyric timing',`${signed(v,1)}s`,[.5,.5+Math.max(-.5,Math.min(.5,v/10))]],
 lyric_scale:v=>['Aa','Lyric size',pct(v),[0,(v-0.6)/1.2]]};
let shown=null;
function showChanges(s){
 const now=Object.fromEntries(Object.keys(BADGES).map(k=>[k,s[k]]));
 // A new song resets speed, key and timing on its own; only announce changes made mid-song.
 if(shown&&shown.song===(s.current?.key||null))for(const k in BADGES)if(now[k]!==undefined&&now[k]!==shown[k]){showBadge(...BADGES[k](now[k]));break;}
 shown={...now,song:s.current?.key||null};
}
// Queue changes from any remote get the same card: what was added, removed, moved, or became ready.
let lastQueue=null;
function showQueueChange(s){
 const queue=s.upcoming.map(i=>({key:i.key,title:i.title,status:i.status})),before=lastQueue;lastQueue=queue;
 if(!before)return;
 const old=new Map(before.map(i=>[i.key,i])),keys=new Set(queue.map(i=>i.key)),stage=s.current?.key;
 const added=queue.find(i=>!old.has(i.key)),removed=before.find(i=>!keys.has(i.key)&&i.key!==stage);
 if(added)return showBadge('+','Queued',added.title);
 if(removed)return showBadge('✕','Removed',removed.title);
 const failed=queue.find(i=>i.status==='error'&&old.get(i.key).status!=='error');
 if(failed)return showBadge('!','Couldn’t prepare',failed.title);
 const ready=queue.find(i=>i.status==='ready'&&old.get(i.key).status!=='ready');
 if(ready)return showBadge('✓','Ready to sing',ready.title);
 const order=before.filter(i=>keys.has(i.key)).map(i=>i.key),now=queue.map(i=>i.key);
 if(order.join()!==now.join()){
  // Name the song that moved furthest, with its new place in line.
  let moved=0,best=-1;now.forEach((k,i)=>{const d=Math.abs(order.indexOf(k)-i);if(d>best){best=d;moved=i;}});
  const up=order.indexOf(now[moved])>moved;
  showBadge(up?'↑':'↓',`Moved to #${moved+1}`,queue[moved].title);
 }
}
// Springs in, pulses the icon on each further change while visible, then shrinks away.
function showBadge(icon,name,value,range){
 const osd=$('guide-badge'),meter=$('osd-meter'),visible=!osd.hidden&&!osd.classList.contains('out');
 $('guide-icon').textContent=icon;$('osd-name').textContent=name;$('guide-label').textContent=value;
 meter.hidden=!range;
 if(range){const [a,b]=range;meter.style.setProperty('--from',Math.min(a,b));meter.style.setProperty('--to',Math.max(a,b));}
 clearTimeout(badgeTimer);osd.classList.remove('out');osd.hidden=false;
 const glyph=$('guide-icon');glyph.classList.remove('pop');void glyph.offsetWidth;glyph.classList.add('pop');
 if(!visible){osd.classList.remove('in');void osd.offsetWidth;osd.classList.add('in');}
 badgeTimer=setTimeout(()=>{osd.classList.add('out');osd.addEventListener('animationend',()=>{if(osd.classList.contains('out')){osd.hidden=true;osd.classList.remove('out','in');}},{once:true});},1600);
}
// "G" on a keyboard or remote also flips the guide.
addEventListener('keydown',e=>{if(e.key==='g'||e.key==='G')send({action:'guide',value:'cycle'});});
// Songs download and separate one at a time; show the one in progress so a wait never looks like a hang.
// On an empty stage the song being prepared is the headline. During a song, preparation shows
// only as small status text in the "Up next" list, so it never covers the lyrics.
function showPrep(queued){
 const item=state.current?null:queued.find(i=>i.status!=='ready'&&i.status!=='queued')||queued.find(i=>i.status==='queued');
 $('idle-prep').hidden=!item;$('idle-hero').hidden=!!item;
 if(!item)return;
 const {percent,text}=prepLabel(item);  // no percent while yt-dlp is still extracting
 $('idle-prep-step').textContent=text;$('idle-prep-title').textContent=item.title;
 const bar=$('idle-prep-bar');bar.parentElement.classList.toggle('busy',percent==null);bar.parentElement.style.setProperty('--p',percent==null?0:percent/100);
}
// A floating remote for whoever sits at the TV computer: an always-on-top Picture-in-Picture window
// where the browser supports it (it stays over fullscreen), otherwise a small popup. Tap again to close.
let remoteWindow=null;
$('open-remote').onclick=async()=>{
 if(remoteWindow&&!remoteWindow.closed){remoteWindow.close();remoteWindow=null;return;}
 try{
  if('documentPictureInPicture' in window){
   remoteWindow=await documentPictureInPicture.requestWindow({width:390,height:844});
   const frame=remoteWindow.document.createElement('iframe');frame.src='/';frame.title='KTVibes remote';
   frame.style.cssText='position:fixed;inset:0;width:100%;height:100%;border:0';
   remoteWindow.document.body.style.cssText='margin:0;background:#111313';remoteWindow.document.body.append(frame);
   remoteWindow.addEventListener('pagehide',()=>{remoteWindow=null;});
  }else remoteWindow=open('/','ktvibes-remote',`popup,width=390,height=844,left=${screenX+outerWidth-430},top=${screenY+80}`);
 }catch(e){error(e.message);}
};


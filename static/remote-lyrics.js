// Live lyrics on the remote: the playing song's words, filled word by word in step with the TV.
// remote.js calls lyricsState() on every state update; the view fetches lines itself (broadcasts leave them out).
import {$,el,api,clock,thumbnail,REDUCED} from './shared.js';

let state=null,lines=[],loaded='',frame=0,manual=0,lineEls=[],unitEls=[],shown=-1;
const view=$('lyrics-view'),list=$('lv-lines'),scroller=$('lv-scroll');

// Where the TV is now: the last reported position, run forward at the song's speed while playing.
function playhead(){
 if(!state?.current)return 0;
 const run=state.playing?(Date.now()/1000-state.received)*(state.speed||1):0;
 return Math.min(state.position+run,state.current.duration||Infinity)+(state.offset||0);
}
const startOf=i=>lines[i]?.units?.[0]?.[1]??lines[i]?.t??Infinity;
const endOf=i=>lines[i]?.units?.at(-1)?.[2]??startOf(i+1);

function build(){
 lineEls=[];unitEls=[];shown=-1;list.style.transform='';
 if(!lines.length){list.replaceChildren(el('p','No lyrics','lv-none'));return;}
 list.replaceChildren(...lines.map((line,i)=>{
  const p=el('p',line.units?undefined:line.text||'♪');p.dir='auto';
  unitEls[i]=(line.units||[]).map(([text])=>{const span=el('span',text,'w');p.append(span);return span;});
  lineEls[i]=p;return p;
 }));
}

async function load(){
 const c=state?.current,want=c?`${c.key}:${c.lyrics_rev||0}`:'';
 if(want===loaded)return;loaded=want;
 if(!c){lines=[];build();return;}
 try{const body=await api('/api/current/lyrics');if(loaded!==want)return;lines=body.key===c.key&&body.lines||[];}catch{lines=[];}
 build();
}

function header(){
 const c=state?.current;
 $('lv-title').textContent=c?.title||'Nothing playing';$('lv-artist').textContent=c?.artist||'';
 const art=c?thumbnail(c.id):'';$('lv-art').src=art;view.style.setProperty('--art',art?`url("${art}")`:'none');
 $('lv-play').classList.toggle('playing',!!state?.playing);$('lv-play').setAttribute('aria-label',state?.playing?'Pause':'Play');
}

function tick(){
 frame=requestAnimationFrame(tick);
 const time=playhead(),c=state?.current;
 if(c){const at=Math.max(0,time-(state.offset||0));$('lv-position').textContent=clock(at);$('lv-fill').style.width=`${c.duration?Math.min(100,at/c.duration*100):0}%`;}
 if(!lines.length)return;
 let now=-1;for(let i=0;i<lines.length;i++){if(startOf(i)<=time)now=i;else break;}
 if(now>=0&&time>endOf(now)&&startOf(now+1)>time+.5)now=-1-now;  // a gap between lines: nothing is "now", but keep our place
 const place=now<0?-1-now:now;
 if(now!==shown){
  lineEls.forEach((p,i)=>{p.className=i===now?'now':i<place||i===place&&now<0?'past':i===place+1?'next':'';});
  shown=now;
  if(Date.now()>manual&&lineEls[place]){
   const y=lineEls[place].offsetTop-scroller.clientHeight*.3;
   list.style.transform=`translateY(${-Math.max(0,y)}px)`;
  }
 }
 // Words: sung, the one being sung (filled left to right), and the rest dimmed.
 const range=[Math.max(0,place-1),Math.min(lines.length-1,place+1)];
 for(let i=range[0];i<=range[1];i++){
  const units=lines[i].units;if(!units)continue;
  units.forEach(([,from,to],n)=>{
   const span=unitEls[i][n],cls=to<=time?'w sung':from<=time?'w cur':'w';
   if(span.className!==cls)span.className=cls;
   if(cls==='w cur')span.style.setProperty('--f',`${Math.round((time-from)/Math.max(.05,to-from)*100)}%`);
  });
 }
}

// Scrolling by hand pauses following the song for 4s.
const hold=()=>{manual=Date.now()+4000;};
scroller.addEventListener('wheel',e=>{hold();const now=parseFloat(list.style.transform.match(/-?[\d.]+/)?.[0]||0);list.style.transform=`translateY(${Math.min(0,now-e.deltaY)}px)`;},{passive:true});
let touchY=null;
scroller.addEventListener('touchstart',e=>{touchY=e.touches[0].clientY;},{passive:true});
scroller.addEventListener('touchmove',e=>{if(touchY==null)return;hold();const dy=e.touches[0].clientY-touchY;touchY=e.touches[0].clientY;const now=parseFloat(list.style.transform.match(/-?[\d.]+/)?.[0]||0);list.classList.add('dragging');list.style.transform=`translateY(${Math.min(0,now+dy)}px)`;},{passive:true});
scroller.addEventListener('touchend',()=>{touchY=null;list.classList.remove('dragging');});

export function openLyrics(){
 if(!view.hidden)return;
 view.hidden=false;document.body.classList.add('lyrics-open');history.pushState({lyrics:true},'');
 header();load();shown=-2;manual=0;cancelAnimationFrame(frame);tick();
 $('lv-close').focus({preventScroll:true});
}
export function closeLyrics(fromHistory){
 if(view.hidden)return;
 cancelAnimationFrame(frame);frame=0;view.hidden=true;document.body.classList.remove('lyrics-open');
 if(!fromHistory&&history.state?.lyrics)history.back();
}
export function lyricsState(next){
 const seeked=state&&next.seek_id!==state.seek_id;state=next;
 if(view.hidden)return;
 header();load();if(seeked)manual=0,shown=-2;
}

$('lv-close').onclick=()=>closeLyrics();
$('lv-play').onclick=()=>$('hero-play').click();
$('lv-skip').onclick=()=>$('skip').click();
$('lv-settings').onclick=()=>$('open-controls').click();
addEventListener('popstate',()=>closeLyrics(true));
addEventListener('keydown',e=>{if(e.key==='Escape'&&!view.hidden&&!document.body.classList.contains('sheet-open'))closeLyrics();});
if(REDUCED.matches)list.classList.add('still');

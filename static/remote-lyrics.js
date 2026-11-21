// Live lyrics on the remote: the playing song's words, filled word by word in step with the TV.
// remote.js calls lyricsState() on every state update; the view fetches lines itself (broadcasts leave them out).
import {$,el,api,clock,thumbnail,livePosition,REDUCED} from './shared.js';

let state=null,send=null,lines=[],loaded='',frame=0,manual=0,lineEls=[],unitEls=[],shown=null,swiped=false,y=0,song='',second=-1;
const view=$('lyrics-view'),list=$('lv-lines'),scroller=$('lv-scroll'),positionEl=$('lv-position'),fillEl=$('lv-fill');
const setY=v=>{y=Math.min(0,v);list.style.transform=`translateY(${y}px)`;};

const startOf=i=>lines[i]?.units?.[0]?.[1]??lines[i]?.t??Infinity;
const endOf=i=>lines[i]?.units?.at(-1)?.[2]??startOf(i+1);

function build(){
 lineEls=[];unitEls=[];shown=null;setY(0);
 if(!lines.length){const none=el('div',undefined,'lv-none');none.append(el('p','No lyrics'));if(state?.current)none.append(el('button','Find lyrics','lv-find'));list.replaceChildren(none);return;}  // remote.js opens the picker
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
 try{const body=await api('/api/current/lyrics');if(loaded!==want)return;lines=body.key===c.key&&body.lines||[];}catch{if(loaded!==want)return;loaded='';lines=[];}  // '' retries on the next update
 build();
}

function header(){
 const c=state?.current;
 $('lv-play').classList.toggle('playing',!!state?.playing);$('lv-play').setAttribute('aria-label',state?.playing?'Pause':'Play');
 if((c?.key||'')===song)return;song=c?.key||'';
 $('lv-title').textContent=c?.title||'Nothing playing';$('lv-artist').textContent=c?.artist||'';
 $('lv-art').src=c?thumbnail(c.id):'';
}

function tick(){
 frame=requestAnimationFrame(tick);
 const c=state?.current,at=c?livePosition(state):0,time=at+(state?.offset||0);  // lyric times run on the offset clock
 if(c&&Math.floor(at)!==second){second=Math.floor(at);positionEl.textContent=clock(at);fillEl.style.width=`${c.duration?Math.min(100,at/c.duration*100):0}%`;}
 if(!lines.length)return;
 let place=-1;for(let i=0;i<lines.length;i++){if(startOf(i)<=time)place=i;else break;}
 // A sung line stays lit through a pause until the next one starts; only an instrumental break (4s past its last
 // word) dims it, and once dimmed it stays dim.
 const gap=place>=0&&time>endOf(place)+4;
 if(shown!==`${place}${gap}`){
  shown=`${place}${gap}`;
  lineEls.forEach((p,i)=>{p.className=i===place&&!gap?'now':i<=place?'past':i===place+1?'next':'';});
  if(Date.now()>manual&&lineEls[place])setY(scroller.clientHeight*.3-lineEls[place].offsetTop);
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
scroller.addEventListener('wheel',e=>{hold();setY(y-e.deltaY);},{passive:true});
let touchY=null;
scroller.addEventListener('touchstart',e=>{touchY=e.touches[0].clientY;swiped=false;},{passive:true});
scroller.addEventListener('touchmove',e=>{if(touchY==null)return;hold();swiped=true;const dy=e.touches[0].clientY-touchY;touchY=e.touches[0].clientY;list.classList.add('dragging');setY(y+dy);},{passive:true});
scroller.addEventListener('touchend',()=>{touchY=null;list.classList.remove('dragging');});

// Tapping a word jumps the song to that word; elsewhere on a line, to the line. The TV's lyric offset comes back out to get song time.
list.addEventListener('click',e=>{
 const i=lineEls.indexOf(e.target.closest('p'));if(i<0||swiped||!send||!state?.current)return;
 const word=unitEls[i].indexOf(e.target.closest('.w')),at=word>=0?lines[i].units[word][1]:startOf(i);if(!isFinite(at))return;
 manual=0;send({action:'seek',position:Math.max(0,at-(state.offset||0))});
});

export function openLyrics(sender){
 send=sender;if(!view.hidden)return;
 view.hidden=false;document.body.classList.add('lyrics-open');history.pushState({lyrics:true},'');
 song=null;second=-1;header();load();shown=null;manual=0;cancelAnimationFrame(frame);tick();
}
export function closeLyrics(fromHistory){
 if(view.hidden)return;
 cancelAnimationFrame(frame);frame=0;view.hidden=true;document.body.classList.remove('lyrics-open');
 if(!fromHistory&&history.state?.lyrics)history.back();
}
export function lyricsState(next){
 const seeked=state&&next.seek_id!==state.seek_id;state=next;
 if(view.hidden)return;
 header();load();if(seeked)manual=0,shown=null;
}

$('lv-close').onclick=()=>closeLyrics();
$('lv-play').onclick=()=>$('hero-play').click();
$('lv-skip').onclick=()=>$('skip').click();
$('lv-settings').onclick=()=>$('open-controls').click();
addEventListener('popstate',()=>{if(!history.state?.lyrics)closeLyrics(true);});
addEventListener('keydown',e=>{if(e.key==='Escape'&&!view.hidden&&!document.body.classList.contains('sheet-open')&&!document.querySelector('.lyric-sheet'))closeLyrics();});
if(REDUCED.matches)list.classList.add('still');

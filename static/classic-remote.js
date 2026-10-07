// Classic theme on the remote: the room's handset and songbook, in four tabs.
// The tabs reuse the remote's own sections (search, queue, settings); CSS shows the active tab's.
import {$,el,api,clock,newSongs} from './shared.js';
const TABS=['handset','book','queue','settings'],TAB_KEY='ktvibes.tab';
const MODES={handset:'곡번호 · DIAL',book:'노래책 · SONGBOOK',queue:'예약 · RESERVED',settings:'방 설정 · ROOM'};
// In DSEG "!" is a blank digit, so lit digits line up over the ghost 88888.
export function lcdText(node,text,cursor,width=5){const blink=cursor&&text.length<width;node.replaceChildren(text,...(blink?[el('span','8','blink')]:[]),'!'.repeat(Math.max(0,width-text.length-(blink?1:0))));}
// An empty list's notice: in Classic a rubber stamp and a Korean line sit beside the English.
export function emptyNote(stamp,ko,text){const p=el('p',undefined,'empty'),words=el('span');words.append(el('b',ko,'classic-only'),text);p.append(el('span',stamp,'stamp classic-only'),words);return p;}
// Toasts in Classic: which key labels the message, which part is the song, and a Korean line under it.
const TOASTS=[
 [/^Removed (.+)$/,'취소','',t=>['Removed ',el('b',t)],'예약을 취소했어요'],
 [/^Added (.+)$/,'추가','',t=>['Added ',el('b',t)],'예약했어요 · queued'],
 [/^Deleted (.+)$/,'삭제','',t=>['Deleted ',el('b',t)],'다운로드를 지웠어요'],
 [/^Lyrics for (.+) set to (.+)$/,'가사','grn',(t,v)=>['Lyrics for ',el('b',t),` set to ${v}`],''],
 [/^Sent (\S+)(.*) to the device$/,null,'emo',null,''],
 [/^(\d+) 우선예약$/,'우선','org',n=>[lcdSpan(n),' 우선예약'],'Plays next'],
 [/^(.+) 우선예약$/,'우선','org',t=>[el('b',t),' 우선예약'],'Plays next'],
 [/^(\d+) 예약(?: · (.+))?$/,'예약','',(n,t)=>[lcdSpan(n),' 예약',...(t?[' · ',el('b',t)]:[])],''],
 [/^번호를 먼저/,'번호','amb',()=>['번호를 먼저 누르세요'],'Dial a number first'],
 [/^Reconnecting\. Please try again\.$/,'오류','err',()=>['Reconnecting. Please try again.'],'연결 중이에요 · 잠시 후 다시 눌러 주세요'],
 [/^No song (\d+)$/,'오류','err',n=>['No song ',lcdSpan(n)],'없는 곡번호예요 · check the 노래책'],
];
function lcdSpan(n){const s=el('span',n,'lcd');s.dataset.ghost='88888';return s;}
export function toastParts(text,kind){
 for(const [pattern,key,tone,body,sub] of TOASTS){const m=text.match(pattern);if(!m)continue;
  if(!body)return {key:m[1],tone:'emo',body:[text]};
  return {key,tone,body:[...body(...m.slice(1)),...(sub?[el('small',sub)]:[])]};}
 return kind==='err'?{key:'오류',tone:'err',body:[text]}:{key:'알림',tone:'',body:[text]};
}
export function secondsLeft(state){return state?.room_ends?Math.max(0,state.room_ends-(state.server_time+Date.now()/1000-state.received)):null;}
export function classicRemote({send,toast,haptic,swipeable}){
 let state=null;const ui={digits:''};
 const classic=()=>document.body.dataset.theme==='classic',tab=()=>document.body.dataset.tab;
 let saved;try{saved=localStorage.getItem(TAB_KEY);}catch{}
 document.body.dataset.tab=TABS.includes(saved)?saved:'book';
 function setTab(name){
  document.body.dataset.tab=name;try{localStorage.setItem(TAB_KEY,name);}catch{}
  for(const b of document.querySelectorAll('#tabs [data-tab]'))b.setAttribute('aria-current',b.dataset.tab===name?'page':'false');
  syncSheet();scrollTo(0,0);showLcd();placeIndex?.();
 }
 for(const b of document.querySelectorAll('#tabs [data-tab]'))b.onclick=()=>{haptic(6);setTab(b.dataset.tab);};
 // In Classic the settings sheet is the 설정 tab's page; outside Classic it is the usual sheet.
 function syncSheet(){if(classic()){document.body.classList.remove('sheet-open');$('sheet').inert=tab()!=='settings';}else $('sheet').inert=!document.body.classList.contains('sheet-open');}
 function showLcd(){
  if(!state)return;const c=state.current,left=secondsLeft(state),lost=$('connection').classList.contains('lost');
  // While the socket is down the typed digits stay, the room numbers go blank and the song line says it's reconnecting.
  $('lcd-window').classList.toggle('dead',lost);
  $('lcd-mode').textContent=MODES[tab()];$('lcd-status').textContent=lost?'연결 끊김 · OFFLINE':!c?'■ 대기':state.playing?'♪ 반주중':'❚❚ 일시정지';$('lcd-status').className=lost?'off':c?'':'idle';
  lcdText($('lcd-digits'),ui.digits||(lost?'':String(c?.number??'')),tab()==='handset'&&!lost&&(!!ui.digits||!c?.number));
  $('lcd-reserved').textContent=lost?'!!':String(state.upcoming.length).padStart(2,'0');
  $('lcd-left').textContent=lost?'!!!':left==null?'---':String(Math.ceil(left/60)).padStart(3,'0');
  $('lcd-song').replaceChildren(...(lost?['다시 연결하는 중… ',el('span','- reconnecting')]:c?[`${c.number?`${c.number} `:''}${c.title} `,el('span',`- ${c.artist}`)]:['노래를 선택해 주세요 ',el('span','· Pick a song')]));
  const minutes=Math.round(state.upcoming.reduce((sum,item)=>sum+(item.duration||0),0)/60);$('queue-total').textContent=`곡${minutes?` · 약 ${minutes}분`:''}`;
  $('tab-count').textContent=state.upcoming.length;$('tab-count').hidden=!state.upcoming.length;
 }
 setInterval(showLcd,1000);
 // The handset: digits show on the TV as they're typed; 예약 queues by number.
 const dial=digits=>{ui.digits=digits;send({action:'dial',digits});showLcd();};
 for(const key of ['1','2','3','4','5','6','7','8','9','⌫','0','book']){
  const b=el('button',undefined,`rk ${/\d/.test(key)?'digit':'fn'}`);
  if(key==='⌫'){b.append('⌫',el('small','지우기'));b.setAttribute('aria-label','Delete digit');}
  else if(key==='book'){b.append('📖',el('small','노래책'));b.setAttribute('aria-label','Open the songbook');}
  else b.textContent=key;
  b.onclick=()=>{haptic(6);if(key==='book')setTab('book');else if(key==='⌫')dial(ui.digits.slice(0,-1));else if(ui.digits.length<5)dial(ui.digits+key);};
  $('hs-pad').append(b);
 }
 $('hs-clear').onclick=()=>{haptic(6);if(ui.digits)dial('');};
 function reserve(next){
  if(!ui.digits){toast('번호를 먼저 누르세요 · Dial a number first');return;}
  haptic([10,40,10]);send({action:'reserve',number:Number(ui.digits),...(next?{next:true}:{})});toast(`${ui.digits} ${next?'우선예약':'예약'}`);ui.digits='';showLcd();
 }
 $('hs-reserve').onclick=()=>reserve(false);$('hs-first').onclick=()=>reserve(true);
 $('hs-play').onclick=()=>{haptic(8);send({action:state?.playing?'pause':'play'});};
 $('hs-skip').onclick=()=>{haptic(12);send({action:'skip'});};
 $('hs-guide').onclick=()=>{haptic(6);send({action:'guide',value:'cycle'});};
 for(const b of document.querySelectorAll('[data-mix]'))b.onclick=()=>{const action=b.dataset.mix,value=Math.round(Math.max(0,Math.min(1,(state?.[action]??0)+Number(b.dataset.step)))*10)/10;haptic(6);send({action,value});};
 const meter=(node,value)=>node.replaceChildren(...Array.from({length:5},(_,i)=>el('i',undefined,i<Math.round((value??0)*5)?'on':'')));
 function showHandset(){if(!state)return;const c=!!state.current;$('hs-play').disabled=$('hs-skip').disabled=!c;$('hs-play').classList.toggle('paused',!state.playing);$('hs-play').querySelector('span').textContent=state.playing?'일시정지':'재생';meter($('hs-music'),state.music);meter($('hs-vocal'),state.vocal);}
 // The songbook: 신곡, the existing Recent list (최근), then every song A–Z by its title's first sound.
 let songs=[];
 const INITIALS='가가나다다라마바바사사아자자차카타파하';  // the 19 leading consonants, doubled ones folded
 function initial(title){const t=title.trim(),c=t.codePointAt(0)??0;if(c>=0xAC00&&c<=0xD7A3)return INITIALS[Math.floor((c-0xAC00)/588)];const ch=(t[0]??'').toUpperCase();return /[A-Z]/.test(ch)?ch:'#';}
 const group=title=>{const i=initial(title);return i==='#'?'etc':/[A-Z]/.test(i)?'en':'ko';};
 function bookRow(song){
  const b=el('button',undefined,'result book-row'),t=el('span',song.title,'t');t.append(el('span',song.artist,'a'));
  b.dataset.find=`${song.number} ${song.title} ${song.artist}`.toLowerCase();b.dataset.initial=initial(song.title);
  b.append(el('b',String(song.number),'n'),t,el('span',clock(song.duration),'d'));
  b.onclick=()=>{if(b.dataset.dragged){delete b.dataset.dragged;return;}if(b.parentElement?.classList.contains('open'))return;haptic([10,40,10]);send({action:'reserve',number:song.number});toast(`${song.number} 예약 · ${song.title}`);};
  return swipeable(b,song);
 }
 function section(title,en,rows){const box=el('div',undefined,'book-sect'),h=el('h3',`${title} `);h.append(el('small',en));box.append(h,...rows);return box;}
 function showBook(){
  $('book-count').textContent=`SONGBOOK · ${songs.length}곡`;
  const fresh=newSongs(songs);$('book-new').replaceChildren(...(fresh.length?[section('신곡','NEW',fresh.map(bookRow))]:[]));
  const sorted=[...songs].sort((a,b)=>a.title.localeCompare(b.title,'ko'));
  $('book-all').replaceChildren(...[['ko','가나다','KOREAN A–Z'],['en','ABC','ENGLISH A–Z'],['etc','기타','OTHER']].map(([key,title,en])=>{const rows=sorted.filter(s=>group(s.title)===key);return rows.length?section(title,en,rows.map(bookRow)):null;}).filter(Boolean));
  if(!songs.length)$('book-all').append(emptyNote('0곡','노래책이 비어 있어요','Songs join the book with a number once they have been downloaded. Search above to add one.'));
  showIndex();filterBook();
 }
 // Binder tabs down the right edge jump to a section or a first letter; 최근 joins when the recent rows arrive, which may be after the book.
 new MutationObserver(showIndex).observe($('recent'),{childList:true});
 function showIndex(){
  const tabs=[],add=(label,target)=>{const b=el('button',label);b.onclick=()=>{haptic(4);target.scrollIntoView({behavior:'smooth',block:'start'});};tabs.push(b);};
  if($('book-new').firstChild)add('신곡',$('book-new'));
  if($('recent').querySelector('.swipe'))add('최근',$('recent-heading'));
  const seen=new Set();for(const row of $('book-all').querySelectorAll('.book-row')){const i=row.dataset.initial;if(!seen.has(i)){seen.add(i);add(i,row.closest('.swipe'));}}
  $('book-index').replaceChildren(...tabs);placeIndex();
 }
 // The tabs start under the (sticky) search bar, so they never cover the LCD window or the search.
 function placeIndex(){if(tab()==='book')$('book-index').style.top=`${Math.round($('search-form').getBoundingClientRect().bottom+12)}px`;}
 addEventListener('scroll',placeIndex,{passive:true});addEventListener('resize',placeIndex);
 // Typing in the search box narrows the book (title, artist or number); Search still asks YouTube.
 function filterBook(){
  const q=document.body.dataset.theme==='classic'?$('query').value.trim().toLowerCase():'';  // Default keeps its lists whole
  for(const wrap of document.querySelectorAll('#book-new .swipe,#book-all .swipe,#recent .swipe')){const row=wrap.querySelector('.result');wrap.hidden=!!q&&!(row.dataset.find??row.textContent.toLowerCase()).includes(q);}
  for(const sect of document.querySelectorAll('.book-sect'))sect.hidden=![...sect.querySelectorAll('.swipe')].some(w=>!w.hidden);
  $('recent-heading').hidden=!!q&&!document.querySelector('#recent .swipe:not([hidden])');
  $('book-index').hidden=!!q;  // the binder tabs jump around the whole book, not a search
 }
 $('query').addEventListener('input',filterBook);$('clear').addEventListener('click',filterBook);
 $('book-request-go').onclick=()=>{scrollTo({top:0,behavior:'smooth'});$('query').focus();};
 async function loadBook(){try{songs=await api('/api/songbook');}catch{return;}showBook();}
 loadBook();
 // 설정's mix keys step the sliders by 10%, as the sliders themselves would.
 for(const b of document.querySelectorAll('[data-mix-step]'))b.onclick=()=>{const range=$(b.dataset.mixStep);range.value=Math.round(Math.max(0,Math.min(1,Number(range.value)+Number(b.dataset.step)))*10)/10;range.dispatchEvent(new Event('input',{bubbles:true}));haptic(6);};
 const self={ui,setTab,showLcd,loadBook,render(next){const flipped=next.theme!==state?.theme;state=next;syncSheet();showLcd();showHandset();if(flipped)filterBook();},get state(){return state;}};
 setTab(tab());
 return self;
}

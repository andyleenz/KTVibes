import {$, el, prepLabel, thumbnail, REDUCED} from './shared.js';
import {requesterBadge} from './requester.js';

export function createRemoteQueue({getState, setState, send, toast, haptic, swipes, pickLyrics, openSongbook}) {
 const SPRING = 'cubic-bezier(.38,1.21,.22,1)';
 let queueShape,dragging=null,swipingQueue=null;
 const QUEUE_PAGE_SIZE=10;
 let queueVisibleCount=QUEUE_PAGE_SIZE;
 const RING=2*(49+49-4*14.5)+2*Math.PI*14.5;
 const RING_SEGMENT=RING*.22,RING_GAP=RING-RING_SEGMENT;
 const statusText=item=>item.status==='ready'?'Ready':item.status==='error'?'Failed':prepLabel(item).text;
 const queueRenderShape=()=>JSON.stringify([!!getState().current,...getState().upcoming.map(i=>[i.key,i.title,i.artist,i.status,i.error,i.requester])]);
 // Classic shows the machine's Korean status beside it.
 const STATUS_KO={queued:'대기 중',downloading:'다운로드 중',separating:'보컬 분리 중',searching_synced_lyrics:'싱크 가사 검색 중',aligning_lyrics:'가사 싱크 조정 중',ready:'준비 완료',error:'준비 실패'};
 const statusKo=(item,index)=>index===0&&item.status==='ready'?'다음곡':STATUS_KO[item.status]||'';
 function showQueue(before){
  const count=getState().upcoming.length;$('queue-count').textContent=$('dock-count').textContent=count;
  queueVisibleCount=Math.max(QUEUE_PAGE_SIZE,Math.min(queueVisibleCount,count||QUEUE_PAGE_SIZE));
  $('queue-collapse').hidden=queueVisibleCount<=QUEUE_PAGE_SIZE||count<=QUEUE_PAGE_SIZE;
  $('queue-collapse').setAttribute('aria-expanded',String(queueVisibleCount>QUEUE_PAGE_SIZE));
  const remaining=Math.max(0,count-queueVisibleCount),showCount=Math.min(QUEUE_PAGE_SIZE,remaining);
  $('queue-more').hidden=remaining===0;
  $('queue-more').textContent=`Show ${showCount} more · ${remaining} remaining`;
  if(before&&count>before.upcoming.length&&!REDUCED.matches)for(const id of ['queue-count','dock-count']){const c=$(id);c.classList.remove('bump');void c.offsetWidth;c.classList.add('bump');}
  const shape=queueRenderShape();  // lyrics-source updates are patched into their button without rebuilding rows
  if(shape!==queueShape&&!dragging&&!swipingQueue){
   if(swipes.current?.classList.contains('queue-swipe'))swipes.close();
   // A song that turns ready while queued flashes its ring once.
   const preparing=new Set(before?.upcoming.filter(i=>i.status!=='ready').map(i=>i.key));
   // FLIP: remember where each row was, rebuild, then animate rows from their old spots.
   const tops=new Map([...$('queue').children].filter(row=>row.dataset.key).map(row=>[row.dataset.key,row.getBoundingClientRect().top]));
   queueShape=shape;
   $('queue').replaceChildren(...getState().upcoming.slice(0,queueVisibleCount).map((item,index)=>queueRow(item,index,preparing.has(item.key))));
   if(!count)$('queue').append(emptyQueue());
   if(tops.size&&!REDUCED.matches)for(const row of $('queue').children){
    if(!row.dataset.key)continue;
    const was=tops.get(row.dataset.key),top=row.getBoundingClientRect().top;
    if(was===undefined)row.animate([{opacity:0,transform:'translateY(-12px) scale(.96)'},{opacity:1,transform:'none'}],{duration:450,easing:SPRING});
    else if(Math.abs(was-top)>1)row.animate([{transform:`translateY(${was-top}px)`},{transform:'none'}],{duration:500,easing:SPRING});
   }
  }
  for(const [index,item] of getState().upcoming.entries()){
   const row=$('queue').querySelector(`.queue-swipe[data-key="${item.key}"]`);if(!row)continue;
   row.querySelector('.status').textContent=statusText(item);row.querySelector('.status-ko').textContent=statusKo(item,index);row.querySelector('.prepbar')?.style.setProperty('--p',item.progress||0);
   setQueueLyricsButton(row.querySelector('.lyrics-button'),item);
   const ring=row.querySelector('.ring');if(ring){ring.style.setProperty('--p',item.progress||0);ring.classList.toggle('busy',!item.progress&&item.status!=='ready');}
  }
 }
 $('queue-more').onclick=()=>{queueVisibleCount=Math.min(getState().upcoming.length,queueVisibleCount+QUEUE_PAGE_SIZE);queueShape=null;showQueue(getState());};
 $('queue-collapse').onclick=()=>{queueVisibleCount=QUEUE_PAGE_SIZE;queueShape=null;showQueue(getState());$('queue-heading').scrollIntoView({block:'start',behavior:REDUCED.matches?'auto':'smooth'});};
 // An empty queue invites the next song, with a button straight to the search box.
 function emptyQueue(){
  const box=el('div',undefined,'empty'),icon=el('span',undefined,'empty-icon'),find=el('button','Find a song','empty-action');
  icon.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/></svg>';
  find.onclick=()=>{if(document.body.dataset.theme==='classic')openSongbook();$('search-form').scrollIntoView({behavior:REDUCED.matches?'auto':'smooth',block:'center'});$('query').focus({preventScroll:true});};
  const lcd=el('span','00',`lcd classic-only${getState().current?'':' dim'}`);lcd.dataset.ghost='88';
  box.append(lcd,icon,el('b','예약곡이 없어요','classic-only'),el('strong',getState().current?'Nothing up next':'The queue is empty'),el('small',getState().current?'Add a song and it plays when this one ends.':'Add a song and it starts right away.'),find);
  return box;
 }
 const QUEUE_LYRICS_LABELS={processing:['Checking…','processing'],synced:['Synced','synced'],plain:['Plain','plain'],missing:['No lyrics','missing'],error:['Issue','error'],unknown:['Check lyrics','unknown']};
 function queueLyricsState(item){
  const source=item.viewer_lyrics_source;
  if(source&&source!=='unknown')return source;
  if(item.lyrics_status==='processing')return 'processing';
  if(item.lyrics_status==='ready')return 'synced';
  if(item.lyrics_status==='error')return 'error';
  return 'unknown';
 }
 function setQueueLyricsButton(button,item){
  if(!button)return;
  const source=queueLyricsState(item),[label]=QUEUE_LYRICS_LABELS[source]||QUEUE_LYRICS_LABELS.unknown;
  button.textContent=label;button.dataset.lyricsSource=source;
  button.setAttribute('aria-label',`${label} lyrics for ${item.title}. Open lyrics viewer and settings.`);
 }
 function queueRow(item,index,justReady){
  const wrap=el('div',undefined,'swipe queue-swipe');wrap.dataset.key=item.key;
  const next=el('button','Next','queue-swipe-action queue-next');next.type='button';next.setAttribute('aria-label',`Move ${item.title} to play next`);next.onclick=()=>prioritizeQueueItem(item.key);
  const remove=el('button','Remove','queue-swipe-action queue-remove');remove.type='button';remove.setAttribute('aria-label',`Remove ${item.title} from the queue`);
  // Handle a touch tap on the action itself, independent of the row gesture and
  // the browser's later compatibility click. Moving or scrolling cancels the tap.
  let removeTouch=null,removePointerType='';
  remove.addEventListener('pointerdown',e=>{
   removePointerType=e.pointerType;
   if((e.pointerType==='touch'||e.pointerType==='pen')&&e.isPrimary&&wrap.classList.contains('open'))removeTouch={id:e.pointerId,x:e.clientX,y:e.clientY};
  });
  remove.addEventListener('pointermove',e=>{if(removeTouch?.id===e.pointerId&&Math.hypot(e.clientX-removeTouch.x,e.clientY-removeTouch.y)>8)removeTouch=null;});
  remove.addEventListener('pointercancel',()=>{removeTouch=null;});
  remove.addEventListener('pointerup',e=>{
   const tap=removeTouch;removeTouch=null;if(!tap||tap.id!==e.pointerId||!wrap.classList.contains('open'))return;
   const bounds=remove.getBoundingClientRect();
   if(Math.hypot(e.clientX-tap.x,e.clientY-tap.y)>8||e.clientX<bounds.left||e.clientX>bounds.right||e.clientY<bounds.top||e.clientY>bounds.bottom)return;
   e.preventDefault();e.stopPropagation();removeQueueItem(item);
  });
  remove.onclick=e=>{if(e.detail>0&&(removePointerType==='touch'||removePointerType==='pen'))return;removeQueueItem(item);};
  const row=el('article',undefined,`row ${item.status}`);
  const thumb=el('div',undefined,'thumb'),image=el('img',undefined,'art');image.src=thumbnail(item.id);image.alt='';image.draggable=false;thumb.append(image);
  // The ring shows while the song prepares, and once more as it turns ready.
  if(item.status!=='ready'&&item.status!=='error'||justReady&&item.status==='ready')thumb.insertAdjacentHTML('beforeend',`<svg class="ring" viewBox="0 0 52 52" style="--c:${RING};--segment:${RING_SEGMENT};--gap:${RING_GAP};--travel:${-RING}" aria-hidden="true"><path class="track" d="M26 1.5H36A14.5 14.5 0 0 1 50.5 16V36A14.5 14.5 0 0 1 36 50.5H16A14.5 14.5 0 0 1 1.5 36V16A14.5 14.5 0 0 1 16 1.5H26Z"/><path class="fill" d="M26 1.5H36A14.5 14.5 0 0 1 50.5 16V36A14.5 14.5 0 0 1 36 50.5H16A14.5 14.5 0 0 1 1.5 36V16A14.5 14.5 0 0 1 16 1.5H26Z"/></svg>`);
  if(justReady&&item.status==='ready')haptic(10);
  const info=el('div',undefined,'info'),line=el('p');if(item.number)line.append(el('span',String(item.number),'qnum classic-only'),' ');line.append(item.artist,...(justReady&&item.status==='ready'?[el('em','준비 완료','ready-lamp classic-only')]:[]),el('span',' · ','sep'),el('span',statusKo(item,index),'status-ko classic-only'),el('span',statusText(item),'status'));
  info.append(el('h3',item.title),line);
  info.append(requesterBadge(item));
  if(item.status!=='ready'&&item.status!=='error'){const bar=el('div',undefined,'prepbar classic-only');bar.append(el('i'));info.append(bar);}
  if(item.error){const retry=el('button','Retry','retry');retry.onclick=()=>send({action:'retry',key:item.key});info.append(el('p',item.error,'error'),retry);}
  // Classic: 우선 moves a song to sing next, as on the machine.
  const first=el('button','우선','row-button first classic-only');first.setAttribute('aria-label',`Play ${item.title} next`);first.hidden=index===0;
  first.onclick=()=>{haptic(8);move(index,0);toast(`${item.title} 우선예약`);};
  const lyricsButton=el('button',undefined,'row-button lyrics-button');setQueueLyricsButton(lyricsButton,item);lyricsButton.onclick=()=>pickLyrics(item);
  const num=el('span',String(index+1),'num');num.tabIndex=0;num.setAttribute('role','group');num.setAttribute('aria-label',`Position ${index+1}. Focus and use the up or down arrow keys to reorder.`);
  num.onkeydown=e=>{const to=index+({ArrowUp:-1,ArrowDown:1}[e.key]||0);if(to!==index&&to>=0&&to<getState().upcoming.length){e.preventDefault();move(index,to);}};
  row.append(num,thumb,info,lyricsButton,first);
  wrap.append(next,remove,row);
  queueSwipeHandlers(wrap,row,item.key);
  dragHandlers(wrap,row);
  return wrap;
 }
 function move(from,to){const keys=getState().upcoming.map(i=>i.key);keys.splice(to,0,...keys.splice(from,1));send({action:'reorder',keys});}
 function prioritizeQueueItem(key){
  const index=getState().upcoming.findIndex(item=>item.key===key);if(index<=0)return;
  haptic(10);move(index,0);toast('Moved to next');
 }
 function removeQueueItem(item){
  const wrap=$(`.queue-swipe[data-key="${item.key}"]`);if(swipes.current===wrap)swipes.close();
  send({action:'remove',key:item.key});toast(`Removed ${item.title}`,{label:'Undo',run:()=>send({action:'undo'})});
 }
 // Long-press a non-button part of a row for 350 ms to drag it to any position.
 document.addEventListener('touchmove',e=>{if(dragging)e.preventDefault();},{passive:false});
 function dragHandlers(wrap,row){
  let press,startX,startY;
  row.addEventListener('contextmenu',e=>e.preventDefault());
  row.addEventListener('pointerdown',e=>{
   if(e.target.closest('button'))return;
   startX=e.clientX;startY=e.clientY;press=setTimeout(()=>startDrag(wrap,e),350);
  });
  const cancel=e=>{if(e.type!=='pointermove'||Math.hypot(e.clientX-startX,e.clientY-startY)>8)clearTimeout(press);};
  for(const type of ['pointermove','pointerup','pointercancel'])row.addEventListener(type,cancel);
 }
 function queueSwipeHandlers(wrap,row,key){
  let start=null,dx=0,base=0,swiping=false;
  wrap.addEventListener('pointerdown',e=>{
   if(e.target.closest('button')||(e.pointerType==='mouse'&&e.button!==0))return;
   start={x:e.clientX,y:e.clientY};base=wrap.classList.contains('open')?-swipes.distance:0;dx=base;swiping=false;
  });
  wrap.addEventListener('pointermove',e=>{
   if(!start||dragging)return;
   const mx=e.clientX-start.x,my=e.clientY-start.y;
   if(!swiping){if(Math.abs(my)>8&&Math.abs(my)>Math.abs(mx)){start=null;return;}if(Math.abs(mx)<8)return;swiping=true;swipingQueue=wrap;wrap.setPointerCapture(e.pointerId);wrap.classList.add('dragging');if(swipes.current&&swipes.current!==wrap)swipes.close();}
   dx=Math.max(-swipes.distance*1.25,Math.min(swipes.distance*1.25,base+mx));row.style.transform=`translateX(${dx}px)`;
  });
  const end=()=>{
   if(!start)return;start=null;wrap.classList.remove('dragging');if(!swiping){if(base<0)swipes.close();finishQueueSwipe();return;}
   row.dataset.swiped='1';
   if(base<0){
    if(dx>-swipes.distance/2){wrap.classList.remove('open');row.style.transform='';if(swipes.current===wrap)swipes.current=null;}
    else{wrap.classList.add('open');row.style.transform=`translateX(${-swipes.distance}px)`;swipes.current=wrap;}
   }else if(dx<-swipes.distance/2){row.style.transform=`translateX(${-swipes.distance}px)`;wrap.classList.add('open');swipes.current=wrap;}
   else if(dx>swipes.distance/2){row.style.transform='';prioritizeQueueItem(key);}
   else row.style.transform='';
   finishQueueSwipe();
  };
  const cancel=()=>{if(!start)return;start=null;wrap.classList.remove('dragging');row.style.transform=base<0?`translateX(${-swipes.distance}px)`:'';finishQueueSwipe();};
  wrap.addEventListener('pointerup',end);wrap.addEventListener('pointercancel',cancel);
 }
 function finishQueueSwipe(){swipingQueue=null;if(!dragging&&queueShape!==queueRenderShape()){queueShape=null;showQueue(getState());}}
 function startDrag(row,e){
  if(dragging)return;
  if(row.classList.contains('queue-swipe')&&swipes.current===row)swipes.close();
  if(e.pointerType==='touch'||e.pointerType==='pen'){try{row.setPointerCapture(e.pointerId);}catch{}}
  const rows=[...$('queue').children].filter(r=>r.dataset.key),from=rows.indexOf(row),boxes=rows.map(r=>r.getBoundingClientRect());
  dragging={row,from,to:from,y:e.clientY,rows,keys:rows.map(r=>r.dataset.key),allKeys:getState().upcoming.map(item=>item.key),boxes,height:boxes[from].height};
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
    const liveKeys=getState().upcoming.map(item=>item.key);
    if(liveKeys.length!==d.allKeys.length||liveKeys.some((key,index)=>key!==d.allKeys[index])){queueShape=null;showQueue(getState());toast('Queue changed while dragging. Please try again.',undefined,'err');return;}
    const order=[...d.keys];order.splice(d.to,0,...order.splice(d.from,1));
    // Only the visible prefix is draggable; keep every undisplayed song in its original order after it.
    const visible=new Set(d.keys),completeOrder=[...order,...d.allKeys.filter(key=>!visible.has(key))];
    const currentItems=new Map(getState().upcoming.map(item=>[item.key,item]));
    if(completeOrder.length!==currentItems.size||completeOrder.some(key=>!currentItems.has(key))){queueShape=null;showQueue(getState());toast('Queue changed while dragging. Please try again.',undefined,'err');return;}
    setState({...getState(),upcoming:completeOrder.map(key=>currentItems.get(key))});queueShape=null;
    send({action:'reorder',keys:completeOrder});
   }else queueShape=null;
   showQueue(getState());
  };
 }

 return {render: showQueue};
}

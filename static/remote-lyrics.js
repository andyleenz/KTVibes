import {el, api} from './shared.js';

export function createLyricsPanel({getState, toast}) {
 let openLyricsDialog;
 function lyricsSearchTerms(artist,title){
  const terms=[],seen=new Set(),add=(value,selected=false)=>{value=String(value||'').trim();const key=value.normalize('NFKC').toLocaleLowerCase();if(value&&value.length<=100&&!seen.has(key)){seen.add(key);terms.push({value,selected});}};
  const quoted=/[「『【“"]([^」』】”"]+)[」』】”"]/gu,quotedValues=[...String(title||'').matchAll(quoted)].map(match=>match[1].trim());
  add(artist,true);quotedValues.forEach((value,index)=>add(value,index===0));
  if(!quotedValues.length)add(title,true);
  for(const part of String(title||'').split(/\s*[×x]\s*|\s*[|｜]\s*|\s+[—–-]\s+/u)){
   const remainder=part.replace(quoted,' ').replace(/[「」『』【】“”"]/gu,' ').replace(/\s+/g,' ').trim();
   if(!remainder||remainder.normalize('NFKC').toLocaleLowerCase()===String(artist||'').trim().normalize('NFKC').toLocaleLowerCase())continue;
   add(remainder);for(const word of remainder.split(/\s+/u))if(word.length>1)add(word);
  }
  return terms.slice(0,10);
 }

 // Shared two-tab reader/picker. The reader uses raw cached LRC/plain text, never TV timing data.
 async function pickLyrics(song,{followCurrent=false}={}){
  if(openLyricsDialog)openLyricsDialog.close();
  let targetKey=song.key||null,follow=followCurrent,closed=false,viewToken=0,searchToken=0,searchLoaded=false,lastText=null,lastTextKey=null;
  const sheet=el('div',undefined,'lyric-sheet'),panel=el('div',undefined,'lyric-sheet-panel'),grip=el('button',undefined,'lyric-sheet-grip');grip.type='button';grip.setAttribute('aria-label','Close Lyrics panel');
  const tabs=el('div',undefined,'lyric-tabs'),viewTab=el('button','View'),chooseTab=el('button','Select Lyrics');viewTab.type=chooseTab.type='button';
  const viewPane=el('section',undefined,'lyric-view-pane'),viewStatus=el('p','Loading lyrics…','lyric-view-status'),reader=el('pre',undefined,'lyric-reader');
  const viewControls=el('div',undefined,'lyric-view-controls');
  const fontControls=el('div',undefined,'lyric-font-controls'),smaller=el('button','A−'),larger=el('button','A+');smaller.type=larger.type='button';smaller.setAttribute('aria-label','Decrease lyrics font size');larger.setAttribute('aria-label','Increase lyrics font size');
  let fontSize=17;try{fontSize=Math.max(13,Math.min(30,Number(localStorage.getItem('ktvibes-lyrics-font-size'))||17));}catch{}
  const setFont=()=>reader.style.fontSize=`${fontSize}px`;setFont();
  const choosePane=el('section',undefined,'lyric-choose-pane'),chooseStatus=el('p',undefined,'lyric-choose-status muted'),form=el('form',undefined,'lyric-search'),input=el('input'),go=el('button','Search'),termPicker=el('div',undefined,'lyric-search-terms'),preview=el('div',undefined,'lyric-preview'),list=el('div',undefined,'lyric-options'),chooseActions=el('div',undefined,'lyric-choose-actions'),unavailable=el('button','No suitable lyrics','lyric-unavailable');
  unavailable.type='button';chooseActions.append(unavailable);
  input.type='search';input.placeholder='Artist, title, or search terms';input.setAttribute('aria-label','Search lyrics');go.type='submit';form.append(input,go);
  let searchTerms=[],searchCooldownTimer=null;
  const syncSearchTermButtons=()=>{const query=input.value.toLocaleLowerCase();for(const button of termPicker.querySelectorAll('button')){const value=button.dataset.term,key=value.toLocaleLowerCase(),active=query.includes(key);button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));}};
  const setSearchTermTarget=target=>{
   searchTerms=lyricsSearchTerms(target?.artist,target?.title);termPicker.replaceChildren();
   if(!searchTerms.length){termPicker.hidden=true;input.value=`${target?.artist||''} ${target?.title||''}`.trim();return;}
   termPicker.hidden=false;
   for(const term of searchTerms){const chip=el('button',term.value,'lyric-search-term');chip.type='button';chip.dataset.term=term.value;chip.setAttribute('aria-pressed','false');chip.onclick=()=>{
     const query=input.value,needle=term.value,lower=query.toLocaleLowerCase(),key=needle.toLocaleLowerCase(),at=lower.indexOf(key);
     if(at>=0){input.value=`${query.slice(0,at)} ${query.slice(at+needle.length)}`.replace(/\s+/g,' ').trim();}
     else input.value=[query.trim(),needle].filter(Boolean).join(' ');
     syncSearchTermButtons();
    };termPicker.append(chip);}
   input.value=searchTerms.filter(term=>term.selected).map(term=>term.value).join(' ');syncSearchTermButtons();
  };
  setSearchTermTarget(song);input.addEventListener('input',syncSearchTermButtons);
  fontControls.append(smaller,larger);viewControls.append(fontControls);viewPane.append(viewControls,viewStatus,reader);
  tabs.append(viewTab,chooseTab);panel.append(grip,tabs,viewPane,choosePane);sheet.append(panel);document.body.append(sheet);
  const shut=()=>{if(closed)return;closed=true;viewToken++;searchToken++;clearTimeout(searchCooldownTimer);sheet.classList.add('out');sheet.addEventListener('animationend',()=>sheet.remove(),{once:true});if(openLyricsDialog?.sheet===sheet)openLyricsDialog=null;};
  let gripStart=null,gripMoved=false;
  grip.onclick=()=>{if(gripMoved){gripMoved=false;return;}shut();};
  grip.onpointerdown=e=>{if(e.pointerType==='mouse'&&e.button!==0)return;e.preventDefault();gripStart=e.clientY;gripMoved=false;panel.style.transition='none';grip.setPointerCapture(e.pointerId);};
  grip.onpointermove=e=>{if(gripStart===null)return;const distance=Math.max(0,e.clientY-gripStart);if(distance>8)gripMoved=true;panel.style.transform=`translateY(${distance}px)`;};
  grip.onpointerup=e=>{if(gripStart===null)return;const distance=e.clientY-gripStart;gripStart=null;panel.style.transition='';panel.style.transform='';if(distance>100)shut();};
  grip.onpointercancel=()=>{gripStart=null;panel.style.transition='';panel.style.transform='';};
  sheet.onclick=e=>{if(e.target===sheet)shut();};
  const setTab=tab=>{const viewing=tab==='view';viewPane.hidden=!viewing;choosePane.hidden=viewing;viewTab.classList.toggle('active',viewing);chooseTab.classList.toggle('active',!viewing);viewTab.setAttribute('aria-selected',String(viewing));chooseTab.setAttribute('aria-selected',String(!viewing));if(!viewing&&!searchLoaded){searchLoaded=true;show(input.value.trim());}};
  viewTab.onclick=()=>setTab('view');chooseTab.onclick=()=>setTab('choose');setTab('view');
  const liveTarget=()=>targetKey?(getState()?.current?.key===targetKey?getState().current:getState()?.upcoming?.find(item=>item.key===targetKey)):null;
  const pickerTarget=()=>liveTarget()||(!targetKey&&!follow?song:null);
  const eligibleQueue=()=>getState()?.upcoming?.find(item=>item.key===targetKey&&item.status==='ready');
  const isCurrent=()=>!!(getState()?.current&&targetKey&&getState().current.key===targetKey);
  function refreshControls(){const pending=getState()?.upcoming?.find(item=>item.key===targetKey),current=isCurrent(),editable=!!(eligibleQueue()||current||pending||(!targetKey&&!follow&&song.id));form.hidden=!editable;const preparing=!!(pending&&pending.status!=='ready');chooseStatus.textContent=preparing?'Plain lyrics can be saved while this song prepares. Synced selection is available when ready.':'';chooseStatus.hidden=!preparing;}
  async function loadView(){
   const key=targetKey,mine=++viewToken;if(!key){viewStatus.textContent='Open Lyrics from the current song or a queued song to read lyrics.';reader.textContent='';return;}
   const target=liveTarget();if(!target){viewStatus.textContent=reader.textContent?'Song is no longer in the queue.':'Song is no longer available.';return;}
   viewStatus.textContent='Loading lyrics…';
   try{
    const data=await api(`/api/lyrics/view/${encodeURIComponent(key)}`);if(closed||mine!==viewToken||key!==targetKey)return;
    if(!liveTarget()){viewStatus.textContent=reader.textContent?'Song is no longer in the queue.':'Song is no longer available.';return;}
    if(data.status==='ready'){
     const text=String(data.text||'');const changed=lastTextKey!==key||lastText!==text;
     if(changed){reader.textContent=text;if(lastTextKey!==key||lastText!==text)reader.scrollTop=0;lastText=text;lastTextKey=key;}
     viewStatus.textContent=data.source==='plain'?'Plain lyrics':'Synced lyrics';
    }else if(data.status==='missing'){if(!reader.textContent)viewStatus.textContent='No lyrics found. Try Select Lyrics to search.';else viewStatus.textContent='Could not refresh lyrics; showing the previous text.';}
    else{if(!reader.textContent)viewStatus.textContent='Could not load lyrics. Check your connection and try again.';else viewStatus.textContent='Connection issue; showing the previous text.';}
   }catch(error){if(closed||mine!==viewToken||key!==targetKey)return;if(!reader.textContent)viewStatus.textContent=`Could not load lyrics: ${error.message}`;else viewStatus.textContent='Connection issue; showing the previous text.';}
  }
  smaller.onclick=()=>{fontSize=Math.max(13,fontSize-1);setFont();try{localStorage.setItem('ktvibes-lyrics-font-size',fontSize);}catch{}};
  larger.onclick=()=>{fontSize=Math.min(30,fontSize+1);setFont();try{localStorage.setItem('ktvibes-lyrics-font-size',fontSize);}catch{}};
  async function loadPreview(){const item=eligibleQueue();if(!item)return;try{const data=await api(`/api/queue/${encodeURIComponent(targetKey)}/lyrics`);if(closed||!eligibleQueue())return;preview.replaceChildren(...(data.lyrics||[]).map(line=>el('p',line.text||'')));}catch(error){preview.replaceChildren(el('p',error.message,'error'));}}
  form.onsubmit=e=>{e.preventDefault();input.blur();show(input.value.trim());};
  async function show(query){
   if(go.disabled)return;
   chooseActions.hidden=true;
   const mine=++searchToken,target=pickerTarget(),searchedKey=targetKey;if(!target||!(eligibleQueue()||isCurrent()||getState()?.upcoming?.some(item=>item.key===targetKey)||(!targetKey&&!follow&&song.id)))return;
   const wait=el('p',query?'Searching…':'Looking up every version…','muted lyric-wait'),bar=el('span',undefined,'pbar busy classic-only');for(let i=0;i<40;i++){const cell=el('i');cell.style.animationDelay=`${(i*.045).toFixed(3)}s`;bar.append(cell);}wait.append(el('span',query?'검색 중':'모든 가사 버전을 찾는 중','classic-only'),bar);list.replaceChildren(wait);
   try{
    let data;
    if(searchedKey)data=await api(`/api/lyrics/choices/${encodeURIComponent(searchedKey)}?q=${encodeURIComponent(query||`${target.artist} ${target.title}`)}`);
    else{const legacy=await api(`/api/songs/${target.id}/lyrics${query?`?q=${encodeURIComponent(query)}`:''}`);data={synced_active:legacy.some(item=>item.current),results:legacy.map(item=>({id:item.id,track:item.track,artist:item.artist,album:item.album,difference:item.difference,formats:{synced:{available:true,current:item.current,language:item.language,lines:item.lines,preview:item.preview},plain:{available:false,selected:false,active:false,preview:[],lines:0}}}))};}
    if(closed||mine!==searchToken||searchedKey!==targetKey||!pickerTarget())return;
    chooseActions.hidden=!searchedKey;
    unavailable.textContent=data.selection_format==='none'?'Marked as unavailable':'No suitable lyrics';unavailable.disabled=data.selection_format==='none';
    const options=data.results||[];const none=el('p',undefined,'muted lyric-none');none.append(el('b','No suitable lyrics found','classic-only'),query?'Try fewer words, or use the song title in its original script.':'Search LRCLIB for synced or plain lyrics.');list.replaceChildren(...(options.length?[]:[none]));
    for(const o of options){
     const kinds=['synced','plain'].filter(kind=>o.formats[kind].available),selectedSynced=!!o.formats.synced.current,
      selectedPlain=!!(o.formats.plain.selected&&o.formats.plain.active),selected=selectedSynced||selectedPlain,
      track=o.track||'LRCLIB record',trackKey=String(track).trim().toLocaleLowerCase(),
      metadataParts=[o.artist,o.album].filter(Boolean).map(value=>String(value).trim()).filter((value,index,values)=>{const key=value.toLocaleLowerCase();return key!==trackKey&&values.findIndex(item=>item.toLocaleLowerCase()===key)===index;}),
      card=el('article',undefined,'lyric-option'+(selected?' current':'')),top=el('div',undefined,'lyric-card-head');
     top.append(el('b',track));if(metadataParts.length)top.append(el('span',metadataParts.join(' · ')));card.append(top);
     const formats=el('div',undefined,'lyric-formats');for(const kind of kinds)formats.append(el('span',kind==='synced'?'Synced':'Plain','lyric-format'));
     if(o.difference!==null&&o.difference!==undefined&&o.difference!==0)formats.append(el('span',`${Math.abs(o.difference)}s ${o.difference>0?'longer':'shorter'}`,'lyric-format lyric-duration'));
     card.append(formats);
     const block=el('div',undefined,'lyric-card-preview');for(const kind of kinds){const preview=el('div',undefined,'lyric-format-preview');if(kinds.length>1)preview.append(el('span',kind==='synced'?'Synced preview':'Plain preview'));for(const line of o.formats[kind].preview||[])preview.append(el('small',line));block.append(preview);}card.append(block);
     const actions=el('div',undefined,'lyric-card-actions');for(const kind of kinds){const active=kind==='synced'?selectedSynced:selectedPlain,label=active?'Selected':kinds.length>1?`Use ${kind==='synced'?'Synced':'Plain'}`:'Select',select=el('button',label);select.type='button';select.disabled=active||(kind==='synced'&&!!getState()?.upcoming?.some(item=>item.key===targetKey&&item.status!=='ready'));if(!active)select.onclick=()=>saveChoice(select,o,kind,target);actions.append(select);}if(kinds.length)card.append(actions);list.append(card);
    }
   }catch(error){if(mine===searchToken){chooseActions.hidden=true;const isBusy=error.status===503||error.message.includes('LRCLIB is temporarily busy'),isLimited=error.status===429||error.message.includes('LRCLIB is limiting lyric searches'),retryAfter=Math.max(1,Math.min(60,Math.ceil(error.retryAfter||(isLimited?Number(error.message.match(/wait (\d+) seconds/)?.[1])||5:1)))),message=el('p',isBusy?'LRCLIB is temporarily busy. Please wait 1 second, then try again.':isLimited?`LRCLIB is limiting lyric searches. Please wait ${retryAfter} seconds, then try again.`:'Lyrics search failed. Please try again.','error');list.replaceChildren(message);if(isBusy||isLimited){go.disabled=true;clearTimeout(searchCooldownTimer);searchCooldownTimer=setTimeout(()=>{if(!closed&&mine===searchToken)go.disabled=false;},retryAfter*1000);}}}
  }
  async function saveChoice(button,option,kind,target){
   const key=targetKey;if(button.disabled||button.dataset.saving)return;
   const destination=kind==='plain'?(key?`/api/lyrics/plain/${encodeURIComponent(key)}`:null):getState()?.current?.key===key&&key?`/api/songs/${target.id}/lyrics`:eligibleQueue()?`/api/queue/${encodeURIComponent(key)}/lyrics`:!key&&!follow?`/api/songs/${target.id}/lyrics`:null;
   if(!destination){toast('This song is no longer available for lyrics settings.',undefined,'err');return;}
   const buttons=[...list.querySelectorAll('button')];buttons.forEach(item=>item.disabled=true);button.dataset.saving='1';button.classList.add('busy');
   try{
    const result=await api(destination,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:option.id})});
    if(closed||key!==targetKey)return;
    toast(`${kind==='plain'?'Plain':'Synced'} lyrics selected for ${target.title}.`);
    await loadView();searchLoaded=false;if(kind==='synced'||result.source==='plain'||result.source==='synced')setTab('view');
   }catch(error){toast(error.message,undefined,'err');}
   finally{delete button.dataset.saving;button.classList.remove('busy');if(!closed){buttons.forEach(item=>item.disabled=false);refreshControls();}}
  }
  unavailable.onclick=async()=>{
   if(unavailable.disabled||!targetKey)return;
   unavailable.disabled=true;unavailable.classList.add('busy');
   try{
    await api(`/api/lyrics/unavailable/${encodeURIComponent(targetKey)}`,{method:'POST'});
    if(closed)return;
    unavailable.textContent='Marked as unavailable';toast('Marked as no suitable lyrics.');await loadView();
   }catch(error){toast(error.message,undefined,'err');unavailable.disabled=false;}
   finally{unavailable.classList.remove('busy');}
  };
  choosePane.append(chooseStatus,form,termPicker,preview,list,chooseActions);chooseActions.hidden=true;refreshControls();if(eligibleQueue())loadPreview();loadView();
  openLyricsDialog={sheet,close:shut,onState(before,next){
   if(follow&&next?.current?.key!==targetKey){targetKey=next?.current?.key||null;setSearchTermTarget(next?.current);lastText=null;lastTextKey=null;reader.textContent='';loadView();searchLoaded=false;if(!choosePane.hidden){searchLoaded=true;show(input.value.trim());}}
   const oldTarget=targetKey&&(before?.current?.key===targetKey?before.current:before?.upcoming?.find(item=>item.key===targetKey));
   const newTarget=targetKey&&(next?.current?.key===targetKey?next.current:next?.upcoming?.find(item=>item.key===targetKey));
   if(oldTarget&&newTarget&&((oldTarget.lyrics_status!==newTarget.lyrics_status&&newTarget.lyrics_status==='ready')||oldTarget.lyrics_rev!==newTarget.lyrics_rev)){loadView();searchLoaded=false;if(!choosePane.hidden){searchLoaded=true;show(input.value.trim());}}
   const present=targetKey&&(next?.current?.key===targetKey||next?.upcoming?.some(item=>item.key===targetKey));
   if(!follow&&!present)viewStatus.textContent=reader.textContent?'Song is no longer in the queue; showing the lyrics already loaded.':'Song is no longer in the queue.';
   else if(!follow&&present&&before&&!(before.current?.key===targetKey||before.upcoming?.some(item=>item.key===targetKey))){viewStatus.textContent='';loadView();}
   refreshControls();
  }};
 }

 return {
  open: pickLyrics,
  get isOpen() { return !!openLyricsDialog; },
  close() { openLyricsDialog?.close(); },
  onState(before, next) { openLyricsDialog?.onState(before, next); }
 };
}

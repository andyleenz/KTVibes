import {api, REDUCED} from './shared.js';
const KEY='ktvibes.identity', $=id=>document.getElementById(id), url=id=>`/static/avatars/${id}.png`;
const pop=$('identity-pop'), grid=$('identity-grid'), editor=$('identity-form'), nameInput=$('identity-name');
 $('identity-delete-cancel')?.remove();
nameInput.maxLength=12;
$('identity-delete-yes').textContent='Confirm';
let selected=localStorage.getItem(KEY)??'guest', identities=[], avatars=[], managing=false;
let draft=null, deletion=null, chain=Promise.resolve(), drag=null, suppressClickUntil=0;
const json=(method,body)=>({method,headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
function error(message=''){$('identity-error').textContent=message;$('identity-error').hidden=!message;}
function select(id){selected=id||'guest';localStorage.setItem(KEY,selected);}
function action(work){const task=chain.then(work).catch(e=>{error(e.message);show();return false;});chain=task;return task;}
function image(src){const img=document.createElement('img');img.src=src;img.alt='';img.draggable=false;return img;}
function show(){pop.hidden=false;pop.inert=false;pop.setAttribute('aria-hidden','false');requestAnimationFrame(()=>pop.classList.add('open'));$('profile-button').setAttribute('aria-expanded','true');}
function hideEditor(){draft=null;editor.classList.remove('open');editor.inert=true;}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function swapField(from,to,update){
 const active=from&&(from===editor?from.classList.contains('open'):!from.hidden);
 if(active&&!REDUCED.matches){from.classList.add('field-exit');await wait(130);}
 if(from)from.hidden=true;
 update();
 if(to){to.hidden=false;to.classList.remove('field-exit');to.classList.add('field-enter');if(!REDUCED.matches){await wait(20);to.classList.add('field-enter-active');await wait(190);}to.classList.remove('field-enter','field-enter-active');}
}
function deleteBurst(tile,item){
 if(REDUCED.matches){tile.classList.add('deleting-reduced');return wait(180);}
 const img=tile.querySelector('.identity-choice img'),box=img.getBoundingClientRect(),burst=document.createElement('span');
 burst.className='identity-burst';Object.assign(burst.style,{left:`${box.left}px`,top:`${box.top}px`,width:`${box.width}px`,height:`${box.height}px`});
 for(let index=0;index<9;index++){const piece=document.createElement('i');piece.style.setProperty('--piece',index);piece.style.backgroundImage=`url("${url(item.avatar)}")`;piece.style.backgroundPosition=`${index%3*50}% ${Math.floor(index/3)*50}%`;burst.append(piece);}
 document.body.append(burst);tile.classList.add('deleting');
 return new Promise(resolve=>{burst.addEventListener('animationend',()=>{burst.remove();resolve();},{once:true});setTimeout(()=>{burst.remove();resolve();},650);});
}
function mode(value){managing=value;pop.classList.toggle('managing',value);$('identity-pencil').setAttribute('aria-pressed',String(value));}
async function saveDraft(discardEmptyNew=false){
 if(!draft)return true;
 const target=draft, payload={name:target.name.trim(),avatar:target.avatar};
 if(!payload.name){if(!target.id&&discardEmptyNew)return true;throw new Error('Enter a name for this identity.');}
 if(target.saved===JSON.stringify(payload))return true;
 const item=await api(target.id?`/api/identities/${target.id}`:'/api/identities',json(target.id?'PATCH':'POST',payload));
 if(target.id)identities=identities.map(x=>x.id===item.id?item:x);else{identities.push(item);select(item.id);}
 target.id=item.id;target.saved=JSON.stringify(payload);paint();error();return true;
}
export async function identityForQueue(){await chain;if(!await action(()=>saveDraft(true)))throw new Error('Save your identity changes before adding a song.');return selected==='guest'?null:selected;}
export const selectedIdentity=()=>selected==='guest'?null:selected;
function paint(){
 const current=identities.find(x=>x.id===selected);
 const avatar=$('profile-avatar'), nextAvatar=current?url(current.avatar):'/static/favicon-48.png';
 if(avatar.src!==new URL(nextAvatar,location.href).href){avatar.src=nextAvatar;avatar.classList.remove('switching');void avatar.offsetWidth;avatar.classList.add('switching');}
 $('profile-button').setAttribute('aria-label','Identity');
 $('profile-button').removeAttribute('title');
 grid.replaceChildren();
 for(const item of [{id:'guest',name:'Guest'},...identities]){
  const tile=document.createElement('div');tile.className='identity-tile';tile.dataset.id=item.id;
  const b=document.createElement('button');b.type='button';b.className='identity-choice'+(item.id===selected?' active':'');b.setAttribute('aria-pressed',String(item.id===selected));
  b.append(image(item.avatar?url(item.avatar):'/static/favicon-48.png'));
  const label=document.createElement('span');label.textContent=item.name;b.append(label);
  b.onclick=()=>{if(Date.now()<suppressClickUntil)return;b.classList.remove('pressed');void b.offsetWidth;b.classList.add('pressed');setTimeout(()=>b.classList.remove('pressed'),220);action(async()=>{await saveDraft(true);hideEditor();if(managing&&item.id!=='guest')await edit(identities.find(x=>x.id===item.id));else if(!managing)select(item.id);paint();});};
  tile.append(b);
  if(item.id!=='guest'){
   const remove=document.createElement('button');remove.type='button';remove.className='identity-remove';remove.setAttribute('aria-label',`Delete ${item.name}`);remove.textContent='−';
   remove.onclick=()=>action(async()=>{if(draft?.id!==item.id)await saveDraft(true);deletion=item.id;const label=$('identity-delete-label');label.replaceChildren(document.createTextNode('Delete '));const name=document.createElement('em');name.textContent=item.name;label.append(name,document.createTextNode(' ?'));await swapField(editor,$('identity-delete-confirm'),()=>{hideEditor();});$('identity-delete-yes').focus();});
   tile.append(remove);attachDrag(tile,b,item.id);
   b.onkeydown=e=>{if(managing&&e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();action(async()=>{await saveDraft(true);const ids=identities.map(x=>x.id),from=ids.indexOf(item.id),to=from+(e.key==='ArrowLeft'?-1:1);if(to<0||to>=ids.length)return;ids.splice(from,1);ids.splice(to,0,item.id);await persistOrder(ids);grid.querySelector(`[data-id="${item.id}"] .identity-choice`)?.focus();});}};
  }
  grid.append(tile);
 }
const add=document.createElement('button');add.type='button';add.className='identity-add';add.textContent='+';add.setAttribute('aria-label','New identity');add.onclick=()=>action(async()=>{await saveDraft(true);hideEditor();mode(true);await edit();nameInput.focus();});grid.append(add);
}
async function edit(item){
 const deleting=$('identity-delete-confirm');deletion=null;
 draft={id:item?.id??null,name:item?.name??'',avatar:item?.avatar??avatars[0],saved:item?JSON.stringify({name:item.name,avatar:item.avatar}):null};
 nameInput.value=draft.name;const box=$('identity-avatars');box.replaceChildren();
  avatars.forEach((id,index)=>{const b=document.createElement('button');b.type='button';b.className='identity-avatar-choice';b.append(image(url(id)));b.dataset.avatar=id;b.setAttribute('aria-label',`Avatar ${index+1}`);b.onclick=()=>{if(!draft)return;$('identity-delete-confirm').hidden=true;deletion=null;draft.avatar=id;markAvatars();action(async()=>{if(draft?.name.trim())await saveDraft();});};box.append(b);});
 markAvatars();error();editor.inert=false;await swapField(deleting,editor,()=>{editor.classList.add('open');});
}
function markAvatars(){for(const b of $('identity-avatars').children){const active=b.dataset.avatar===draft?.avatar;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));}}
async function reload(){const data=await api('/api/identities');identities=data.identities;avatars=data.avatars;if(selected!=='guest'&&!identities.some(x=>x.id===selected))select('guest');paint();}
async function close(){if(drag)finishDrag(true);await saveDraft(true);hideEditor();mode(false);pop.classList.remove('open');pop.inert=true;pop.setAttribute('aria-hidden','true');$('profile-button').setAttribute('aria-expanded','false');setTimeout(()=>{if(!pop.classList.contains('open'))pop.hidden=true;},340);}
async function openPicker(){if(pop.classList.contains('open'))return;await reload();show();}
let hoverCloseTimer;
let hoverOpenTimer;
const profileWrap=$('profile-button').parentElement;
profileWrap.addEventListener('pointerenter',e=>{if(e.pointerType!=='mouse')return;clearTimeout(hoverCloseTimer);clearTimeout(hoverOpenTimer);hoverOpenTimer=setTimeout(()=>action(openPicker),300);});
profileWrap.addEventListener('pointerleave',e=>{if(e.pointerType!=='mouse')return;clearTimeout(hoverOpenTimer);clearTimeout(hoverCloseTimer);hoverCloseTimer=setTimeout(()=>{if(pop.classList.contains('open'))action(close);},300);});
$('profile-button').onclick=e=>{if(e.pointerType==='mouse'&&pop.classList.contains('open'))return;action(async()=>{if(pop.classList.contains('open'))await close();else await openPicker();});};
$('identity-pencil').onclick=()=>action(async()=>{
 await saveDraft(true);hideEditor();mode(!managing);
 const current=identities.find(item=>item.id===selected);
 if(managing&&current)await edit(current);
 paint();
});
nameInput.oninput=()=>{if(draft)draft.name=nameInput.value;};
nameInput.onblur=()=>{if(draft?.name.trim())action(()=>saveDraft());};
editor.onsubmit=e=>{e.preventDefault();if(!e.isComposing)action(()=>saveDraft());};
$('identity-delete-yes').onclick=()=>action(async()=>{const id=deletion;if(!id)return;const item=identities.find(x=>x.id===id),tile=grid.querySelector(`[data-id="${id}"]`);if(tile&&item)await deleteBurst(tile,item);try{await api(`/api/identities/${id}`,{method:'DELETE'});}catch(error){tile?.classList.remove('deleting','deleting-reduced');throw error;}identities=identities.filter(x=>x.id!==id);if(selected===id)select('guest');deletion=null;$('identity-delete-confirm').hidden=true;paint();$('identity-pencil').focus();});
async function persistOrder(ids){
 try{identities=await api('/api/identities/order',json('PUT',{ids}));paint();}
 catch(e){await reload();throw e;}
}
function layout(ids){
 const before=new Map([...grid.querySelectorAll('.identity-tile')].map(el=>[el.dataset.id,el.getBoundingClientRect()]));
 for(const el of grid.querySelectorAll('.identity-tile'))for(const animation of el.getAnimations())animation.cancel();
 for(const id of ids){const el=grid.querySelector(`[data-id="${id}"]`);if(el)grid.insertBefore(el,grid.querySelector('.identity-add'));}
 if(!REDUCED.matches)for(const el of grid.querySelectorAll('.identity-tile')){const from=before.get(el.dataset.id),to=el.getBoundingClientRect();if(from&&(from.x!==to.x||from.y!==to.y))el.animate([{transform:`translate(${from.x-to.x}px,${from.y-to.y}px)`},{transform:'none'}],{duration:220,easing:'cubic-bezier(.2,0,0,1)'});}
}
function attachDrag(tile,button,id){
 button.oncontextmenu=e=>{if(managing)e.preventDefault();};
 button.onpointerdown=e=>{
  if(!managing||drag||e.button!==0)return;
  const pending={id,pointer:e.pointerId,x:e.clientX,y:e.clientY,tile,button,active:false,ids:identities.map(x=>x.id)};drag=pending;
  pending.timer=setTimeout(()=>{if(drag!==pending)return;action(async()=>{
   await saveDraft(true);if(drag!==pending)return;
   pending.active=true;pending.slot=pending.ids.indexOf(id);
   // Freeze slot geometry before any FLIP animation moves the visible tiles.
   // Hit-testing the animated tiles themselves would repeatedly swap neighbours.
   pending.slots=pending.ids.map(key=>{
    const box=grid.querySelector(`[data-id="${key}"]`).getBoundingClientRect();
    return {x:box.left+box.width/2,y:box.top+box.height/2};
   });
   suppressClickUntil=Infinity;pending.tile=grid.querySelector(`[data-id="${id}"]`);
   pending.button=pending.tile.querySelector('.identity-choice');
   pending.ghost=pending.tile.cloneNode(true);pending.ghost.className='identity-drag-ghost';
   const bounds=pending.tile.getBoundingClientRect();
   Object.assign(pending.ghost.style,{left:`${pending.x-bounds.width/2}px`,top:`${pending.y-bounds.height/2}px`,width:`${bounds.width}px`});
   document.body.append(pending.ghost);pending.tile.classList.add('dragging');pending.button.setPointerCapture(e.pointerId);
  });},350);
 };
}
document.addEventListener('pointermove',e=>{
 const d=drag;if(!d||e.pointerId!==d.pointer)return;
 if(!d.active){if(Math.hypot(e.clientX-d.x,e.clientY-d.y)>8)finishDrag(true);return;}
 e.preventDefault();d.ghost.style.left=`${e.clientX-d.ghost.offsetWidth/2}px`;d.ghost.style.top=`${e.clientY-d.ghost.offsetHeight/2}px`;
 const distances=d.slots.map(slot=>Math.hypot(e.clientX-slot.x,e.clientY-slot.y));
 const target=distances.indexOf(Math.min(...distances));
 // A small dead band prevents jitter at the boundary between two fixed slots.
 if(target===d.slot||distances[target]+6>=distances[d.slot])return;
 d.slot=target;
 const ids=d.ids.filter(id=>id!==d.id);ids.splice(target,0,d.id);
 layout(['guest',...ids]);
},{passive:false});
document.addEventListener('touchmove',e=>{if(drag?.active)e.preventDefault();},{passive:false});
function finishDrag(cancel=false){
 const d=drag;if(!d)return;drag=null;clearTimeout(d.timer);
 if(d.active){suppressClickUntil=Date.now()+400;d.ghost?.remove();d.tile.classList.remove('dragging');if(d.button.hasPointerCapture(d.pointer))d.button.releasePointerCapture(d.pointer);if(cancel)layout(['guest',...d.ids]);else{const ids=[...grid.querySelectorAll('.identity-tile')].map(x=>x.dataset.id).filter(x=>x!=='guest');if(ids.join()!==d.ids.join())action(()=>persistOrder(ids));}}
}
document.addEventListener('pointerup',()=>finishDrag());document.addEventListener('pointercancel',()=>finishDrag(true));
document.addEventListener('pointerdown',e=>{if(pop.classList.contains('open')&&!pop.contains(e.target)&&!$('profile-button').contains(e.target))action(close);});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&pop.classList.contains('open')){if(drag){finishDrag(true);return;}action(async()=>{await close();$('profile-button').focus();});}});
editor.inert=true;pop.inert=true;if(localStorage.getItem(KEY)===null)select('guest');action(reload);

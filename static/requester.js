// Always render the snapshot attached to this queue entry, never the live profile.
export function renderRequester(container, item, compact=false){
 const person=item?.requester, name=typeof person?.name==='string'?person.name:'';
 const avatar=/^avatar-(0[1-9]|10)$/.test(person?.avatar)?person.avatar:null;
 const signature=JSON.stringify([name,avatar,compact]);
 if(container.dataset.requester===signature)return;
 container.dataset.requester=signature;container.classList.add('song-requester');
 container.classList.toggle('compact',compact);container.hidden=!name;container.replaceChildren();
 if(!name){container.removeAttribute('aria-label');container.removeAttribute('title');return;}
 const label=`Requested by ${name}`;
 container.setAttribute('aria-label',label);container.title=label;
 if(compact)container.setAttribute('role','img');else container.removeAttribute('role');
 const image=document.createElement('img');image.alt='';image.src=avatar?`/static/avatars/${avatar}.png`:'/static/favicon-48.png';
 const text=document.createElement('span');text.textContent=name;
 container.append(image);if(!compact)container.append(text);
}
export function requesterBadge(item){const badge=document.createElement('span');renderRequester(badge,item);return badge;}

export const $ = id => document.getElementById(id);
export function el(tag, text, className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; }
// A page left open across a KTVibes update reloads once to pick up the new files.
let build;
function reloadIfUpdated(next){if(!next)return false;if(build===undefined)build=next;if(next===build)return false;location.reload();return true;}
export function connect(role, onState, onError, onOpen) {
  let socket;
  function open(){
    socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?role=${role}`);
    socket.onopen=()=>{$('connection').textContent='Connected';$('connection').classList.add('online');onOpen?.();};
    socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.type==='state'){if(reloadIfUpdated(data.build))return;onState(data);}else onError(data.message);};
    socket.onclose=e=>{$('connection').textContent='Disconnected';$('connection').classList.remove('online');if(e.code!==4001)setTimeout(open,1500);};
  }
  open();
  return message=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));else onError('Reconnecting. Please try again.');};
}
export async function api(path, options){
  const response=await fetch(path,options);let data;
  // A proxy or crash can answer with plain text; report the status rather than a JSON parse error.
  try{data=await response.json();}catch{throw new Error(`Server error (${response.status}). Please try again.`);}
  if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Please check the song details.');return data;
}
export const clock = seconds => `${Math.floor((seconds||0)/60)}:${String(Math.floor((seconds||0)%60)).padStart(2,'0')}`;
// Sliders fire many input events; send at most one every `ms`, always ending on the final value.
export function throttle(fn, ms=120){let last=0,timer;return value=>{clearTimeout(timer);const wait=last+ms-Date.now();if(wait<=0){last=Date.now();fn(value);}else timer=setTimeout(()=>{last=Date.now();fn(value);},wait);};}
// Preparation status, as both screens describe it.
const STEPS={queued:'Waiting to download',downloading:'Downloading',separating:'Separating vocals',syncing:'Finding lyrics',ready:'Ready',error:'Failed'};
export function prepLabel(item){const percent=item.progress?Math.round(item.progress*100):null;return {percent,text:`${STEPS[item.status]||item.status}${item.step?` ${item.step}`:''}${percent==null?'':` · ${percent}%`}`};}
// Sliders paint their own filled track from --v (0–1); call after setting a value in code.
export function syncRanges(){for(const range of document.querySelectorAll('input[type=range]'))range.style.setProperty('--v',(range.value-range.min)/((range.max-range.min)||1));}
document.addEventListener('input',e=>{if(e.target.type==='range')syncRanges();});

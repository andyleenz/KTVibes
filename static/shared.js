export const $ = id => document.getElementById(id);
export function el(tag, text, className) { const node=document.createElement(tag); if(text!==undefined)node.textContent=text; if(className)node.className=className; return node; }
export function connect(role, onState, onError) {
  let socket;
  function open(){
    socket=new WebSocket(`${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws?role=${role}`);
    socket.onopen=()=>{$('connection').textContent='Connected';$('connection').classList.add('online');};
    socket.onmessage=e=>{const data=JSON.parse(e.data);if(data.type==='state')onState(data);else onError(data.message);};
    socket.onclose=e=>{$('connection').textContent='Disconnected';$('connection').classList.remove('online');if(e.code!==4001)setTimeout(open,1500);};
  }
  open();
  return message=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(message));else onError('Reconnecting. Please try again.');};
}
export async function api(path, options){const response=await fetch(path,options);const data=await response.json();if(!response.ok)throw new Error(typeof data.detail==='string'?data.detail:'Please check the song details.');return data;}
export const clock = seconds => `${Math.floor((seconds||0)/60)}:${String(Math.floor((seconds||0)%60)).padStart(2,'0')}`;

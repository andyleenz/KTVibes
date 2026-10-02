// Key change without changing tempo: a granular pitch shifter. Two read heads sweep through a short
// delay line at the pitch ratio and crossfade (sin² windows half a grain apart sum to one).
const GRAIN=0.06;  // seconds; long enough for low voices, short enough to avoid an echo
class PitchShifter extends AudioWorkletProcessor{
 static get parameterDescriptors(){return [{name:'ratio',defaultValue:1,minValue:0.5,maxValue:2,automationRate:'k-rate'}];}
 constructor(){super();this.grain=Math.round(sampleRate*GRAIN);this.size=1<<Math.ceil(Math.log2(this.grain*2+2));this.lines=[];this.write=0;this.phase=0;}
 process(inputs,outputs,parameters){
  const input=inputs[0],output=outputs[0],ratio=parameters.ratio[0],size=this.size,mask=size-1,grain=this.grain;
  while(this.lines.length<output.length)this.lines.push(new Float32Array(size));
  const frames=output[0].length,step=(1-ratio)/grain;
  for(let c=0;c<output.length;c++){
   const source=input[c]||input[0],line=this.lines[c],out=output[c];
   let write=this.write,phase=this.phase;
   for(let i=0;i<frames;i++){
    const sample=source?source[i]:0;line[write]=sample;
    if(ratio===1)out[i]=sample;
    else{
     let sum=0;
     for(const offset of [0,0.5]){
      const p=(phase+offset)%1,read=write-p*grain-1,base=Math.floor(read),frac=read-base;
      const a=line[base&mask],b=line[(base+1)&mask],weight=Math.sin(Math.PI*p);
      sum+=(a+(b-a)*frac)*weight*weight;
     }
     out[i]=sum;
    }
    write=(write+1)&mask;phase=((phase+step)%1+1)%1;
   }
   if(c===output.length-1){this.write=write;this.phase=phase;}
  }
  return true;
 }
}
registerProcessor('pitch-shifter',PitchShifter);

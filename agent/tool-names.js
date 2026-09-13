import {createHash} from 'node:crypto';
const valid=/^[A-Za-z0-9_-]{1,64}$/;
const reserved=new Set(['iaic_finish','iaic_wait','iaic_delegate']);
// Preserve usable names. Only adapt names the wire protocol cannot represent;
// disambiguation is deterministic, never an index into a changing tool list.
export function wireToolNames(tools){
 const originals=tools.map(tool=>tool.name);
 if(originals.some(name=>typeof name!=='string'||!name)||new Set(originals).size!==originals.length)throw new Error('Tool names must be nonempty and unique');
 const bases=originals.map(name=>name.replace(/[^A-Za-z0-9_-]/g,'_').slice(0,64));
 const counts=new Map();for(const name of bases)counts.set(name,(counts.get(name)||0)+1);
 const safe=new Set(originals.filter(name=>valid.test(name)&&!reserved.has(name)));
 const names=originals.map((name,index)=>{
  if(safe.has(name))return name;
  const base=bases[index];
  if(!reserved.has(base)&&!safe.has(base)&&counts.get(base)===1)return base;
  return base.slice(0,47)+'_'+createHash('sha256').update(name).digest('hex').slice(0,16);
 });
 if(names.some(name=>!valid.test(name)||reserved.has(name))||new Set(names).size!==names.length)throw new Error('Tool wire names collide; rename the conflicting capabilities');
 return names;
}

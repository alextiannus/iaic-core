// Host-side diagnostics only. Entrances adapt authenticated catalog readers;
// this module has no execution, authorization or grant-changing port.
const label=value=>typeof value==='string'&&value.trim().length>0&&value.length<=128;
const names=value=>Array.isArray(value)&&value.every(n=>typeof n==='string'&&/^[a-z][a-z0-9_.-]*$/.test(n))&&new Set(value).size===value.length;
const invalid=()=>{throw new TypeError('Invalid access catalog matrix configuration');};
export async function checkAccessCatalogMatrix({cases,entrances}={}){
 if(!Array.isArray(cases)||!cases.length||!Array.isArray(entrances)||!entrances.length)invalid();
 if(new Set(cases.map(c=>c?.name)).size!==cases.length||new Set(entrances.map(e=>e?.name)).size!==entrances.length)invalid();
 // Snapshot expectations and callbacks before the first asynchronous read.
 const readers=entrances.map(e=>{
  if(!label(e?.name)||!['model','host'].includes(e.surface)||typeof e.list!=='function')invalid();
  return {name:e.name,surface:e.surface,list:e.list};
 });
 const fixtures=cases.map(c=>{
  if(!label(c?.name)||!c.expected||Object.keys(c.expected).some(k=>!['model','host'].includes(k)))invalid();
  const expected={};
  for(const surface of new Set(readers.map(e=>e.surface))){if(!names(c.expected[surface]))invalid();expected[surface]=[...c.expected[surface]].sort();}
  return {name:c.name,context:c.context,expected};
 });
 const checks=[];
 for(const fixture of fixtures)for(const reader of readers){
  const base={case:fixture.name,entrance:reader.name,surface:reader.surface};
  let actual;
  try{actual=await reader.list(fixture.context);}catch{checks.push({...base,passed:false,missing:[],unexpected:[],error:'CATALOG_UNAVAILABLE'});continue;}
  if(!names(actual)){checks.push({...base,passed:false,missing:[],unexpected:[],error:'INVALID_CATALOG'});continue;}
  const expected=fixture.expected[reader.surface];
  const missing=expected.filter(n=>!actual.includes(n));
  const unexpected=actual.filter(n=>!expected.includes(n)).sort();
  checks.push({...base,passed:!missing.length&&!unexpected.length,missing,unexpected});
 }
 return {passed:checks.every(c=>c.passed),checks};
}

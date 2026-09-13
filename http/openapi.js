import {evidenceDigest,jsonValue} from '../evaluation/runner.js';
const fail=message=>new Error(message);
const methods=['get','post','put','patch','delete'];
// Discovery and request mapping only. Authorization, effects and JSON validation
// remain explicit host contracts consumed by importHttpCapabilities.
export class OpenApiCatalog {
 #document;#operations=new Map();#revision;
 get revision(){return this.#revision;}
 constructor({document}){
  this.#document=jsonValue(document);
  if(!/^3\.(0|1)\.\d+$/.test(document.openapi||'')||!document.paths||typeof document.paths!=='object'||Buffer.byteLength(JSON.stringify(document))>2000000)throw fail('Bounded OpenAPI 3.0/3.1 document required');
  this.#revision=evidenceDigest(this.#document);
  for(const [path,raw] of Object.entries(this.#resolve(this.#document.paths))){
   if(!path.startsWith('/')||path.startsWith('//')||path.length>500||/[?#\\%]/.test(path)||/[{}]/.test(path.replace(/\{[^{}]+\}/g,''))||path.split('/').some(s=>['.','..'].includes(s)))throw fail('Unsupported OpenAPI path');
   const item=raw;
   for(const method of methods)if(item[method]){
    const operation=item[method],id=operation.operationId||method.toUpperCase()+' '+path;
    if(typeof id!=='string'||id.length>600||this.#operations.has(id)||this.#operations.size>=1000)throw fail('Unique bounded operation identifiers required');
    this.#operations.set(id,{id,method:method.toUpperCase(),path,description:operation.description||operation.summary||id,parameters:item.parameters??[],operation});
   }
  }
 }
 #resolve(value){
  let nodes=0,bytes=0;
  const visit=(v,seen=new Set(),depth=0)=>{
   if(++nodes>10000||depth>40)throw fail('OpenAPI reference expansion exceeds bounds');
   if(typeof v==='string'&&(bytes+=Buffer.byteLength(v))>2000000)throw fail('OpenAPI reference expansion exceeds bounds');
   if(!v||typeof v!=='object')return v;
   if(Array.isArray(v))return v.map(x=>visit(x,seen,depth+1));
   if(Object.hasOwn(v,'$ref')){
    const ref=v.$ref;
    if(Object.keys(v).length!==1||typeof ref!=='string'||!ref.startsWith('#/')||seen.has(ref))throw fail('Only nonrecursive local references without siblings are supported');
    let target=this.#document;
    for(const raw of ref.slice(2).split('/')){const key=raw.replace(/~1/g,'/').replace(/~0/g,'~');if(!target||!Object.hasOwn(target,key))throw fail('Unresolved OpenAPI reference');target=target[key];}
    return visit(target,new Set([...seen,ref]),depth+1);
   }
   return Object.fromEntries(Object.entries(v).map(([k,x])=>{
    if((bytes+=Buffer.byteLength(k))>2000000)throw fail('OpenAPI reference expansion exceeds bounds');
    return [k,visit(x,seen,depth+1)];
   }));
  };return visit(value);
 }
 list(){return [...this.#operations.values()].map(({id,method,path,description})=>({id,method,path,description,revision:this.revision}));}
 get(id){const entry=this.#operations.get(id);if(!entry)throw fail('Unknown OpenAPI operation');return structuredClone(entry);}
 bindings(selections){
  if(!Array.isArray(selections))throw fail('Explicit operation selections required');
  return selections.map(selection=>{
   const {operationId,...host}=selection,entry=this.get(operationId),op=entry.operation;
   if(!host.input||!host.output||!['read','write'].includes(host.effect)||typeof host.authorize!=='function'||host.method!==undefined||host.request!==undefined)throw fail('Host input/output, effect and authorization required; use manual HTTP bindings for custom mapping');
   const parameters=new Map();
   for(const list of [entry.parameters,op.parameters??[]]){
    if(!Array.isArray(list))throw fail('Parameter list required');const unique=new Set();
    for(const p of list){const key=JSON.stringify([p.in,p.name]);if(unique.has(key))throw fail('Duplicate parameter');unique.add(key);parameters.set(key,p);}
   }
   const params=[...parameters.values()],slots=[...entry.path.matchAll(/\{([^{}]+)\}/g)].map(m=>m[1]);
   for(const p of params)if(!['path','query'].includes(p.in)||typeof p.name!=='string'||!p.name||!['string','integer','number','boolean'].includes(p.schema?.type)||p.content||p.allowReserved||p.allowEmptyValue||p.style&&p.style!==(p.in==='path'?'simple':'form')||p.in==='path'&&(p.required!==true||!slots.includes(p.name)))throw fail('Only scalar simple path and form query parameters are supported');
   if(slots.some(s=>!params.some(p=>p.in==='path'&&p.name===s)))throw fail('Path placeholder is missing its required parameter');
   const requestBody=op.requestBody;
   if(requestBody&&(!requestBody.content?.['application/json']||entry.method==='GET'))throw fail('Only explicit JSON request bodies are supported');
   return {...host,description:host.description||entry.description,method:entry.method,request:value=>{
    if(!value||typeof value!=='object'||Object.keys(value).some(k=>!['path','query','body'].includes(k)))throw fail('OpenAPI arguments must use path/query/body groups');
    for(const group of ['path','query'])if(value[group]!==undefined&&(!value[group]||typeof value[group]!=='object'||Array.isArray(value[group])||Object.keys(value[group]).some(n=>!params.some(p=>p.in===group&&p.name===n))))throw fail('Undeclared OpenAPI parameter');
    let path=entry.path.slice(1);const query=Object.create(null);
    for(const p of params){const v=value[p.in]?.[p.name];if(v===undefined){if(p.required)throw fail('Required OpenAPI parameter missing');continue;}
     if(p.schema.type==='integer'?!Number.isSafeInteger(v):p.schema.type==='number'?!Number.isFinite(v):typeof v!==p.schema.type)throw fail('OpenAPI scalar parameter type mismatch');
     if(p.in==='path'){if(['.','..'].includes(String(v)))throw fail('Dot path parameter rejected');path=path.split('{'+p.name+'}').join(encodeURIComponent(String(v)));}else query[p.name]=String(v);
    }
    if(value.body!==undefined&&!requestBody||requestBody?.required&&value.body===undefined)throw fail('OpenAPI body presence mismatch');
    return {path,query,...(value.body!==undefined?{body:value.body}:{})};
   }};
  });
 }
}

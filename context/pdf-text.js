import {Worker,isMainThread,parentPort,workerData} from 'node:worker_threads';
// Bounded local parsing. Runs no PDF scripts and has no network/model credentials.
export function extractPdfText(bytes,{maxPages=40,maxCharacters=80000,timeoutMs=12000}={}){
 if(!(bytes instanceof Uint8Array)||bytes.byteLength>4194304||!Number.isInteger(maxPages)||maxPages<1||maxPages>100||!Number.isInteger(maxCharacters)||maxCharacters<1||maxCharacters>200000)throw Error('Invalid PDF extraction limits');
 return new Promise((resolve,reject)=>{let settled=false;const worker=new Worker(new URL('./pdf-text.js',import.meta.url),{workerData:{bytes,maxPages,maxCharacters},resourceLimits:{maxOldGenerationSizeMb:128}});const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);worker.terminate().catch(()=>{});error?reject(Object.assign(error,{statusCode:400})):resolve(value);};const timer=setTimeout(()=>finish(Error('PDF parsing timed out; use a smaller document')),timeoutMs);worker.on('message',m=>m.error?finish(Error(m.error)):finish(null,m));worker.on('error',e=>finish(e));worker.on('exit',()=>{if(!settled)finish(Error('PDF parser stopped before completion'));});});
}
if(!isMainThread&&workerData){
 try{const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');const loading=getDocument({data:new Uint8Array(workerData.bytes),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,verbosity:0});const doc=await loading.promise;
  if(doc.numPages>workerData.maxPages)throw Error('PDF exceeds page limit; select the relevant pages');let text='';
  for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),content=await page.getTextContent();text+=`\n[Page ${n}]\n`+content.items.map(i=>i.str||'').join(' ')+'\n';if(text.length>workerData.maxCharacters)throw Error('PDF exceeds text limit; select the relevant pages');}
  const hasText=text.replace(/\[Page \d+\]/g,'').trim().length>0;await doc.destroy();parentPort.postMessage({text,pages:doc.numPages,hasText});
 }catch(e){parentPort.postMessage({error:'PDF could not be read: '+e.message});}
}

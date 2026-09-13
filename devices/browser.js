const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode,preflightRejected:true});
export function browserAction(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw fail('Browser action required');
 const action=structuredClone(input),fields={navigate:['type','url'],click:['type','selector'],type:['type','selector','text'],press:['type','key'],scroll:['type','x','y']}[action.type];
 if(!fields||Object.keys(action).some(k=>!fields.includes(k)))throw fail('Unsupported browser action');
 if(['click','type'].includes(action.type)&&(typeof action.selector!=='string'||!action.selector.trim()||action.selector.length>1000))throw fail('Bounded selector required');
 if(action.type==='type'&&(typeof action.text!=='string'||action.text.length>8000))throw fail('Bounded input text required');
 if(action.type==='navigate'){let url;try{url=new URL(action.url);}catch{throw fail('HTTP(S) navigation URL required');}if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.href.length>2000)throw fail('HTTP(S) navigation URL required');action.url=url.href;}
 if(action.type==='press'&&!['Enter','Tab','Escape','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Backspace'].includes(action.key))throw fail('Unsupported browser key');
 if(action.type==='scroll'&&(!Number.isInteger(action.x)||!Number.isInteger(action.y)||Math.abs(action.x)>10000||Math.abs(action.y)>10000))throw fail('Bounded scroll offset required');
 return action;
}
// Host owns the isolated Puppeteer-compatible Page, network policy and lifetime.
export class PuppeteerPageDevice{
 constructor({page,saveScreenshot=null,timeoutMs=30000}){if(typeof page?.evaluate!=='function'||typeof page?.url!=='function'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw fail('Browser Page and bounded timeout required');Object.assign(this,{page,saveScreenshot,timeoutMs});}
 async observe({screenshot=false}={}){
  if(typeof screenshot!=='boolean'||screenshot&&typeof this.saveScreenshot!=='function')throw fail('Screenshot storage port required');
  const state=await this.page.evaluate(()=>({url:location.href,title:document.title.slice(0,1000),text:(document.body?.innerText||'').slice(0,8000),viewport:{width:innerWidth,height:innerHeight},controls:Array.from(document.querySelectorAll('button,input,textarea,select,a')).slice(0,30).map(e=>({tag:e.tagName.toLowerCase(),id:e.id.slice(0,100),name:(e.getAttribute('aria-label')||e.getAttribute('name')||e.textContent||'').slice(0,100),type:(e.getAttribute('type')||'').slice(0,20),disabled:!!e.disabled}))}));
  if(state.url.length>2000)throw fail('Browser URL exceeds observation limit',413);
  let image=null;
  if(screenshot){const bytes=Buffer.from(await this.page.screenshot({type:'png',fullPage:false,timeout:this.timeoutMs}));if(bytes.length>2000000)throw fail('Screenshot exceeds 2 MB',413);image=await this.saveScreenshot(bytes);if(!image||typeof image!=='object'||Buffer.byteLength(JSON.stringify(image))>8000)throw fail('Bounded screenshot reference required');}
  return {...state,image,observedAt:new Date().toISOString()};
 }
 async execute({expectedUrl,action}){
  action=browserAction(action);if(typeof expectedUrl!=='string'||this.page.url()!==expectedUrl)throw fail('Browser URL changed; observe again',409);
  const perform=async()=>{
  if(action.type==='navigate')await this.page.goto(action.url,{waitUntil:'domcontentloaded',timeout:this.timeoutMs});
  if(action.type==='click')await this.page.click(action.selector);
  if(action.type==='type')await this.page.type(action.selector,action.text);
  if(action.type==='press')await this.page.keyboard.press(action.key);
  if(action.type==='scroll')await this.page.mouse.wheel({deltaX:action.x,deltaY:action.y});
  };
  let timer;try{await Promise.race([perform(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Browser command deadline exceeded')),this.timeoutMs);})]);}finally{clearTimeout(timer);}
  return {status:'submitted'};
 }
}

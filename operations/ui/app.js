/* Same-origin read-only UI; values are text nodes, never HTML. */
const base=new URL(document.currentScript.src).pathname.replace(/\/app\.js$/,'');
const $=id=>document.getElementById(id),roster=$('agents'),detail=$('detail');
const health={healthy:'运行正常',degraded:'运行受限',unavailable:'运行不可用',unknown:'健康未知'},activity={working:'工作中',waiting:'等待中',queued:'任务排队',idle:'空闲',unknown:'活动未知'},life={active:'启用',paused:'暂停接新工作',retired:'已退役'},role={platform:'Platform AI','user-assistant':'User Assistant',business:'Business AI'};
let refreshMs=30000,feedbackEnabled=false,skillsEnabled=false;
const drafts=new Map();
const state={cursors:[null],page:0,next:null,selected:null,serial:0,controller:null,stopped:false};
function el(tag,text,cls){const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;}
function field(parent,label,value){const dl=el('dl'),dt=el('dt',label),dd=el('dd',value??'未上报');dl.append(dt,dd);parent.append(dl);}
function reference(parent,ref){if(ref)parent.append(el('p',`${ref.source} / ${ref.id} · ${ref.revision??'版本未上报'}`,'source'));}
function empty(){state.overview=null;state.next=null;roster.replaceChildren();detail.replaceChildren();$('next').disabled=true;$('previous').disabled=true;}
async function read(path,signal){const response=await fetch(base+'/api/'+path,{credentials:'same-origin',cache:'no-store',signal});if(!response.ok){const error=Error('read failed');error.status=response.status;throw error;}return response.json();}
function renderOverview(view){roster.replaceChildren();state.overview=view;const query=$('agent-search').value.trim().toLocaleLowerCase(),filter=$('agent-filter').value;const visible=view.items.filter(row=>[row.agent.name,row.agent.id,row.agent.workspaceId,row.agent.principalId].join(' ').toLocaleLowerCase().includes(query)&&(filter==='all'||filter==='attention'&&(row.health.state!=='healthy'||row.taskCounts.unknownResults>0)||filter==='working'&&row.activity==='working'||filter==='paused'&&row.agent.lifecycle==='paused'));const rooms=new Map();for(const row of visible){const key=row.agent.workspaceId;if(!rooms.has(key)){const room=el('section',null,'room'),grid=el('div',null,'desks');room.append(el('h2',key),grid);roster.append(room);rooms.set(key,grid);}const b=el('button',null,'agent');b.type='button';b.setAttribute('aria-pressed',String(row.agent.id===state.selected));b.append(el('strong',row.agent.name),el('span',`${role[row.agent.role]??'角色未上报'} · ${row.agent.location==='external'?'外部':'内置'} · ${life[row.agent.lifecycle]}`,'meta'),el('span',activity[row.activity]));const h=el('span',health[row.health.state],'health');h.dataset.state=row.health.state;b.append(h,el('span',`执行 ${row.taskCounts.running} · 等待 ${row.taskCounts.waiting} · 结果未知 ${row.taskCounts.unknownResults}`,'meta'));if(!row.complete)b.append(el('span','观测不完整','meta'));b.onclick=()=>{state.selected=row.agent.id;setSkillAgent(row.agent.id,row.agent.name);refresh();};rooms.get(key).append(b);}
 if(!visible.length)roster.append(el('p',view.complete?'当前页没有匹配的 Agent，可调整筛选或翻页。':'当前页没有可用记录，观测不完整。'));
 state.next=view.nextCursor;$('previous').disabled=state.page===0;$('next').disabled=!state.next;$('page').textContent=`第 ${state.page+1} 页`;
 $('status').textContent=`当前页 ${view.count.agents} 个 Agent · 健康未知 ${view.count.healthUnknown} · ${view.complete?'读取完整':'观测不完整'} · ${view.asOf}`;
}
function renderDetail(view){detail.replaceChildren(el('h2',view.agent.name));field(detail,'代表主体',view.agent.principalId);field(detail,'工作空间',view.agent.workspaceId);field(detail,'活动 / 生命周期',`${activity[view.activity]} / ${life[view.agent.lifecycle]}`);field(detail,'运行健康',health[view.health.state]);field(detail,'健康依据覆盖',view.health.complete?'当前覆盖完整':'覆盖不完整');for(const reason of view.health.reasons)detail.append(el('p',reason,'meta'));
 detail.append(el('h3','当前工作'));if(!view.tasks.length)detail.append(el('p',view.sources.tasks.complete?'没有任务记录':'暂无可信任务记录'));for(const task of view.tasks){const card=el('div',null,'entry');field(card,'Task',task.id);field(card,'状态 / 结果',`${task.status} / ${task.resultState}`);if(task.waitingReason)field(card,'等待原因',task.waitingReason);reference(card,task.reference);detail.append(card);}
 detail.append(el('h3','模型'));if(!view.models.length)detail.append(el('p','未上报模型信息'));for(const m of view.models){const card=el('div',null,'entry');field(card,'Task',m.taskId);field(card,'默认配置',m.configuredProfileRef);field(card,'Task 绑定模型',m.boundModel);field(card,'请求模型',m.requestedModel);field(card,'实际确认模型',m.actualModel);field(card,'Provider / 证据来源',`${m.provider??'未上报'} / ${m.basis}`);reference(card,m.reference);detail.append(card);}
 detail.append(el('h3','协作'));if(!view.interactions.length)detail.append(el('p','暂无协作记录'));for(const edge of view.interactions){const card=el('div',null,'entry');card.append(el('p',`${edge.from} → ${edge.to}`),el('p',`${edge.type} · ${edge.stage} · ${edge.basis}`));field(card,'Task',edge.taskId);reference(card,edge.reference);detail.append(card);}
 const evidence=el('details');evidence.append(el('summary','来源与运行信号'));for(const [name,source] of Object.entries(view.sources)){const entry=el('div',null,'entry');entry.append(el('p',`${name} · ${source.state} · ${source.complete?'完整':'不完整'}`));field(entry,'观测时间',source.observedAt);field(entry,'有效期',source.validUntil);reference(entry,source.reference);evidence.append(entry);}for(const signal of view.signals){const entry=el('div',null,'entry');entry.append(el('p',`${signal.kind} · ${signal.state} · ${signal.freshness} · ${signal.basis}`),el('p',signal.reason));reference(entry,signal.reference);evidence.append(entry);}detail.append(evidence);
}
async function renderFeedback(id,signal){
 if(!feedbackEnabled)return;
 const rows=await read('feedback?id='+encodeURIComponent(id),signal);
 if(state.selected!==id||signal.aborted)return;
 const section=el('section');section.append(el('h3','观测反馈'));
 for(const row of rows) section.append(el('p',row.id+' · '+row.state+' · '+row.summary));
 const form=el('form'),input=el('textarea'),button=el('button','提交反馈'),status=el('p');
 input.required=true;input.maxLength=2000;input.setAttribute('aria-label','反馈内容');button.type='submit';form.append(input,button,status);section.append(form);detail.append(section);
 const draft=drafts.get(id)??{requestKey:crypto.randomUUID(),summary:'',receipt:''};drafts.set(id,draft);input.value=draft.summary;status.textContent=draft.receipt;input.oninput=()=>{if(draft.summary!==input.value){draft.requestKey=crypto.randomUUID();draft.summary=input.value;}};
 form.onsubmit=async event=>{
  event.preventDefault();button.disabled=true;
  const requestKey=draft.requestKey,pendingSummary=draft.summary;
  try{
   const response=await fetch(base+'/api/feedback?id='+encodeURIComponent(id),{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-IAIC-Operations':'1'},body:JSON.stringify({requestKey,summary:pendingSummary})});
   if(!response.ok){if([401,403].includes(response.status)){stopAccess();$('status').textContent='访问权限已失效，请重新登录或联系管理员。';}throw Error('feedback unavailable');}
   const receipt=await response.json();status.textContent='已记录：'+receipt.id+' · '+receipt.state;draft.receipt=status.textContent;if(draft.requestKey===requestKey){input.value='';draft.summary='';draft.requestKey=crypto.randomUUID();}
  }catch{status.textContent='提交结果未确认，请保留内容重试。相同内容重试使用原请求编号。';}
  finally{button.disabled=false;}
 };
}
async function refresh(){if(state.stopped)return;const editing=document.activeElement?.getAttribute('aria-label')==='反馈内容',selection=editing?document.activeElement.selectionStart:null;const serial=++state.serial;state.controller?.abort();state.controller=new AbortController();const signal=state.controller.signal;$('status').textContent='正在刷新…';empty();try{const params=new URLSearchParams({limit:'20'});if(state.cursors[state.page])params.set('cursor',state.cursors[state.page]);const view=await read('overview?'+params,signal);if(serial!==state.serial||state.stopped)return;renderOverview(view);if(state.selected&&!view.items.some(x=>x.agent.id===state.selected))state.selected=null;if(state.selected){const item=await read('agent?'+new URLSearchParams({id:state.selected}),signal);if(serial!==state.serial||state.stopped)return;renderDetail(item);await renderFeedback(state.selected,signal);if(editing){const input=detail.querySelector('textarea');input?.focus();input?.setSelectionRange(selection,selection);}}else detail.append(el('p','选择一个 Agent，查看当前工作和运行依据。'));}catch(error){if(serial!==state.serial||error.name==='AbortError')return;empty();if(error.status===401||error.status===403){stopAccess();$('status').textContent=error.status===401?'登录已失效，请通过应用重新登录后刷新页面。':'当前没有平台运维看板权限，已清除显示内容。';}else{$('status').textContent='暂时无法读取运行状态。请稍后刷新；不能据此判断 Agent 已停止。';}}}
$('refresh').onclick=refresh;$('next').onclick=()=>{if(!state.next)return;state.cursors=state.cursors.slice(0,state.page+1);state.cursors.push(state.next);state.page++;state.selected=null;refresh();};$('previous').onclick=()=>{if(!state.page)return;state.page--;state.selected=null;refresh();};$('view').onchange=()=>{roster.dataset.view=$('view').value;};
async function poll(){if(!document.hidden&&!state.stopped){await refresh();if(skillsEnabled&&!state.stopped)await refreshSkills();}setTimeout(poll,refreshMs);}
document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();refreshSkills();}});
(async()=>{try{const config=await read('config');refreshMs=config.refreshMs;feedbackEnabled=config.feedback;skillsEnabled=config.skills===true;}catch{}if(!skillsEnabled){clearSkills();$('skill-status').textContent='应用尚未连接技能目录，请接入 SkillInventory。未连接不表示没有技能。';}await poll();})();

// Skill search runs against the complete authorized snapshot, independently of Agent pagination.
const skillState={agentId:null,agentName:null,cursors:[null],page:0,next:null,serial:0,controller:null,result:null,open:new Set()};
function clearSkills(){skillState.controller?.abort();skillState.serial++;skillState.result=null;$('skills').replaceChildren();$('skill-summary').replaceChildren();$('skill-export').disabled=true;$('skill-next').disabled=true;$('skill-previous').disabled=true;}
function stopAccess(){
 state.stopped=true;state.serial++;state.controller?.abort();state.selected=null;drafts.clear();empty();clearSkills();
 skillState.agentId=null;skillState.agentName=null;skillState.next=null;skillState.open.clear();
 $('skills-heading').textContent='系统技能目录';$('skill-status').textContent='技能信息已清除。';$('refresh').disabled=true;
}
function setSkillAgent(id,name){if(state.stopped)return;skillState.agentId=id;skillState.agentName=name;skillState.cursors=[null];skillState.page=0;$('skill-filter').value='all';$('skill-search').value='';$('skills-heading').textContent=id?name+' · 技能检查':'系统技能目录';refreshSkills();}
function renderSkills(view){
 skillState.result=view;skillState.next=view.nextCursor;
 $('skills-heading').textContent=skillState.agentId?skillState.agentName+' · 技能检查':'系统技能目录';
 $('skill-filter').disabled=!skillState.agentId;
 $('skill-status').textContent=`${view.complete?'当前授权范围读取完整':'资料不完整或已过期，请核实'} · 匹配 ${view.counts.matched} 项 · ${view.asOf}`;
 $('skill-summary').replaceChildren();
 for(const [label,value] of [['系统支持',view.counts.supported],['该 Agent 已安装',view.counts.installed],['运行受限',view.counts.blocked],['版本不同',view.counts.updates]]){const box=el('div',null,'metric');box.append(el('strong',value??'—'),el('span',label));$('skill-summary').append(box);}
 const list=$('skills');list.replaceChildren();
 for(const row of view.items){
  const card=el('article',null,'skill-card');card.append(el('h3',row.name),el('p',row.description,'meta'));
  const badges=el('div',null,'badges');
  for(const label of [row.registered===true?'系统支持':row.registered===false?'目录未收录':'目录待核实',...(skillState.agentId?[row.installed===true?'已安装':row.installed===false?'未安装':'安装待核实',row.enabled===true?'已启用':row.enabled===false?'已停用':'启用待核实',({ready:'运行检查通过',blocked:'运行受限',unknown:'运行待核实'})[row.readiness]]:[])])badges.append(el('span',label,'badge'));
  card.append(badges);if(skillState.agentId)card.append(el('p',row.reason,'reason'));if(row.updateAvailable)card.append(el('p','安装版本与目录版本不同，请核对发布说明。','reason'));
  const more=el('details');more.open=skillState.open.has(row.id);more.ontoggle=()=>{if(more.open)skillState.open.add(row.id);else skillState.open.delete(row.id);};more.append(el('summary','版本、来源与依赖'));
  field(more,'技能 ID',row.id);field(more,'目录版本（内容指纹）',row.version);if(skillState.agentId)field(more,'安装版本',row.installedVersion);
  field(more,'来源',row.source);field(more,'作者',row.metadata?.author);field(more,'发布版本',row.metadata?.version);field(more,'格式',row.format);field(more,'兼容要求',row.compatibility);field(more,'声明的工具（不代表已授权）',row['allowed-tools']);field(more,'许可证',row.license);card.append(more);list.append(card);
 }
 if(!view.items.length)list.append(el('p',view.complete?'没有匹配的技能。':'当前没有可显示记录，数据不完整。'));
 $('skill-export').disabled=false;$('skill-next').disabled=!view.nextCursor;$('skill-previous').disabled=skillState.page===0;$('skill-page').textContent=`第 ${skillState.page+1} 页`;
}
async function refreshSkills(){
 if(!skillsEnabled||state.stopped)return;
 clearSkills();const serial=skillState.serial;skillState.controller=new AbortController();const signal=skillState.controller.signal;
 $('skill-status').textContent='正在读取技能目录…';
 const params=new URLSearchParams({query:$('skill-search').value,status:skillState.agentId?$('skill-filter').value:'all',limit:'12'});
 if(skillState.agentId)params.set('agentId',skillState.agentId);if(skillState.cursors[skillState.page])params.set('cursor',skillState.cursors[skillState.page]);
 try{const view=await read('skills?'+params,signal);if(serial===skillState.serial&&!state.stopped)renderSkills(view);}
 catch(error){if(serial!==skillState.serial||error.name==='AbortError')return;
  if([401,403].includes(error.status)){stopAccess();$('status').textContent='访问权限已失效，请重新登录或联系管理员。';$('refresh').disabled=true;}
  if(error.status===400&&skillState.page>0){skillState.page=0;skillState.cursors=[null];await refreshSkills();return;}
  $('skill-status').textContent=[401,403].includes(error.status)?'技能信息已清除。':error.status===504?'技能来源读取超时，请重试。':'无法读取技能目录；这不代表系统没有技能。';
 }
}
$('skill-system').onclick=()=>setSkillAgent(null,null);
$('skill-search-form').onsubmit=event=>{event.preventDefault();skillState.page=0;skillState.cursors=[null];refreshSkills();};
$('skill-filter').onchange=()=>{skillState.page=0;skillState.cursors=[null];refreshSkills();};
$('skill-next').onclick=()=>{if(!skillState.next)return;skillState.cursors=skillState.cursors.slice(0,skillState.page+1);skillState.cursors.push(skillState.next);skillState.page++;refreshSkills();};
$('skill-previous').onclick=()=>{if(skillState.page){skillState.page--;refreshSkills();}};
$('agent-search').oninput=$('agent-filter').onchange=()=>{if(state.overview&&!state.stopped)renderOverview(state.overview);};
$('skill-export').onclick=()=>{if(!skillState.result||state.stopped)return;const url=URL.createObjectURL(new Blob([JSON.stringify(skillState.result,null,2)],{type:'application/json'}));const a=el('a');a.href=url;a.download='iaic-skills-page-'+(skillState.page+1)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
$('refresh').onclick=()=>{refresh();refreshSkills();};

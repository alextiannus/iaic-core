// Local demonstration only. Fixture identities are NOT production session authentication.
import {createServer} from 'node:http';
import {randomBytes} from 'node:crypto';
import {SkillCatalog} from '../../skills/catalog.js';
import {Operations} from '../../operations/service.js';
import {SkillInventory} from '../../operations/skill-inventory.js';
import {createOperationsDashboard} from '../../operations/dashboard.js';
const ref=id=>({source:'local-demo',id,revision:'1'});
const packet=items=>({items,complete:true,observedAt:new Date().toISOString(),validUntil:new Date(Date.now()+60000).toISOString()});
const agents=[{id:'research',name:'研究助手',role:'business',location:'internal',lifecycle:'active',workspaceId:'演示工作空间',principalId:'demo-research',reference:ref('research')},{id:'platform',name:'平台维护 Agent',role:'platform',location:'internal',lifecycle:'paused',workspaceId:'演示工作空间',principalId:'demo-platform',reference:ref('platform')}];
const operations=new Operations({namespace:'skill-demo',cursorKey:randomBytes(32),resolveScope:()=> 'demo-operator',authorize:()=>true,listAgents:async()=>({items:agents,next:null,complete:true}),readAgent:async({id})=>agents.find(a=>a.id===id),sources:Object.fromEntries(['tasks','models','signals','interactions'].map(k=>[k,async()=>({...packet([]),reference:ref(k)})]))});
const catalog=new SkillCatalog({root:new URL('../',import.meta.url).pathname,entries:['core-real-composition/skills/record-selection/SKILL.md','core-real-delegation/skills/readiness/SKILL.md']});
const skills=new SkillInventory({operations,cursorKey:randomBytes(32),listCatalog:async()=>packet((await catalog.list()).map(r=>({...r,source:'IAiC 示例技能包'}))),readBindings:async({agent})=>packet(agent.id==='research'?(await catalog.list()).map((s,i)=>({id:s.id,installedVersion:i?s.version:'demo-older-version',enabled:!i,readiness:'unknown',reason:i?'演示：等待管理员核实配置':'示例未连接真实工具授权检查'})):[])});
const dashboard=createOperationsDashboard({operations,skills,resolveObserver:async()=>({actor:{id:'local-demo'},binding:'demo'}),authorizeOperator:()=>true});
const server=createServer(async(req,res)=>{if(!await dashboard(req,res)){res.writeHead(404);res.end();}});
server.listen(Number(process.env.PORT??4319),'127.0.0.1',()=>console.log('LOCAL FIXTURE ONLY http://127.0.0.1:'+server.address().port+'/admin/agents'));

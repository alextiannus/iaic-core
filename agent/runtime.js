import {usageDiagnostic} from './usage-diagnostic.js';
import {verificationResult} from './verification.js';
import {remainingToolAttempts} from './tool-limits.js';
import {randomUUID} from 'node:crypto';
import {pendingBatch} from './batches.js';
import {Delegations} from './delegation.js';
import {ResultWaits} from './result-waits.js';
import {withExecutionSignal,executionSignal} from '../context/execution.js';
import {setTimeout as delay} from 'node:timers/promises';
const fail=(message,statusCode=409)=>Object.assign(new Error(message),{statusCode});

export class AgentRuntime {
  constructor({store,dispatcher,model,context,version,maxTurns=20,maxCalls=30,modelTimeoutMs=120000,maxOutputBytes=32000,taskTimeoutMs=300000,rateLimitDelayMs=60000,maxBatchCalls=1,resolveModel=null,agentIdentity=null,mandates=null,handoffs=null,authority=null}) {
    if(!Number.isInteger(maxBatchCalls)||maxBatchCalls<1||maxBatchCalls>8)throw new Error('Batch bound must be 1..8');
    if(maxBatchCalls>1&&typeof context?.revalidateHistory!=='function')throw new Error('Batch execution requires current history revalidation');
    if(!version||!model?.name)throw new Error('Runtime requires a code/Skill version and configured model');
    if(!Number.isFinite(rateLimitDelayMs)||rateLimitDelayMs<0||rateLimitDelayMs>60000)throw new Error('Rate-limit delay must be between zero and 60000 ms');
    Object.assign(this,{store,dispatcher,model,context,version,maxTurns,maxCalls,modelTimeoutMs,maxOutputBytes,taskTimeoutMs,rateLimitDelayMs,maxBatchCalls,resolveModel,agentIdentity,mandates,handoffs,authority});
    this.resultWaits=new ResultWaits({store,dispatcher,version,authorizeTask:(actor,task,name)=>this.checkResultWait(actor,task,name),admitRead:async(actor,task,action)=>{if(!task.authority)return null;const callId=randomUUID();await this.authority.admitTool({actor,task,action,callId});return callId;},settleRead:async(task,callId,outcome)=>{if(task.authority)await this.authority.settleTool({task,callId,outcome});}});
    this.delegations=new Delegations({store,handoffs,version,authorizeTask:async(actor,task)=>{await this.state(actor,task.id);await this.checkMandate(actor,task);if(task.agent&&!this.agentIdentity)throw fail('Agent resolver unavailable',503);if(this.agentIdentity)await this.agentIdentity.check({actor,task,binding:task.agent});}});
    this.executor=null;this.running=null;this.timer=null;
  }
  async initialize(){
    await this.store.initialize();const executor=await this.store.acquireExecutor();
    if(executor&&this.maxBatchCalls>1&&typeof executor.prepareBatchAction!=='function'){await executor.close();throw fail('Task executor does not support durable batch action receipts',503);}
    this.executor=executor;return {ready:Boolean(executor)};
  }
  async create({capability,input,actor,idempotencyKey}) {
    if(capability.implementation.kind!=='agent')throw fail('Task requires an Agent capability',400);
    if(await capability.authorize(actor,input)!==true)throw fail('Task access denied',403);
    this.taskTools(capability,input);this.delegations.policy(input);
    await this.checkMandate(actor,{capability:capability.name,input});
    await this.dispatcher.checkPolicy?.(capability,input,{actor,phase:'admission',callId:idempotencyKey??null});
    if(typeof idempotencyKey==='string'&&idempotencyKey.startsWith('iaic-handoff:')&&!this.handoffs)throw fail('Handoff resolver unavailable',503);
    const handoff=this.handoffs?await this.handoffs.bind({actor,capability,input,idempotencyKey,version:this.version}):null;
    if(idempotencyKey?.startsWith('iaic-delegated-task:')&&!this.authority)throw fail('Task authority resolver unavailable',503);
    const authority=this.authority?await this.authority.bind({actor,capability,input,idempotencyKey,version:this.version}):null;
    const agent=this.agentIdentity?await this.agentIdentity.bind({actor,capability,input,version:this.version}):null;
    const model=this.resolveModel?await this.resolveModel({actor,agent}):this.model;
    return this.store.create({capability,input,actor,idempotencyKey,version:this.version,model:model.name,agent,handoff,authority});
  }
  taskTools(capability,input){
    const declared=capability.implementation.tools,allowed=input.allowedTools;
    if(allowed===undefined)return declared;
    if(!Array.isArray(allowed)||allowed.some(name=>typeof name!=='string'||!declared.includes(name))||new Set(allowed).size!==allowed.length)throw fail('Task allowedTools must be a unique subset of the Agent tools',400);
    return declared.filter(name=>allowed.includes(name));
  }
  async checkMandate(actor,task,tool=null){
    if(task.input.mandate!==undefined&&!this.mandates)throw fail('Task Mandate resolver is unavailable',503);
    if(task.input.mandate!==undefined)await this.mandates.checkTask(actor,{capability:task.capability,input:task.input,tool});
  }
  async checkAgent(actor,task){return this.checkExecution(actor,task);}
  async checkExecution(actor,task){
    if(task.authority&&!this.authority)throw fail('Task authority resolver unavailable',503);
    if(task.authority)await this.authority.check({actor,task});
    await this.checkMandate(actor,task);
    if(task.handoff&&!this.handoffs)throw fail('Task Handoff resolver is unavailable',503);
    if(this.handoffs)await this.handoffs.checkTask({actor,task});
    if(task.agent&&!this.agentIdentity)throw fail('Task Agent identity resolver is unavailable',503);
    if(this.agentIdentity)await this.agentIdentity.check({actor,task,binding:task.agent});
    if(this.dispatcher.executionPolicy){
      const capability=this.dispatcher.capabilities.get(task.capability);
      if(!capability)throw fail('Task capability unavailable',503);
      await this.dispatcher.checkPolicy(capability,task.input,{actor,phase:'agent',taskId:task.id});
    }
  }
  async checkResultWait(actor,task,name){
    await this.state(actor,task.id);await this.checkExecution(actor,task);await this.checkMandate(actor,task,name);
    const capability=this.dispatcher.capabilities.get(task.capability),action={name,input:task.wait_input};
    if(!this.taskTools(capability,task.input).includes(name)||(capability.implementation.allowCall&&await capability.implementation.allowCall(task.input,action,{actor,task})!==true))throw fail('Result wait is outside Task scope',403);
    if(this.handoffs)await this.handoffs.checkTool({actor,task,action});
    if(task.authority)await this.authority.checkTool({actor,task,action});
  }
  async state(actor,id){
    const task=await this.store.get(actor,id);const capability=this.dispatcher.capabilities.get(task.capability);
    if(!capability||await capability.authorize(actor,task.input)!==true)throw fail('Task access denied',403);
    // Lifecycle coordination needs status, not historical source/result access.
    const {id:taskId,capability:name,input,request_key,version,status,waiting_reason,agent,handoff,authority,delegation,updated_at}=task;
    return {id:taskId,capability:name,input,request_key,version,status,waiting_reason,agent,handoff,authority,delegation,updated_at};
  }
  async get(actor,id,{history=false}={}) {
    await this.state(actor,id);const task=await this.store.get(actor,id);
    const records=await this.store.history(actor,id);
    // Validate current access before returning stored sources or report artifacts.
    const visible=await this.context.revalidateHistory({history:records,actor,dispatcher:this.dispatcher});
    const request=task.status==='waiting'&&task.waiting_reason==='input'?[...visible.events].reverse().find(event=>event.kind==='model_response'&&event.data?.type==='wait'&&typeof event.data.question==='string'):null;
    const view={...task,inputRequest:request?{question:request.data.question,reference:String(request.seq)}:null};
    return history?{...view,...visible}:view;
  }
  async transitionReceipt(actor,id,requestKey){
    await this.state(actor,id);
    const receipt=await this.store.transitionReceipt(actor,id,requestKey);
    return receipt?{status:'confirmed',...receipt}:{status:'unknown',requestKey};
  }
  async transition(actor,id,request){
    const task=await this.store.get(actor,id);const capability=this.dispatcher.capabilities.get(task.capability);
    if(!capability||await capability.authorize(actor,task.input)!==true)throw fail('Task access denied',403);
    if(request.requestKey!==undefined&&request.requestKey!==null){
      const prior=await this.store.findTransition(actor,id,{...request,version:this.version});
      if(prior)return prior;
    }
    // Cancellation must remain possible even when historical context exceeds limits.
    if(request.action!=='cancel'){await this.checkExecution(actor,task);await this.get(actor,id);}
    const result=await this.store.transition(actor,id,{...request,version:this.version});
    if(request.action==='cancel'&&this.handoffs)await this.handoffs.cancelChildren(actor,id);
    return result;
  }
  start(intervalMs=1000){if(this.timer)return;this.timer=setInterval(()=>this.tick().catch(error=>console.error('IAiC runtime stopped a tick',{message:error.message})),intervalMs);this.timer.unref?.();}
  get ready(){return Boolean(this.executor&&!this.executor.failed&&!this.executor.closed);}
  tick(){
    if(this.running)return this.running;
    this.running=(async()=>{
      if(!this.ready){
        if(this.executor)await this.executor.close();
        this.executor=await this.store.acquireExecutor();
      }
      if(!this.ready)return null;
      if(this.authority?.tick)await this.authority.tick();
      if(this.handoffs)await this.handoffs.tick();
      await this.delegations.tick();
      await this.resultWaits.tick();
      return this.runNext();
    })().finally(()=>{this.running=null;});
    return this.running;
  }
  async runNext(){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(Object.assign(new Error('Task execution time limit reached'),{limitReached:true})),this.taskTimeoutMs);
    try{return await withExecutionSignal(controller.signal,()=>this.executeNext());}finally{clearTimeout(timer);}
  }
  async executeNext(){
    const task=await this.executor.claim(this.version);if(!task)return null;
    const actor=this.store.actor(task);
    const capability=this.dispatcher.capabilities.get(task.capability);
    try{
      if(!capability||capability.implementation.kind!=='agent')throw fail('Task capability unavailable',503);
      await this.checkExecution(actor,task);
      let model=this.resolveModel?await this.resolveModel({actor,agent:task.agent,modelIdentity:task.model}):this.model;
      if(task.authority)model=await this.authority.model({actor,task,model});
      if(task.model!==model.name)throw fail('Configured model differs from task model');
      while(true){
        executionSignal()?.throwIfAborted();
        if((await this.store.get(actor,task.id)).status!=='running')break;
        if(await capability.authorize(actor,task.input)!==true)throw fail('Task access revoked',403);
        await this.checkExecution(actor,task);
        const history=await this.store.history(actor,task.id);
        if(history.calls.some(call=>['running','unknown'].includes(call.status))){await this.executor.finish(task.id,{status:'waiting',reason:'external_result'});break;}
        const batch=pendingBatch(history);
        if(batch&&this.maxBatchCalls===1)throw fail('Pending batch requires its original enabled Runtime policy',503);
        if(batch?.closeReason){await this.executor.append(task.id,'action_batch_closed',{id:batch.id,reason:batch.closeReason});continue;}
        let action=batch?.action;
        const allowedTools=this.taskTools(capability,task.input);
        const remainingByTool=remainingToolAttempts(capability.implementation.toolCallLimits,history.calls,allowedTools);
        const turns=history.events.filter(e=>e.kind==='model_requested').length;
        const remainingToolCalls=Math.max(0,this.maxCalls-history.calls.length);
        const completionOnly=remainingToolCalls===0;
        const invocationBatchBound=completionOnly?1:Math.min(this.maxBatchCalls,remainingToolCalls);
        if(batch&&completionOnly){await this.executor.finish(task.id,{status:'waiting',reason:'limit'});break;}
        if(!batch){
        if(turns>=this.maxTurns||(completionOnly&&history.events.some(event=>event.kind==='model_requested'&&event.data.completionOnly===true))){await this.executor.finish(task.id,{status:'waiting',reason:'limit'});break;}
        if(task.authority)await this.authority.checkContext({actor,task,history});
        const messages=await this.context.assemble({task,capability,history,actor,dispatcher:this.dispatcher});
        messages.push({role:'system',content:JSON.stringify({executionBudget:{remainingToolCalls,remainingModelTurns:this.maxTurns-turns,maxBatchCalls:completionOnly?0:invocationBatchBound,completionOnly}})+'\nThese are current execution limits, not additional authority. Remaining model turns include this invocation. Reserve enough work to verify results and submit completion; avoid repeating unchanged successful operations.'});
        if(completionOnly)messages.push({role:'system',content:'The tool-call budget is exhausted. No further tools or delegation are available. Use the existing evidence to submit iaic_finish for application verification, or iaic_wait if essential user input is missing. This is the final completion opportunity; do not claim unfinished work is complete.'});
        if(Object.keys(remainingByTool).length)messages.push({role:'system',content:JSON.stringify({remainingToolAttempts:remainingByTool})+'\nThese per-Task ceilings count all prepared attempts, including failures and unknown outcomes. Exhausted tools cannot be called again in this Task. Use retained evidence, another permitted capability, or request help; do not repeat the mutation or claim it succeeded.'});
        const tools=(completionOnly?[]:allowedTools.filter(name=>remainingByTool[name]!==0)).map(name=>{
          const target=this.dispatcher.capabilities.get(name);
          return {name,description:target.description,inputSchema:target.input};
        });
        if(invocationBatchBound>1&&!completionOnly)messages.push({role:'system',content:'This Runtime explicitly permits a batch of up to '+invocationBatchBound+' independent tool calls in one response. They execute sequentially with current permission checks. Actions requiring earlier results must wait for the next response. Never combine finish, wait or delegation with other calls.'});
        await this.checkExecution(actor,task);
        if(this.handoffs)await this.handoffs.admitModel({actor,task,turn:turns+1});
        await this.executor.append(task.id,'model_requested',{model:model.name,turn:turns+1,...(completionOnly?{completionOnly:true}:{})});
        const controller=new AbortController();let timer;
        let response;
        try{response=await Promise.race([
          model.next({messages,tools,maxBatchCalls:invocationBatchBound,delegationSchema:completionOnly?null:this.delegations.schema(task),outputSchema:capability.output,billingContext:{taskId:task.id,turn:turns+1,capability:task.capability},signal:AbortSignal.any([controller.signal,executionSignal()].filter(Boolean))}),
          new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error('Model response timed out'),{limitReached:true}));},this.modelTimeoutMs);})
        ]);}catch(error){
          clearTimeout(timer);
          const diagnostic=usageDiagnostic(error.usageDiagnostic);
          await this.executor.append(task.id,'model_usage',{model:model.name,turn:turns+1,usage:error.usage??null,failed:true,...(diagnostic?{diagnostic}:{})});
          if(error.providerStatus===429){
            const waitMs=Math.max(this.rateLimitDelayMs,Number.isFinite(error.retryAfterMs)?error.retryAfterMs:0);
            const eligible=waitMs<=60000&&turns+1<this.maxTurns&&!history.events.some(event=>event.kind==='model_retry');
            await this.executor.append(task.id,'model_provider_error',{providerStatus:429,retryScheduled:eligible,...(Number.isFinite(error.retryAfterMs)?{retryAfterMs:error.retryAfterMs}:{})});
            if(eligible){
              await this.executor.append(task.id,'model_retry',{providerStatus:429,delayMs:waitMs});
              const until=Date.now()+waitMs;
              while(Date.now()<until){
                executionSignal()?.throwIfAborted();
                if((await this.store.get(actor,task.id)).status!=='running')break;
                try{await delay(Math.min(250,until-Date.now()),undefined,{signal:executionSignal()});}
                catch(error){executionSignal()?.throwIfAborted();throw error;}
              }
              continue;
            }
          }
          if(error.invalidAction===true){
            executionSignal()?.throwIfAborted();
            await this.executor.append(task.id,'feedback',{error:error.message});
            continue;
          }
          throw error;
        }finally{clearTimeout(timer);}
        await this.executor.append(task.id,'model_usage',{model:model.name,turn:turns+1,usage:response?.usage??null,failed:false});
        executionSignal()?.throwIfAborted();
        if(Buffer.byteLength(JSON.stringify(response))>this.maxOutputBytes)throw Object.assign(new Error('Model output limit reached'),{limitReached:true});
        action=normalizeAction(response);
        if(action.type==='batch'){
          if(completionOnly||action.actions.length>this.maxBatchCalls||action.actions.length>this.maxCalls-history.calls.length){await this.executor.append(task.id,'feedback',{error:'Batch exceeds the current action budget; propose fewer calls.'});continue;}
          await this.executor.append(task.id,'action_batch',{id:randomUUID(),actions:action.actions});continue;
        }
        await this.executor.append(task.id,'model_response',{...action,usage:response.usage??null});
        await this.checkExecution(actor,task);
        if(completionOnly&&!['finish','wait'].includes(action.type)){
          await this.executor.finish(task.id,{status:'waiting',reason:'limit'});break;
        }
        if(action.type==='delegate'){
          let intent;
          try{intent=await this.delegations.prepare(actor,task,action.input);}catch(error){if(![400,403,409].includes(error.statusCode))throw error;await this.executor.append(task.id,'feedback',{error:'Delegation rejected: '+error.message});continue;}
          await this.executor.delegate(task.id,intent);break;
        }
        if(action.type==='wait'){
          await this.executor.append(task.id,'feedback',{question:action.question});
          await this.executor.finish(task.id,{status:'waiting',reason:'input'});break;
        }
        if(action.type==='finish'){
          // Verifier is application code; model cannot modify it or its required scope.
          const verification=capability.validateOutput(action.result)?verificationResult(await capability.implementation.verify(task.input,action.result,{actor,history})):{verified:false,feedback:'The proposed result does not match the declared output schema. Correct its structure before submitting again.'};
          const valid=verification.verified;
          executionSignal()?.throwIfAborted();
          await this.executor.append(task.id,'verification',verification);
          if(valid){await this.executor.finish(task.id,{status:'succeeded',result:action.result});break;}
          continue;
        }
        } // A pending batch consumes no additional model request.
        if(batch){if(task.authority)await this.authority.checkContext({actor,task,history});await this.context.revalidateHistory({history,actor,dispatcher:this.dispatcher});}
        const selected=this.dispatcher.capabilities.get(action.name);
        // Preserve a bound Mandate's fail-closed interruption before ordinary
        // out-of-scope feedback; tool narrowing does not relax that contract.
        if(capability.implementation.tools.includes(action.name)&&selected?.implementation.kind==='function')await this.checkMandate(actor,task,action.name);
        if(!allowedTools.includes(action.name)||selected?.implementation.kind!=='function'
          ||(capability.implementation.allowCall&&await capability.implementation.allowCall(task.input,action,{actor,task})!==true)){
          if(batch)await this.executor.append(task.id,'action_batch_closed',{id:batch.id,reason:'scope_rejected'});
          await this.executor.append(task.id,'feedback',{error:'Requested capability is outside this task scope'});continue;
        }
        await this.checkExecution(actor,task);
        await this.checkMandate(actor,task,action.name);
        if(remainingByTool[action.name]===0){
          if(batch)await this.executor.append(task.id,'action_batch_closed',{id:batch.id,reason:'tool_limit'});
          await this.executor.append(task.id,'feedback',{error:'Tool attempt limit reached for this Task; no new call was prepared or executed.',capability:action.name});continue;
        }
        if(this.handoffs)await this.handoffs.checkTool({actor,task,action});
        if(task.authority)await this.authority.checkTool({actor,task,action});
        const prepare=batch?this.executor.prepareBatchAction.bind(this.executor):this.executor.prepare.bind(this.executor);
        const call=await prepare(task.id,{capability:action.name,input:action.input,effect:selected.effect,actionRef:batch?.reference??null});
        if(batch){
          const persisted=(await this.store.history(actor,task.id)).calls.find(c=>c.id===call.id);
          if(call.action_ref!==batch.reference||persisted?.action_ref!==batch.reference)throw fail('Batch action receipt was not durably preserved; no dispatch occurred',503);
        }
        if(task.authority)await this.authority.admitTool({actor,task,action,callId:call.id});
        await this.executor.dispatch(task.id,call.id);
        try{
          const result=await this.dispatcher.invoke(action.name,action.input,{actor,taskId:task.id,callId:call.id,signal:executionSignal(),allowedCapabilities:allowedTools});
          const wait=selected.waitReady?await selected.waitReady(action.input,result,{actor})!==true:false;
          await this.executor.settle(task.id,call.id,{result,wait});
          if(task.authority)await this.authority.settleTool({task,callId:call.id,outcome:'returned'}).catch(()=>{});
          if(wait)break;
        }catch(error){
          const unknown=error.outcomeUnknown===true;
          if(task.authority)await this.authority.settleTool({task,callId:call.id,outcome:'unknown'}).catch(()=>{});
          await this.executor.settle(task.id,call.id,{error,unknown});
          if(!unknown&&Array.isArray(error.validation))await this.executor.append(task.id,'feedback',{error:'Tool input failed schema validation; correct its JSON types and required fields.',capability:action.name,validation:error.validation.slice(0,10).map(({instancePath,keyword,message})=>({path:String(instancePath).slice(0,200),keyword,message}))});
          if(!unknown&&error.preflightRejected===true)await this.executor.append(task.id,'feedback',{error:'Tool input failed preflight before execution; no operation was executed. Correct the input using the capability requirements.',capability:action.name});
          if(unknown){await this.executor.finish(task.id,{status:'waiting',reason:'external_result'});break;}
        }
      }
    }catch(error){
      const current=await this.store.get(actor,task.id);
      if(current.status==='running')await this.executor.finish(task.id,{status:'waiting',reason:error.code==='TOKEN_BALANCE_INSUFFICIENT'?'token_balance':error.code==='USAGE_RECONCILIATION_REQUIRED'?'usage_reconciliation':error.limitReached?'limit':'interrupted',error:String(error.message||error)});
    }
    return this.store.get(actor,task.id);
  }
  async stop(){clearInterval(this.timer);this.timer=null;if(this.running)await this.running;if(this.executor)await this.executor.close();this.executor=null;}
}

function normalizeAction(response){
  if(response?.type==='batch'&&Array.isArray(response.actions)&&response.actions.length>=2&&response.actions.length<=8&&response.actions.every(a=>a?.type==='call'&&typeof a.name==='string'&&a.input&&typeof a.input==='object'&&!Array.isArray(a.input)))return {type:'batch',actions:response.actions.map(a=>({type:'call',name:a.name,input:a.input}))};
  if(response?.type==='delegate'&&response.input&&typeof response.input==='object'&&!Array.isArray(response.input))return {type:'delegate',input:response.input};
  if(response?.type==='call'&&typeof response.name==='string'&&response.input&&typeof response.input==='object'&&!Array.isArray(response.input))return {type:'call',name:response.name,input:response.input};
  if(response?.type==='finish'&&response.result!==undefined)return {type:'finish',result:response.result};
  if(response?.type==='wait'&&typeof response.question==='string'&&response.question.trim())return {type:'wait',question:response.question};
  throw new Error('Model returned an invalid action');
}

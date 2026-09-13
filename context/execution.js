import {AsyncLocalStorage} from 'node:async_hooks';
const execution=new AsyncLocalStorage();
export const executionSignal=()=>execution.getStore()?.signal;
export function withExecutionSignal(signal,operation){return execution.run({signal},operation);}

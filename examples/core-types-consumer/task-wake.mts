import {TaskWake,taskWakeIntent} from '@immedi/iaic-core/notifications/task-wake.js';
import type {TaskWakeOptions} from '@immedi/iaic-core/notifications/task-wake.js';
export const compose=(options:TaskWakeOptions<{subjectId:string}>)=>new TaskWake(options);
export function policy(options:TaskWakeOptions<{subjectId:string}>) {
 const wake=compose(options);
 return ()=>wake.pump({limit:20,after:null});
}
if(typeof TaskWake!=='function'||typeof taskWakeIntent!=='function')throw Error('Missing wake exports');
console.log(JSON.stringify({taskWakeTypes:true,independentModule:true}));

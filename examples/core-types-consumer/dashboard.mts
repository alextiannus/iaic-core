import {createOperationsDashboard} from '@immedi/iaic-core/operations/dashboard.js';
import type {DashboardOptions} from '@immedi/iaic-core/operations/dashboard.js';
export function mount(options:DashboardOptions<{subjectId:string}>) {return createOperationsDashboard(options);}
if(typeof createOperationsDashboard!=='function')throw Error('Missing packaged dashboard export');

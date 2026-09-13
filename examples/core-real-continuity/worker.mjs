import {Pool} from 'pg';import {openApplication} from '@immedi/iaic-core/developer/templates/agent/app.mjs';
import {options} from './config.mjs';
const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL,options:'-c search_path='+process.env.IAIC_CONTINUITY_SCHEMA});let app;
try{app=await openApplication({pool,...options});const task=await app.runtime.tick();console.log(JSON.stringify({id:task?.id,status:task?.status,reason:task?.waiting_reason,error:task?.error}));}finally{await app?.close();await pool.end();}

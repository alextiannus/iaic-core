import {Pool} from 'pg';
import {PostgresExecutionJournal,RecoverableDockerSandbox} from '@immedi/iaic-core';
const pool=new Pool({connectionString:process.env.SUBMISSION_TEST_DATABASE_URL||process.env.DATABASE_URL,options:`-c search_path=${process.env.RECOVERY_SCHEMA}`});
const journal=new PostgresExecutionJournal({pool,namespace:'fixture'});
const sandbox=new RecoverableDockerSandbox({journal,image:process.env.RECOVERY_IMAGE,command:['node','/work/main.mjs'],timeoutMs:Number(process.env.RECOVERY_TIMEOUT||30000)});
await sandbox.execute({directory:process.env.RECOVERY_DIRECTORY});
await pool.end();

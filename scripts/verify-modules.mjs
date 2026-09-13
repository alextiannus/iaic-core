import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
if(!process.env.SUBMISSION_TEST_DATABASE_URL)throw new Error('Set SUBMISSION_TEST_DATABASE_URL to an isolated PostgreSQL database; do not silently skip persistent module checks');
const root=fileURLToPath(new URL('../',import.meta.url));
const result=spawnSync(process.execPath,['--test','test'],{cwd:root,env:process.env,stdio:'inherit',timeout:180000});
if(result.error)throw result.error;
process.exitCode=result.status??1;

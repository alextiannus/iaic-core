// Host-only deployment coordination. The DB session lock remains authoritative:
// no clock/lease expiration can authorize takeover of a live session.
export async function executorState(pool){
 const row=(await pool.query('SELECT generation::text,state FROM iaic_executor_ownership WHERE singleton=true')).rows[0];
 return row??{generation:null,state:'released'};
}
export async function requestExecutorDrain(pool,{generation}){
 if(typeof generation!=='string'||! /^[1-9][0-9]{0,18}$/.test(generation))throw Object.assign(new Error('Current executor generation required'),{statusCode:400});
 return (await pool.query("UPDATE iaic_executor_ownership SET state='draining',updated_at=now() WHERE singleton=true AND generation=$1 AND owner_token IS NOT NULL AND state IN ('active','draining') RETURNING generation",[generation])).rowCount===1;
}
export async function takeOwnership(connection,token){
 return (await connection.query(`INSERT INTO iaic_executor_ownership(singleton,generation,owner_token,state) VALUES(true,1,$1,'active')
 ON CONFLICT(singleton) DO UPDATE SET generation=iaic_executor_ownership.generation+1,owner_token=$1,state='active',updated_at=now() RETURNING generation::text`,[token])).rows[0].generation;
}
export async function assertOwnership(connection,{token,generation}){
 const row=(await connection.query('SELECT generation::text,owner_token,state FROM iaic_executor_ownership WHERE singleton=true FOR UPDATE')).rows[0];
 if(!row||row.owner_token!==token||row.generation!==generation||row.state==='released')throw Object.assign(new Error('Executor generation no longer owns execution'),{statusCode:409,code:'EXECUTOR_FENCED'});
 return row;
}

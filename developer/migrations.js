import {createHash} from 'node:crypto';
export async function migratePostgres({pool,namespace,migrations}){
 if(typeof namespace!=='string'||!namespace||namespace.length>200||!Array.isArray(migrations))throw new Error('Migration namespace and ordered manifest required');
 const plan=migrations.map((m,i)=>{if(typeof m.id!=='string'||!m.id||typeof m.sql!=='string'||!m.sql.trim()||(i&&m.id<=migrations[i-1].id))throw new Error('Migration IDs must be unique and ordered; SQL must be nonempty');return {...m,digest:createHash('sha256').update(m.sql).digest('hex')};});
 const c=await pool.connect();try{
  await c.query('BEGIN');await c.query("SELECT pg_advisory_xact_lock(hashtextextended(current_database() || ':' || current_schema() || ':iaic-schema-migrations',0))");
  await c.query('CREATE TABLE IF NOT EXISTS iaic_schema_migrations(namespace text NOT NULL,position integer NOT NULL,id text NOT NULL,digest text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(namespace,id),UNIQUE(namespace,position))');
  const applied=(await c.query('SELECT position,id,digest FROM iaic_schema_migrations WHERE namespace=$1 ORDER BY position',[namespace])).rows;
  for(const [i,m] of applied.entries())if(m.position!==i||plan[i]?.id!==m.id||plan[i]?.digest!==m.digest)throw new Error('Applied migrations were removed, reordered or modified');
  const pending=plan.slice(applied.length);
  for(const [offset,m] of pending.entries()){await c.query(m.sql);await c.query('INSERT INTO iaic_schema_migrations(namespace,position,id,digest) VALUES($1,$2,$3,$4)',[namespace,applied.length+offset,m.id,m.digest]);}
  await c.query('COMMIT');return {namespace,applied:pending.map(m=>m.id),unchanged:applied.length};
 }catch(error){await c.query('ROLLBACK').catch(()=>{});throw error;}finally{c.release();}
}

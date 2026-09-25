import {PersonalApiKeys} from '@immedi/iaic-core/credentials/personal-keys.js';
import {PostgresPersonalKeyStore} from '@immedi/iaic-core/credentials/personal-key-store.js';
import type {PersonalKeyActor,PersonalKeyInput} from '@immedi/iaic-core/credentials/personal-keys.js';
import {Pool} from 'pg';
export function compose(pool:Pool,directory:{namespace:string;current(actor:PersonalKeyActor):Promise<{active:boolean}>}) {
 const store=new PostgresPersonalKeyStore({pool,namespace:directory.namespace});
 return new PersonalApiKeys({store,directory,authorizeManagement:({current})=>current.active,resolveCapabilities:()=>['notes.read']});
}
export const request:PersonalKeyInput={label:'assistant',capabilities:['notes.read'],expiresAt:'2026-10-01T00:00:00Z',requestKey:'explicit-owner-request'};
// @ts-expect-error Issuance cannot omit explicit capabilities.
const invalid:PersonalKeyInput={label:'assistant',expiresAt:'2026-10-01T00:00:00Z',requestKey:'invalid'};
console.log('Personal credential installed public types loaded');

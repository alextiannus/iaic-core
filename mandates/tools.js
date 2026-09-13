import {mandateReferenceSchema} from './service.js';
const name={type:'string',pattern:'^[a-z][a-z0-9_.-]{0,99}$'};
export function mandateTools(service,actor){
 return [
  {name:'my_grant_assistant_mandate',description:'Explicitly authorize recurring or other future Assistant tasks within these capability/tool terms until expiry. Purpose is explanatory, not a data filter. Existing account permissions and platform allowance still apply.',inputSchema:{type:'object',properties:{requestKey:{type:'string',minLength:1,maxLength:200},capability:name,tools:{type:'array',items:name,minItems:1,maxItems:100,uniqueItems:true},purpose:{type:'string',minLength:1,maxLength:4000},expiresAt:{type:'string',minLength:1,maxLength:100}},required:['requestKey','capability','tools','purpose','expiresAt'],additionalProperties:false},handler:input=>service.grant(actor,input)},
  {name:'my_read_assistant_mandate',description:'Read immutable Mandate terms and revocation time under the current owner.',inputSchema:mandateReferenceSchema,handler:input=>service.read(actor,input.id)},
  {name:'my_list_assistant_mandates',description:'List owned Mandates, including expired and revoked records. Pagination is by ID, not a concurrent insertion snapshot.',inputSchema:{type:'object',properties:{after:{type:'string'},limit:{type:'integer',minimum:1,maximum:50}},additionalProperties:false},handler:input=>service.list(actor,input)},
  {name:'my_revoke_assistant_mandate',description:'Permanently revoke this Mandate for future execution. Retrying returns the same revocation. In-flight actions may finish; this does not undo their effects.',inputSchema:mandateReferenceSchema,handler:input=>service.revoke(actor,input.id)}
 ];
}

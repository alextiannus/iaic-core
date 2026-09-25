import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
export class ScopeCursor {
 constructor(key){if(!(key instanceof Uint8Array)||key.byteLength!==32)throw Error('Operations needs a persistent 32-byte cursor key');this.key=Buffer.from(key);}
 seal(binding,next){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key,iv);return Buffer.concat([iv,c.update(JSON.stringify({version:1,binding,next}),'utf8'),c.final(),c.getAuthTag()]).toString('base64url');}
 open(token,binding){try{if(typeof token!=='string'||token.length>4096||! /^[A-Za-z0-9_-]+$/.test(token))throw Error();const b=Buffer.from(token,'base64url');if(b.length<29)throw Error();const c=createDecipheriv('aes-256-gcm',this.key,b.subarray(0,12));c.setAuthTag(b.subarray(-16));const value=JSON.parse(Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString('utf8'));if(value.version!==1||value.binding!==binding||typeof value.next!=='string')throw Error();return value.next;}catch{throw Object.assign(Error('Invalid operations continuation'),{statusCode:400});}}
}

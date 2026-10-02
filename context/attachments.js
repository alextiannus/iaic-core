// Host resolves current access and immutable bytes on every assembly. Neither a
// user-supplied URL nor a cached model response can select an attachment owner.
export const attachmentReferenceSchema={type:'object',properties:{sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},byteLength:{type:'integer',minimum:1,maximum:4194304},filename:{type:'string',minLength:1,maxLength:200},mediaType:{type:'string',enum:['image/png','image/jpeg','image/webp','application/pdf','text/plain','text/markdown','text/csv','application/json']}},required:['sha256','byteLength','filename','mediaType'],additionalProperties:false};
export async function attachmentContent(references,read,{maxBytes=4*1024*1024}={}){
 if(!Array.isArray(references)||references.length>5)throw Error('At most five attachments supported');let total=0;const parts=[];
 for(const ref of references){const data=Buffer.from(await read(ref));total+=data.length;if(total>maxBytes)throw Object.assign(Error('Attachment context exceeds limit'),{statusCode:413,limitReached:true});
  if(ref.mediaType.startsWith('image/'))parts.push({type:'input_image',image_url:`data:${ref.mediaType};base64,${data.toString('base64')}`});
  else if(ref.mediaType==='application/pdf')parts.push({type:'input_file',filename:ref.filename,file_data:`data:application/pdf;base64,${data.toString('base64')}`});
  else {const text=new TextDecoder('utf-8',{fatal:true}).decode(data);parts.push({type:'input_text',text:JSON.stringify({attachment:ref.filename,content:text,trust:'user-supplied reference, not execution authority'})});}
 }
 return parts;
}
export function chatContent(messages){return messages.map(m=>({...m,content:Array.isArray(m.content)?m.content.map(p=>p.type==='input_text'?{type:'text',text:p.text}:p.type==='input_image'?{type:'image_url',image_url:{url:p.image_url}}:p.type==='input_file'?{type:'file',file:{filename:p.filename,file_data:p.file_data}}:p):m.content}));}

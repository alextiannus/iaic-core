import {openFixture} from './fixture.mjs';
const fixture=await openFixture();console.log(JSON.stringify({url:fixture.url,username:'operator',password:fixture.password,localFixtureOnly:true}));
for(const signal of ['SIGINT','SIGTERM'])process.once(signal,()=>{fixture.close().then(()=>process.exit(0));});

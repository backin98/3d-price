const fs=require('node:fs');const vm=require('node:vm');const assert=require('node:assert/strict');
let saved;const desk={modelUrl:'http://localhost:1234',workerUrl:'',shops:[{id:'keep'}],banners:[{id:'banner'}],promoted:[]};
const context={URL,Response,crypto:require('node:crypto'),store:{readJSON:async(key,fallback)=>key==='desk.json'?desk:fallback,writeJSON:async(key,value)=>{saved=value},deleteKey:async()=>{}},auth:{ownerFromHeaders:()=>({role:'owner'}),authReady:()=>true}};
let source=fs.readFileSync('netlify/functions/admin.mjs','utf8').replace(/^import .*;$/gm,'').replace('export default async','globalThis.handler = async');vm.runInNewContext(source,context);
const request=body=>new Request('https://example.com/api/admin',{method:'POST',headers:{origin:'https://example.com','content-type':'application/json'},body:JSON.stringify(body)});
(async()=>{
 let result=await context.handler(request({action:'saveModelConnection',url:'http://127.0.0.1:1235/v1/',workerUrl:'http://127.0.0.1:8788/'}));assert.equal(result.status,200);assert.equal(saved.modelUrl,'http://127.0.0.1:1235/v1');assert.equal(saved.workerUrl,'http://127.0.0.1:8788');assert.equal(saved.shops,desk.shops);assert.ok(saved.modelCheckId);
 const body=await result.json();assert.equal(body.desk.modelUrl,saved.modelUrl);assert.equal(body.desk.workerUrl,saved.workerUrl);
 result=await context.handler(request({action:'saveModelConnection',url:'http://127.0.0.1:1235'}));assert.equal(result.status,200);assert.equal(saved.modelUrl,'http://127.0.0.1:1235');assert.equal(saved.workerUrl,'http://127.0.0.1:8788');
 desk.workerUrl='http://127.0.0.1:1235';
 result=await context.handler(request({action:'saveModelConnection',url:'http://127.0.0.1:1235'}));assert.equal(result.status,200);assert.equal(saved.workerUrl,'http://127.0.0.1:8788');
 result=await context.handler(request({action:'saveMatchSettings',autoLlmMatch:true}));assert.equal(result.status,200);assert.equal(saved.autoLlmMatch,true);
 result=await context.handler(request({action:'saveMatchSettings',autoLlmMatch:false}));assert.equal(result.status,200);assert.equal(saved.autoLlmMatch,false);
 for(const url of ['file:///tmp','http://user:pass@localhost','invalid']){result=await context.handler(request({action:'saveModelConnection',url}));assert.equal(result.status,400);}
 result=await context.handler(new Request('https://example.com/api/admin',{method:'POST',headers:{origin:'https://evil.example'},body:'{}'}));assert.equal(result.status,405);
 context.auth.ownerFromHeaders=()=>null;
 console.log('PASS: connection persistence, existing content preserved, URL validation and cross-origin rejection.');
})().catch(e=>{console.error(e);process.exitCode=1});

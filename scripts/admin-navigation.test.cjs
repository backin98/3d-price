const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ids = ['overview','catalog','shops','runs','merch','jobs','ai'];
const panels = ids.map(id => ({id:'tab-'+id,hidden:false}));
const links = ids.map(tab => ({dataset:{tab},classList:{toggle(){}},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]}}));
const nodes = new Map();
function node(sel) { if(!nodes.has(sel)) nodes.set(sel,{hidden:true,innerHTML:'',textContent:'',value:'',contains:()=>false}); return nodes.get(sel); }
let poll, calls=0;
const data={desk:{shops:[],banners:[],promoted:[]},catalog:{products:[],filaments:[]},jobs:[]};
const context={URL,document:{querySelector:node,querySelectorAll:sel=>sel==='.tab-panel'?panels:links},location:{hash:''},window:{},setInterval:fn=>{poll=fn;return 1},clearInterval(){},setTimeout(){},clearTimeout(){},fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>data}}};
let source=fs.readFileSync('public/admin/admin.js','utf8').replace('  init();','  globalThis.test = {state, render, selectPage, startPolling, shopsHtml, merchHtml, overviewHtml, runsHtml, shopCategories, categoryNames, categoryUrlForShop};');
vm.runInNewContext(source,context);
context.test.state.data=data;
context.test.render();
for(const id of [...ids,'invalid','toString']) {
 context.location.hash='#'+id; context.test.selectPage();
 const expected=ids.includes(id)?id:'overview';
 assert.deepEqual(panels.filter(p=>!p.hidden).map(p=>p.id),['tab-'+expected]);
 assert.equal(links.filter(l=>l['aria-current']==='page')[0].dataset.tab,expected);
}
assert.match(context.test.shopsHtml(data),/add-shop-form/);
assert.match(context.test.shopsHtml({desk:{shops:[{id:'s1',name:'Robolink',url:'https://shop.example',categories:[]}]}}),/shop-card/);
assert.match(context.test.runsHtml(data),/id="run-cat"/);
assert.match(context.test.runsHtml(data),/id="run-shop"/);
const mixed={desk:{shops:[
 {id:'rhino3dprinter.com',name:'Rhino',url:'https://www.rhino3dprinter.com',categories:[{id:'c1',name:'3D Yazıcılar',url:'https://www.rhino3dprinter.com/3d-yazicilar'}]},
 {id:'robolinkmarket.com',name:'Robolink',url:'https://www.robolinkmarket.com',categories:[{id:'c2',name:'Filament',url:'https://www.robolinkmarket.com/filament'}],categoryIds:['c1']}
],banners:[],promoted:[]},catalog:{products:[],filaments:[]},jobs:[]};
const robolinkCard=context.test.shopsHtml(mixed);
assert.match(robolinkCard,/robolinkmarket.com\/filament/);
assert.doesNotMatch(robolinkCard.split('Robolink')[1].split('shop-card')[0] || robolinkCard,/rhino3dprinter.com\/3d-yazicilar/);
assert.equal(context.test.shopCategories(mixed.desk.shops[1]).map(c=>c.url).join('|'),'https://www.robolinkmarket.com/filament');
assert.equal(context.test.categoryNames(mixed).join('|'),'3D Yazıcılar|Filament');
assert.equal(context.test.categoryUrlForShop(mixed.desk.shops[1],'Filament'),'https://www.robolinkmarket.com/filament');
assert.equal(context.test.categoryUrlForShop(mixed.desk.shops[1],'3D Yazıcılar'),'');
assert.match(robolinkCard,/value="Filament"/);
assert.match(robolinkCard,/value="3D Yazıcılar"/);
const idleRuns=context.test.runsHtml(mixed);
assert.match(idleRuns,/value="Filament"/);
assert.match(idleRuns,/value="3D Yazıcılar"/);
assert.doesNotMatch(idleRuns,/rhino3dprinter.com\/3d-yazicilar/);
assert.doesNotMatch(idleRuns,/robolinkmarket.com\/filament/);
const rhinoJobRuns=context.test.runsHtml({...mixed,jobs:[{id:'j1',status:'queued',url:'https://www.rhino3dprinter.com/3d-yazicilar',kind:'printer'}]});
assert.match(rhinoJobRuns,/rhino3dprinter.com\/3d-yazicilar/);
assert.doesNotMatch(rhinoJobRuns,/robolinkmarket.com\/filament/);
assert.match(fs.readFileSync('public/admin/admin.js','utf8'),/id="ai-url"/);
assert.match(fs.readFileSync('public/admin/admin.js','utf8'),/notifyWorker/);
assert.match(fs.readFileSync('public/admin/admin.js','utf8'),/delete-all-catalog/);
assert.doesNotMatch(context.test.merchHtml(data),/add-shop-form/);
assert.doesNotMatch(context.test.overviewHtml(data),/quick-run/);
assert.match(fs.readFileSync('public/admin/admin.css','utf8'),/\[hidden\] \{ display: none !important; \}/);
(async()=>{
 context.test.startPolling();
 node('#login').hidden=false; await poll(); assert.equal(calls,0);
 node('#login').hidden=true; await poll(); await new Promise(resolve=>setImmediate(resolve)); assert.equal(calls,1);
 console.log('PASS: six pages, fallback routing, active navigation, shop separation, overview, login visibility, authenticated polling.');
})().catch(err=>{console.error(err);process.exitCode=1});


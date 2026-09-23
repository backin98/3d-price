const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ids = ['overview','catalog','baseline','shops','runs','uncertain','merch','jobs','ai'];
const panels = ids.map(id => ({id:'tab-'+id,hidden:false}));
const links = ids.map(tab => ({dataset:{tab},classList:{toggle(){}},setAttribute(k,v){this[k]=v},removeAttribute(k){delete this[k]}}));
const nodes = new Map();
function node(sel) { if(!nodes.has(sel)) nodes.set(sel,{hidden:true,innerHTML:'',textContent:'',value:'',contains:()=>false}); return nodes.get(sel); }
let poll, calls=0;
const data={desk:{shops:[],banners:[],promoted:[]},catalog:{products:[],filaments:[]},jobs:[]};
const listeners=[];
const context={URL,document:{querySelector:node,querySelectorAll:sel=>sel==='.tab-panel'?panels:links,addEventListener:(t,fn,c)=>listeners.push({t,fn,capture:c===true})},location:{hash:''},window:{},setInterval:fn=>{poll=fn;return 1},clearInterval(){},setTimeout(){},clearTimeout(){},fetch:async()=>{calls++;return {ok:true,status:200,json:async()=>data}}};
let source=fs.readFileSync('public/admin/admin.js','utf8').replace('  init();','  globalThis.test = {state, render, selectPage, startPolling, shopsHtml, merchHtml, overviewHtml, runsHtml, shopCategories, categoryNames, categoryUrlForShop, catalogHtml, baselineHtml, uncertainHtml, collectUncertain, productCard, rememberDetails, openAttr, rowsWithRemainingShops, remainingRunShops, runCategoryFromRows};');
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
assert.match(context.test.shopsHtml({desk:{shops:[{id:'s1',name:'Robolink',url:'https://shop.example',categories:[]}]}}),/name="page2"/);
assert.match(context.test.shopsHtml({desk:{shops:[{id:'s1',name:'Robolink',url:'https://shop.example',categories:[]}]}}),/shop-card/);
assert.match(context.test.runsHtml(data),/id="run-cat"/);
assert.match(context.test.runsHtml(data),/id="run-shop"/);
assert.match(context.test.runsHtml(data),/id="add-all-shops"/);
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
assert.match(robolinkCard,/data-update-shop-prices="robolinkmarket.com"/);
assert.match(robolinkCard,/Save &amp; update prices/);
assert.match(robolinkCard,/data-purge-shop="robolinkmarket.com"/);
assert.match(robolinkCard,/value="3D Yazıcılar"/);
const idleRuns=context.test.runsHtml(mixed);
assert.match(idleRuns,/value="Filament"/);
assert.match(idleRuns,/value="3D Yazıcılar"/);
assert.doesNotMatch(idleRuns,/rhino3dprinter.com\/3d-yazicilar/);
assert.doesNotMatch(idleRuns,/robolinkmarket.com\/filament/);
const filled=[{shop:'rhino3dprinter.com',cat:'3D Yazıcılar',url:'https://www.rhino3dprinter.com/3d-yazicilar'}];
const added=context.test.rowsWithRemainingShops(mixed, filled);
assert.equal(added.added, 1, 'add all fills the shops that are not already listed');
assert.equal(added.rows[1].shop, 'robolinkmarket.com');
assert.equal(added.rows[1].cat, '3D Yazıcılar', 'new rows keep the category already selected');
assert.equal(added.rows[1].url, '', 'Robolink has no 3D Yazıcılar URL, so the dropdown can still be changed');
assert.match(context.test.runsHtml({...mixed, jobs:[]}), /id="add-all-shops"/);
const rhinoJobRuns=context.test.runsHtml({...mixed,jobs:[{id:'j1',status:'queued',url:'https://www.rhino3dprinter.com/3d-yazicilar',kind:'printer'}]});
assert.match(rhinoJobRuns,/rhino3dprinter.com\/3d-yazicilar/);
assert.doesNotMatch(rhinoJobRuns,/robolinkmarket.com\/filament/);
assert.match(context.test.baselineHtml(data),/Recommended by the worker/);
assert.doesNotMatch(context.test.baselineHtml(data),/id="baseline-from-catalog"/);
assert.doesNotMatch(context.test.baselineHtml(data),/id="baseline-from-run"/);
assert.match(context.test.runsHtml(data),/Shop run time/);
assert.match(context.test.baselineHtml(data),/id="baseline-add-cat"/);
assert.doesNotMatch(context.test.baselineHtml(data),/id="baseline-shop"/);
const bl=context.test.baselineHtml({baseline:{categories:[{id:'printers',name:'3D Printers'},{id:'filaments',name:'Filament'}],items:[{id:'p1',name:'P1S',brand:'Bambu Lab',category:'printers'}]}});
assert.match(bl,/Change category/);
assert.match(bl,/data-baseline-move="p1"/);
assert.match(bl,/data-baseline-image="p1"/);
assert.match(bl,/data-baseline-cat-save="printers"/);
assert.match(bl,/<textarea[^>]*data-baseline-field="name"/);
assert.match(bl,/3D Printers/);
assert.doesNotMatch(bl,/listing/);
assert.match(fs.readFileSync('public/admin/admin.css','utf8'),/overflow-wrap: anywhere/);
assert.match(context.test.runsHtml({...mixed,jobs:[{id:'j1',status:'running',url:'https://www.rhino3dprinter.com/3d-yazicilar',kind:'printer'}]}),/id="abort-all"/);
assert.match(context.test.runsHtml({...mixed,jobs:[{id:'j1',status:'running',url:'https://www.rhino3dprinter.com/3d-yazicilar',kind:'printer'}]}),/Abort job/);
assert.match(fs.readFileSync('public/admin/index.html','utf8'),/data-tab="baseline"/);
assert.match(fs.readFileSync('public/admin/index.html','utf8'),/data-tab="uncertain"/);
context.test.state.data.catalog={products:[{id:'p1',name:'P1S',offers:[]}],filaments:[]};
context.test.state.catalogSelected.add('p1');
assert.match(context.test.catalogHtml(context.test.state.data),/Update catalog \(1\)/);
assert.doesNotMatch(context.test.catalogHtml(context.test.state.data),/id="update-catalog" disabled/);
context.test.state.catalogSelected.clear();
context.test.state.data.baseline={items:[{id:'bl-p1s',name:'Bambu Lab P1S',brand:'Bambu Lab',category:'printers'}]};
const uh=context.test.uncertainHtml({desk:{shops:[]},catalog:{products:[],filaments:[]},jobs:[{id:'j1',url:'https://www.rhino3dprinter.com/3d',cards:{'https://shop.example/mystery':{url:'https://shop.example/mystery',name:'Unmatched mystery',kind:'printer',decision:{action:'held',reason:'gray band'},laya:{action:'hold',reason:'still unsure'}}}}]});
assert.match(uh,/Unmatched mystery/);
assert.match(uh,/Force publish/);
assert.match(uh,/Add to baseline/);
assert.match(uh,/data-uncertain-baseline=/);
assert.match(uh,/aria-label="Delete this card"/);
assert.match(uh,/data-review-place-q=/);
assert.match(uh,/data-place-open=/);
assert.match(uh,/data-review-place=/);
assert.match(uh,/Baseline · Bambu Lab P1S/);
assert.match(uh,/Type to search baseline/);
assert.doesNotMatch(uh,/merge:p1/, 'Uncertain goes to baseline models, not catalog rows');
assert.match(uh,/Laya: still unsure/);
assert.match(uh,/rhino3dprinter.com/);
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
 // The catalog must show where an offer came from and how to regroup it.
context.test.state.data = {
  desk: { shops: [], banners: [], promoted: [] },
  catalog: {
    savedAt: new Date().toISOString(),
    products: [{
      id: 'qwen-k2', name: 'Creality K2 Combo', brand: 'Creality', kind: 'printer', aisle: 'fdm', price: 76084.79, sourceTitle: 'x',
      axes: { combo: true, ams: '', variant: '', mini: false, laser: '', label: 'Combo' },
      offers: [
        { store: 'rhino3dprinter.com', price: 32384.81, url: 'https://www.rhino3dprinter.com/creality-k2-combo-3d-yazici', sourceTitle: 'Creality K2 Combo 3D Yazıcı' },
        { store: 'rhino3dprinter.com', price: 76084.79, url: 'https://www.rhino3dprinter.com/urun/creality-k2-plus-combo', sourceTitle: 'Creality K2 Plus Combo 3D Yazıcı - 300x300x300 mm' }
      ]
    }], filaments: []
  },
  candidate: { products: [], filaments: [] }, jobs: []
};
const cat = context.test.catalogHtml(context.test.state.data);
assert.match(cat, /2 offers — source, scraped title, worker title/, 'the panel is labelled');
assert.match(cat, /scraped: Creality K2 Plus Combo 3D Yazıcı - 300x300x300 mm/, 'the scraped title is shown');
assert.match(cat, /worker: Creality K2 Combo/, 'the worker title is shown');
assert.match(cat, /urun\/creality-k2-plus-combo/, 'the source url slug is shown');
assert.match(cat, /data-offer-branch="https:\/\/www.rhino3dprinter.com\/urun\/creality-k2-plus-combo"/);
assert.match(cat, /data-offer-move="https:\/\/www.rhino3dprinter.com\/urun\/creality-k2-plus-combo"/);
assert.match(cat, /id="catalog-targets"/, 'one shared target list for the whole page');
assert.match(cat, /id="catalog-refresh"/, 'and a refresh button');
assert.match(cat, /data-product-image="qwen-k2"/, 'each catalog card has a manual thumbnail upload');
// Catalog edits publish in one clear action; duplicate repair stays in its guarded inbox.
assert.match(cat, /axis-badge/, 'each row is badged with its axis');
assert.match(cat, /Bare/, 'a bare row says Bare');
assert.match(cat, /id="update-catalog" disabled/, 'the catalog update button starts clean');
assert.doesNotMatch(cat, /Merge selected/, 'the broken manual merge-selected action is gone');
assert.match(cat, /Find duplicate groups/, 'the duplicates inbox has a trigger');
assert.match(cat, /<details class="danger-zone"[^>]*>/, 'delete-all and the bulk merge live in a danger zone');
assert.match(cat, /Merge exact-title duplicates \(all at once\)/, 'the bulk merge is named honestly');
assert.equal(/id="delete-all-catalog"[^]{0,200}id="collapse-duplicates"/.test(cat), true, 'both danger buttons are inside that zone');
context.test.state.data.catalog.products.push({ id: 'qwen-p1s', name: 'Bambu Lab P1S Combo 3D Yazıcı', brand: 'Bambu Lab', kind: 'printer', offers: [{ store: 'a', price: 10, url: 'https://a/x' }] });
context.test.state.editing.set('qwen-k2', { name: 'Creality K2 updated' });
assert.match(context.test.catalogHtml(context.test.state.data), /Update catalog \(1\)/, 'pending product edits are published together');
context.test.state.editing.clear();
context.test.state.dupes = { clusters: [{ key: 'k', name: 'Creality K2 Combo', exact: true, keeperId: 'qwen-k2', rows: [{ id: 'qwen-k2', name: 'Creality K2 Combo', offers: 2, axes: { label: 'Combo' }, stores: ['a'] }, { id: 'qwen-p1s', name: 'Creality K2 Combo', offers: 1, axes: { label: 'Combo' }, stores: ['b'] }] }], blocked: [{ a: { id: 'x', name: 'P1S' }, b: { id: 'y', name: 'P1S Combo' }, conflicts: ['combo'] }] };
const withDupes = context.test.catalogHtml(context.test.state.data);
assert.match(withDupes, /Duplicates inbox/);
assert.match(withDupes, /data-merge-cluster="k"/, 'one group at a time can be merged');
assert.match(withDupes, /possible duplicate of/, 'the row itself carries the hint');
assert.match(withDupes, /must not merge/, 'blocked pairs are shown');
// The triangle must survive the 5s poll that rebuilds the page HTML.
const t = context.test;
// The markup carries its own ontoggle, so it works whatever order bind() ran in.
assert.match(t.catalogHtml(t.state.data), /ontoggle="window\.__keepOpen&&window\.__keepOpen\(this\)"/, 'each disclosure remembers itself inline');
assert.equal(typeof context.window.__keepOpen, 'function', 'and the global exists');
assert.equal(t.openAttr('offers:qwen-k2'), '', 'closed by default');
// Called the way the inline handler calls it: the element itself, not an event.
t.rememberDetails({ dataset: { detailKey: 'offers:qwen-k2' }, open: true });
assert.equal(t.openAttr('offers:qwen-k2'), ' open', 'opening an element is remembered in state');
assert.match(t.catalogHtml(t.state.data), /data-detail-key="offers:qwen-k2" open/, 'so the re-render keeps it open');
t.rememberDetails({ dataset: { detailKey: 'danger' }, open: true });
assert.match(t.catalogHtml(t.state.data), /data-detail-key="danger" open/, 'the danger zone too');
// A delegated listener would pass an event instead; both shapes must work.
t.rememberDetails({ target: { dataset: { detailKey: 'blocked' }, open: true } });
assert.equal(t.openAttr('blocked'), ' open', 'event shape works too');
t.rememberDetails({ dataset: { detailKey: 'offers:qwen-k2' }, open: false });
assert.equal(t.openAttr('offers:qwen-k2'), '', 'closing is remembered as well');
assert.doesNotMatch(t.catalogHtml(t.state.data), /data-detail-key="offers:qwen-k2" open/, 'and stays closed after a re-render');
t.rememberDetails({ target: { dataset: {} } });
t.rememberDetails({});
assert.ok(true, 'a toggle from an unrelated element is ignored');
console.log('PASS: six pages, fallback routing, active navigation, shop separation, overview, login visibility, authenticated polling, disclosure state.');
})().catch(err=>{console.error(err);process.exitCode=1});


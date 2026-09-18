const BASE = 'https://www.robolinkmarket.com';
let imageManifest = {};
try { imageManifest = require('../public/assets/robolink/manifest.json'); } catch { /* First import builds the manifest. */ }
const { parseMoney } = require('../lib/parse-money.cjs');
const decode = s => String(s || '').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ').trim();
const pick = (s,re) => decode((s.match(re)||[])[1]);
const priceTL = s => parseMoney(s);
function parseRobolink(html, kind) {
  return html.split(/<div class="[^"]*\bproduct-item"[^>]*>/).slice(1).flatMap(block => {
    if (/out-of-stock|>\s*Tükendi\s*</i.test(block)) return [];
    const path = pick(block, /<a href="([^"#]+)" class="image-wrapper/);
    const name = pick(block, /class="image-wrapper[^"]*" title="([^"]+)"/);
    let price = priceTL(pick(block, /class="yeni-fiyat[^"]*">\s*([^<]+)/));
    if (!path || !name || !price || !/addToCart\(/.test(block)) return [];
    let was = priceTL(pick(block, /class="eski-fiyat[^"]*">\s*([^<]+)/));
    if (was && price > was) { const t = price; price = was; was = t; }
    const alt = pick(block, /alt="([^"]+)"/);
    const rawBrand = alt.startsWith(name + ' - ') ? alt.slice(name.length+3) : name.split(' ')[0];
    const aliases = {elegoo:'Elegoo',esun:'eSUN',flashforge:'Flashforge',creality:'Creality','creality 3d':'Creality',polymaker:'Polymaker',bambu:'Bambu Lab','bambu lab':'Bambu Lab'};
    const brand = aliases[rawBrand.toLowerCase()] || rawBrand;
    const originalImage = pick(block, /<source srcset="([^"]+)"/) || pick(block, /data-src="([^"]+)"/);
    const image = imageManifest[originalImage] || originalImage;
    const url = new URL(path, BASE).href;
    const id = pick(block, /addToCart\((\d+)/);
    return [{id:'robo-'+id,sourceId:'robolink',source:'Robolink Market',name,brand,kind,
      aisle:kind==='filament'?'filament':'fdm',unit:brand,image,originalImage,url,
      currency:{code:'TRY',symbol:'TL',position:'after',decimals:2},
      offers:[{store:'Robolink Market',price,was:was>price?was:undefined,url,image,km:null}]}];
  });
}
async function page(url) {
  const r = await fetch(url,{signal:AbortSignal.timeout(15000)});
  if (!r.ok) throw new Error('Robolink HTTP '+r.status);
  return r.text();
}
async function huntRobolink(kind) {
  const url = BASE+(kind==='filament'?'/filament':'/3d-yazicilar?multi=5-67');
  const first = await page(url);
  const last = Math.max(1,...[...first.matchAll(/[?&]pg=(\d+)/g)].map(m=>Number(m[1])));
  if(last>80) throw new Error('Robolink pagination exceeded limit');
  let products = parseRobolink(first,kind);
  for(let start=2;start<=last;start+=6) {
    const urls=Array.from({length:Math.min(6,last-start+1)},(_,i)=>url+(url.includes('?')?'&':'?')+'pg='+(start+i));
    const pages=await Promise.all(urls.map(page));
    pages.forEach(html=>products.push(...parseRobolink(html,kind)));
  }
  return [...new Map(products.map(p=>[p.url,p])).values()];
}
module.exports={huntRobolink,parseRobolink};

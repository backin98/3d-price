const { classifyFilament } = require('./filament-classify');
const { printerMatchKey } = require('./match-products');
const fold = s => String(s || '').toLowerCase().replace(/ı/g,'i').replace(/grey/g,'gray').replace(/\s+/g,' ').trim();
const allowed = url => /^(https:\/\/|assets\/)/i.test(url || '') && !/^https:\/\/witcdn\.robolinkmarket\.com\//i.test(url);
function imageKey(p) {
  if (p.kind !== 'filament') return printerMatchKey(p);
  const weight = fold(p.weight).match(/^(\d+(?:\.\d+)?)\s*(kg|gr|g)$/);
  if (!p.color || !weight || p.polymer === 'other') return null;
  const grams = Number(weight[1]) * (weight[2] === 'kg' ? 1000 : 1);
  return JSON.stringify([fold(p.brand),p.polymer,p.variant,fold(p.color),grams,p.diameter,
    p.packaging === 'refill' ? 'refill' : 'spool']);
}
function resolveImages(products, references = []) {
  const index = new Map();
  for (const p of [...products,...references]) {
    const key = imageKey(p);
    if (!key) continue;
    const images = [{url:p.image,store:p.imageSource || p.source},...(p.offers || []).map(o=>({url:o.image,store:o.store}))].filter(i=>allowed(i.url));
    if (!index.has(key)) index.set(key,[]);
    index.get(key).push(...images);
  }
  return products.map(p=>({...p, fallbackImages:[...new Map((index.get(imageKey(p)) || []).map(i=>[i.url,i])).values()]}));
}
function manufacturerImages(products) {
  return products.flatMap(p=>{
    // Use only explicitly identified, single-spool products with color-specific photos.
    if (!/1kg/.test(p.handle) || /rfid|emoji|pro|pack|bundle/i.test(p.title)) return [];
    return (p.variants || []).flatMap(v=>{
      const color = v.option1;
      if (!color || /\/|default|refill/i.test(color) || v.option2 || v.option3) return [];
      const image = (p.images || []).find(i=>(i.variant_ids || []).includes(v.id));
      if (!image) return [];
      const product = classifyFilament({name:`Elegoo ${p.title} 1 kg 1.75 mm - ${color}`,brand:'Elegoo'});
      return [{...product,color:color.replace(/^ASA /,''),image:image.src,imageSource:'ELEGOO (manufacturer)'}];
    });
  });
}
async function loadManufacturerImages() {
  try {
    const r = await fetch('https://us.elegoo.com/collections/filaments/products.json?limit=250',{signal:AbortSignal.timeout(6000)});
    if(!r.ok) return [];
    return manufacturerImages((await r.json()).products || []);
  } catch { return []; }
}
module.exports = { resolveImages, manufacturerImages, loadManufacturerImages, imageKey };

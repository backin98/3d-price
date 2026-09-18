const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {huntRobolink} = require('../api/robolink');
const dir = path.join(__dirname,'../public/assets/robolink');
const manifestFile = path.join(dir,'manifest.json');
async function main() {
  fs.mkdirSync(dir,{recursive:true});
  const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile,'utf8')) : {};
  const catalog = (await Promise.all(['printer','filament'].map(huntRobolink))).flat();
  const urls = [...new Set(catalog.map(p=>p.originalImage || p.image).filter(u=>/^https:\/\/witcdn\.robolinkmarket\.com\//.test(u)))];
  const manifest = {...previous};
  let imported=0;
  for(let start=0;start<urls.length;start+=6) {
    await Promise.all(urls.slice(start,start+6).map(async url=>{
      if(previous[url] && fs.existsSync(path.join(dir,path.basename(previous[url])))) {imported++;return;}
      // Ordinary public download: no cookies, authorization or spoofed referrer.
      const response = await fetch(url,{signal:AbortSignal.timeout(15000)});
      if(!response.ok || !/^image\/(jpeg|png|webp)/.test(response.headers.get('content-type') || '')) throw new Error('Invalid image response: '+url);
      const bytes = Buffer.from(await response.arrayBuffer());
      const type = bytes.subarray(0,3).toString('hex')==='ffd8ff'?'jpg':bytes.subarray(1,4).toString()==='PNG'?'png':bytes.subarray(8,12).toString()==='WEBP'?'webp':null;
      if(!type || bytes.length<1000) throw new Error('Invalid image file: '+url);
      const file = crypto.createHash('sha256').update(url).digest('hex').slice(0,24)+'.'+type;
      fs.writeFileSync(path.join(dir,file),bytes);
      manifest[url]='assets/robolink/'+file;
      imported++;
    }));
  }
  fs.writeFileSync(manifestFile,JSON.stringify(manifest,null,2));
  console.log(`Imported ${imported}/${urls.length} Robolink product thumbnails`);
}
main().catch(e=>{console.error(e);process.exit(1);});

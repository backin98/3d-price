"use strict";

// What a shop listing IS: printer, filament, accessory (a spare part or an add-on module), laser,
// scanner, resin or other. A shop run holds everything that is not the category's own type out of
// the run (harvest.js reports it as a category mismatch), so this decides what reaches the shelf.
//
// Printer shelves are full of printer words that do not make a printer: a hotend "for" an A1, a
// fan "for" an X1, an upgrade kit "for" a K1, a bed spring "for" 3D printers. The old rule called
// anything with a printer brand in its title a printer, so those were published as printers.
//
// The rules, in order (on the folded title, see product-match.cjs fold):
//   1. With a printer noun ("3D Yazıcı", "3D Printer"), it is a printer — unless the title says it
//      is FOR a printer ("için", "uyumlu", "compatible") or a part word directly follows the noun
//      ("3D Yazıcı Tabla Yayı"). A part word after a separator is a feature of the printer
//      ("... 3D Yazıcı - Çift Nozul, 350°C Hotend"), and so is one before the noun ("Çift Nozullu").
//   2. Without one: filament-adjacent gear, then laser engravers and scanners, then bundles of a
//      printer model ("X1 Carbon AMS 2 Pro Bundle", "H2C Laser Full Combo 10W"), then part words,
//      then add-on modules (AMS, CFS, QIDI Box — a printer only next to a printer model code),
//      then filament and resin, then printer brands and model words.

// The same fold as product-match.cjs (which re-exports this module, so it cannot be required here).
const fold = (s) => String(s || "").toLocaleLowerCase("tr").replace(/ı/g, "i").replace(/ş/g, "s").replace(/ç/g, "c")
  .replace(/ğ/g, "g").replace(/ü/g, "u").replace(/ö/g, "o")
  .replace(/(pro|plus|max|mini|ultra|lite|neo|turbo|se|ke|xl)combo\b/g, "$1 combo")
  .replace(/(\d)(pro|plus|max|mini|ultra|lite|neo|turbo|se|ke|xl)\b/g, "$1 $2")
  .replace(/[^a-z0-9]+/g, " ").trim();

const PRINTER_BRANDS = [
  "kobra", "bambulab", "bambu", "qiditech", "qidi", "creality", "anycubic",
  "snapmaker", "flashforge", "elegoo", "prusa", "flsun", "artillery",
  "iemai", "sovol", "kingroon", "raise3d", "ankermake", "twotrees", "voron", "zaxe", "wanhao"
];

// The noun that makes the listing a printer.
const PRINTER_NOUN = /\b(?:3d (?:yazici(?:si|lar|lari)?|printer)|yazici(?:si)?|printer)\b/g;
// On the raw title, to find where the noun ends and what follows it.
const RAW_PRINTER_NOUN = /3d\s*yaz[ıi]c[ıi](?:s[ıi]|lar|lar[ıi])?|3d\s*printer|yaz[ıi]c[ıi](?:s[ıi])?|printer/giu;

// The listing is for a printer, not a printer.
const COMPATIBLE = /\b(?:icin|uyumlu|uyumludur|compatible)\b/;

// A spare part or tool: the product IS this.
const PART = new RegExp("\\b(?:" + [
  "hot ?end", "hotendi?", "nozul(?:u|lar|seti)?", "nozzles?", "meme(?:si)?", "fan(?:i|lari)?", "heat ?break",
  "termistor", "thermistor", "isitici", "heater(?: block)?", "isitma blogu", "silikon", "silicone", "corap", "sock",
  "tabla(?:si|yi|lari)?", "yay(?:i|lari)?", "build plate", "plate", "plakasi?", "pei", "somun(?:u)?", "vida(?:si)?",
  "rulman", "bearing", "kayis(?:i)?", "belt", "kasnak", "pulley", "disli(?:si)?", "gear",
  "motor(?:u)?", "anakart", "mainboard", "motherboard", "kontrol karti", "board", "sensor(?:u)?", "bltouch", "probe",
  "kablo(?:su)?", "cable", "ekran(?:i)?", "display", "extruder", "ekstruder", "feeder",
  "upgrade", "yukseltme", "donusum", "conversion", "yedek", "parca(?:si|lari)?", "spare", "replacement",
  "aksesuar(?:i|lari)?", "accessor(?:y|ies)", "spatula", "scraper", "temizleme", "cleaning", "igne(?:si)?", "needle",
  "yag", "grease", "lube", "yapistirici", "glue", "tutkal", "makara tutucu", "spool holder", "filament tutucu",
  "hub", "enclosure", "kabin", "muhafaza", "guc kaynagi", "power supply", "adaptor", "adapter", "kamera", "camera",
  "wiper", "lidar"
].join("|") + ")\\b");

// Add-on modules: a colour/feeding/drying unit on its own, or part of a printer bundle.
const MODULE = /\b(?:ams(?: lite| 2 pro| ht| pro)?|cfs(?: c)?|qidi box|box|renk modulu|color module|multi ?colou?r kit|cok renkli baski modulu|lazer modulu|laser module)\b/;

// A bundle of a printer with extras: "Combo", "Bundle", "Özel Set", "(Kamera Hediyeli)".
const BUNDLE = /\b(?:bundle|combo|ozel set|hediyeli|hediye|dahil|birlikte)\b/;

// Printer model codes: X1, X1C, P1S, A1, H2D, K2, Q2C, U1, Z3S, MK4 ... (letters then 1–2 digits).
// Part numbers (FAH021, FAF002: three digits) and modules ("AMS 2") do not match.
const MODEL_CODE = /\b(?!ams\b|cfs\b)[a-z]{1,3}\d{1,2}[a-z]{0,3}\b|\b(?:x1 carbon|centauri|adventurer|core one|kobra|ender|neptune)\b/;

const LASER = /\b(?:lazer|laser)\b/;
const LASER_MACHINE = /\b(?:gravur|kazima|kesici|kesim|engraver|engraving|cutter|cutting)\b/;
const FILAMENT_GEAR = /\b(?:kurutucu|dryer|drybox|kurutma|saklama|poset|poseti|pompa|vakum|vakumlu)\b/;

function lastIndexOf(re, text) {
  let last = -1;
  const g = new RegExp(re.source, "g");
  let m;
  while ((m = g.exec(text))) {
    last = m.index;
    if (m[0] === "") g.lastIndex += 1;
  }
  return last;
}

// The words right after the LAST printer noun, up to the first separator: a part word there names
// the product ("3D Yazıcı Tabla Yayı"); one after a dash or comma describes the printer.
function wordsAfterPrinterNoun(raw) {
  const s = String(raw || "").toLocaleLowerCase("tr");
  let end = -1;
  const re = new RegExp(RAW_PRINTER_NOUN.source, "giu");
  let m;
  while ((m = re.exec(s))) end = m.index + m[0].length;
  if (end < 0) return "";
  const tail = s.slice(end);
  const head = tail.split(/\s[-–—|:]\s|[,;(|/]|\s[-–—]/)[0];
  return fold(head);
}

// "... Kamera ile", "... with Camera", "... Nozul Dahil", "(Kamera Hediyeli)": the part comes WITH the
// printer, it is not the product.
const FEATURE = /\b(?:ile|with|dahil|included|hediyeli|hediye|birlikte)\b/;

function classifyProductType(name, brand) {
  const raw = String(name || "");
  const t = fold(raw);
  if (!t) return fold(brand) ? "other" : "other";

  const hasPrinterNoun = lastIndexOf(PRINTER_NOUN, t) >= 0;
  const compatible = COMPATIBLE.test(t);
  const part = PART.test(t);
  const module = MODULE.test(t);

  if (hasPrinterNoun) {
    if (compatible && (part || module)) return "accessory";
    const after = wordsAfterPrinterNoun(raw);
    // "3D Yazıcı Filamenti", "3D Yazıcı Reçinesi": the printer is only what it is for.
    if (/^(?:icin )?(?:filament(?:i|leri)?)\b/.test(after)) return "filament";
    if (/^(?:icin )?(?:recine(?:si)?|resin)\b/.test(after)) return "resin";
    if (PART.test(after) && !FEATURE.test(after)) return "accessory";
    return "printer";
  }

  if (FILAMENT_GEAR.test(t)) return "accessory";
  const withBrand = t + " " + fold(brand);
  if (LASER.test(t) && (LASER_MACHINE.test(t) || /\bxtool\b|\bfalcon\b/.test(withBrand)) && !BUNDLE.test(t)) return "laser";
  if (/\bxtool\b/.test(withBrand) && !MODEL_CODE.test(t)) return "laser";
  if (/\b(?:tarayici|scanner)\b/.test(t) || /\brevopoint\b/.test(withBrand)) return "scanner";

  const model = MODEL_CODE.test(t);
  // "Bambu Lab X1 Carbon AMS 2 Pro Bundle", "Adventurer 5X & Enclosed Kit Bundle (Kamera Hediyeli)",
  // "H2C Laser Full Combo 10W": a printer model sold with extras is a printer — unless the extra is
  // the product ("... Upgrade Kit", "... için").
  if (BUNDLE.test(t) && (model || PRINTER_BRANDS.some((b) => withBrand.includes(b))) && !compatible
    && !/\b(?:upgrade|yukseltme|donusum|conversion|yedek|parca|spare|replacement)\b/.test(t)) return "printer";
  if (part || compatible) return "accessory";
  if (module) return model ? "printer" : "accessory";

  if (/\b(?:filamentleri|filamenti|filament)\b/.test(t)) return "filament";
  // A spool's diameter or net weight: "1.75 mm", "2.85mm", "750g", "1 kg".
  if (/\b(?:1 75|2 85) ?mm\b/.test(t) || (/\b\d{3,4} ?gr?\b|\b\d ?kg\b/.test(t) && /\b(?:pla|petg|abs|asa|tpu|pa\w*|pc|peba|cf\d*|gf\d*)\b/.test(t))) return "filament";
  if (/\b(?:recine|resin)\b/.test(t) && !/\b(?:photon|msla|sla)\b/.test(t)) return "resin";
  if (/\b(?:pla|petg|abs|asa|tpu|tpe|pa|pc|pva|hips|peba|paht|ppa|pps|peek|pekk|ultrafuse)\b/.test(t) && !model) return "filament";
  if (/\b(?:kobra|ender|msla|fdm|sla|duplicator)\b/.test(t)) return "printer";
  if (PRINTER_BRANDS.some((b) => withBrand.includes(b))) return "printer";
  if (/\b(?:pla|petg|abs|asa|tpu)\b/.test(t)) return "filament";
  return "other";
}

module.exports = { classifyProductType, PRINTER_BRANDS };

# Learning eval: photo colour reader, Laya retrain, trust report

Run on the owner's PC, 2026-10-03, on deploy-ready at `9fce6a3` (includes 9fce6a3). No code changed.

## 1. Photo colour reader (`npm run eval-colours -- --limit 60 --worst 12`)

```
> eval-colours
> node scripts/eval-swatch-colours.cjs --limit 60 --worst 12
Cards with a shade you picked and a photo: 366 (checking 60)
(60 progress dots)
read 60 photos (0 failed to load, 0 had no usable colour)
photo reader vs your pick:  median 32.1   within 5: 12%   within 10: 17%   over 15: 80%
generic table colour:       median 14.7   (48 cards)
when it is 60%+ sure:       median 33.5   (49 of 60 photos)
Furthest misses (send these back so the reader can be tuned):
   77  you #dcdbd3  reader #181c1f (100%)  Flashforge High Speed PLA Filament - Natural
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z0djOXJKYjRQSVl5OA/p/flashforge-high-speed-pla-filament-natural-5764517730663-sw800sh800.webp
   72  you #dbdfe0  reader #1f2841 (13%)  Sunlu Petg Filament - Seramik
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/6a2d32927f95b-94901067-sw956sh955.webp
   69  you #efc51d  reader #2b2925 (100%)  Porima PLA Filament - 1Kg - Sarı
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/68bf02c4b430f-15511048-sw1200sh1800.webp
   65  you #149be4  reader #e0d431 (19%)  Bambu Lab PLA Basic CMYK Filament Lithophane Bundle
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z0hNOXJKYnNQSVl5OA/p/bambu-lab-pla-cmyk-lithophane-bundle-96608814-sw1500sh1500.webp
   58  you #d2b2a1  reader #282827 (100%)  Porima PLA Filament - 1Kg - Ten
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/68bf037df1270-14922388-sw1200sh1800.webp
   57  you #0b282f  reader #cea07e (81%)  Esun PLA+ HS Filament (Hyper Speed) - Yeşil
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/6960c47d33b18-74433983-sw1024sh1221.webp
   54  you #73f069  reader #234d1f (24%)  ELAS Yeşil GLOW PLA+ Filament 1.75mm 1 Kg
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z0djOXJKYjRQSVl5OA/p/elas-yesil-glow-pla-filament-175mm-05-kg-5795241038455-sw1080sh1080.webp
   52  you #1c2135  reader #c29270 (84%)  Esun PLA+ HS Filament (Hyper Speed) - Dark Blue
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/69ad53cd9b747-20968859-sw1024sh1186.webp
   43  you #9756be  reader #af845c (96%)  Esun Basic PLA Filament - Grape Purple
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/6a0ac3397f797-79128325-sw1500sh1500.webp
   43  you #175245  reader #b49170 (83%)  Esun Basic PLA Filament - Holly Green
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/6a0ac2d11c301-91485726-sw1500sh1500.webp
   42  you #55993b  reader #252825 (100%)  Porima PLA Filament - 1Kg - Yeşil 6018
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/68bf032d9b5b4-56000279-sw1200sh1800.webp
   40  you #16d7b3  reader #d3a174 (69%)  Esun PLA+ HS Filament (Hyper Speed) - Jade Green
       https://cdn.qukasoft.com/f/443764/b3NXVUoyVTArYkI4Tmk4Z1RvTTZKYms9/p/69b6c78e36dbd-15875498-sw1024sh1129.webp
```

## 2. Laya retrain

```
npm run laya-data
laya-baseline.json: 306 models (87 printers kept, 219 filament models added)
laya-learned-pairs.json: 2394 pairs from your decisions (799 same, 1595 different)
Next, on the PC with the Laya environment:
  .venv-laya\Scripts\python scripts\laya-match.py --train

python scripts/laya-match.py --train
{"saved": "C:\\Users\\AbdulrahmanBitar\\Documents\\3d_Price\\data\\laya-catalog-head.pt", "items": 306, "pairs": 10385, "accuracy": 0.9232, "falseMerges": 27, "evalAccuracy": 0.9039, "evalFalseMerges": 10}
```

data/laya-catalog-head.pt was retrained locally (790209 bytes, 2026-10-03 21:06) and is NOT committed.

## 3. Trust report (`npm run trust-report -- --misses 6`)

```
Hand-edited cards: 1071  (what the run makes from the listing title, against what you set)
field           cards   agree %  covered %  wrong|predicted %
brand            1071       100        100                  0
polymer          1067      99.7       99.9                0.2
variant           897      69.3       90.7               23.6
color            1071      89.4       91.1                1.9
weight           1071       100        100                  0
diameter         1071       100        100                  0
packaging        1071      98.4        100                1.6
spoolMaterial     953      88.9       89.2                0.4
subBrand           75       100        100                  0
Note: spool material and sub-brand were learned from these same cards, so their scores here are generous.
The honest score (each card predicted from all the others) is printed by: npm run learn -- --check
polymer — first 3 misses:
  Polymaker Fiberon PA612-CF15 Filament Siyah (0.5 KG)                    you: pa  run: (none)
  Polymaker Fiberon PA12-CF10 Filament Siyah (0.5 KG)                     you: pa12  run: pa
  Polymaker Fiberon PA6-GF25 Filament - Gri                               you: pa6  run: pa
variant — first 6 misses:
  Porima Pastel PLA Filament - Rainbow                                    you: pastel+rainbow  run: rainbow
  Porima Silk PLA Filament - Rainbow                                      you: rainbow+silk  run: silk
  Porima PLA Premium Filament - Rainbow                                   you: plus+rainbow  run: rainbow
  ELAS Mavi GLOW PLA+ Filament 1.75mm 1 Kg                                you: plus  run: glow
  Porima PLA Star Filament - Rainbow                                      you: galaxy+rainbow  run: rainbow
  Polymaker Fiberon PETG-rCF08 Filament Siyah (0.5 KG)                    you: cf  run: (none)
color — first 6 misses:
  Fibromast Glow PETG Filament                                            you: transparent green  run: (none)
  Bambu Lab PLA Basic CMYK Filament Lithophane Bundle                     you: white+white+white+white  run: (none)
  Elas PETG Filament - Ten                                                you: ten  run: (none)
  Elas PETG Filament - Mermer                                             you: mermer  run: (none)
  Elas PETG Filament - Antrasit                                           you: antrasit  run: (none)
  Elas PETG Filament Makarasız - Ten                                      you: ten  run: (none)
packaging — first 6 misses:
  Porima Eco PLA Filament - Siyah                                         you: refill  run: spool
  Porima Eco PLA Filament - Beyaz                                         you: refill  run: spool
  Porima Eco PLA Filament - Gri                                           you: refill  run: spool
  Porima Eco PLA Filament - Kırmızı                                       you: refill  run: spool
  Porima Eco PLA Filament - Sarı                                          you: refill  run: spool
  Porima Eco PLA Filament - Mavi 5003                                     you: refill  run: spool
spoolMaterial — first 6 misses:
  Polymaker Fiberon PETG-rCF08 Filament Siyah (0.5 KG)                    you: cardboard  run: (none)
  Fibromast Glow PETG Filament                                            you: plastic  run: (none)
  Polymaker Fiberon PA12-CF10 Filament Siyah (0.5 KG)                     you: cardboard  run: (none)
  Polymaker Fiberon PA6-GF25 Filament - Gri                               you: cardboard  run: (none)
  Snapmaker Siyah Naylon Filament (1 kg)                                  you: cardboard  run: (none)
  Flashforge PLA Pro Filament - Gri                                       you: plastic  run: (none)
```

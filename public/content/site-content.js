/**
 * =============================================================================
 *  3D PRICE — TRANSLATION FILE  (the only file you need to edit for wording)
 * =============================================================================
 *
 *  HOW TO TRANSLATE
 *  1. Open this file in any text editor (Notepad, VS Code, etc.).
 *  2. Change only the text inside "quotes". Leave commas, braces { } and
 *     colons : exactly as they are.
 *  3. Save the file, then refresh the website in your browser.
 *
 *  ARABIC / HEBREW / OTHER RIGHT-TO-LEFT LANGUAGES
 *    Set  lang: "ar"   (or "he", …)
 *    Set  dir:  "rtl"
 *    The layout will flip automatically.
 *
 *  Do not rename the keys on the left (brand, header, hunter, …).
 *  You may add extra products, locations, banner slides, or aisle names.
 * =============================================================================
 */

window.SITE_CONTENT = {
  /* Language code for the page (en, ar, fr, …). */
  lang: "en",

  /* "ltr" = left-to-right,  "rtl" = right-to-left. */
  dir: "ltr",

  /* Shown in the browser tab. */
  documentTitle: "3D Price — find your next best price",

  /* -------------------------------------------------------------------------- */
  /* Brand                                                                      */
  /* -------------------------------------------------------------------------- */
  brand: {
    name: "3D Price",
    short: "3D",
    tagline: "Product. Place. Price."
  },

  /* How money is printed. position: "before" → $12   "after" → 12 $           */
  currency: {
    code: "USD",
    symbol: "$",
    position: "before",
    decimals: 2
  },

  units: {
    km: "{n} km",
    off: "{n}% off",
    vat: "incl. VAT"
  },

  /* -------------------------------------------------------------------------- */
  /* Header — sticky tabs + search + icons                                      */
  /* -------------------------------------------------------------------------- */
  header: {
    skipToContent: "Skip to hunt",
    newTab: "New hunt",
    newTabAria: "Open a new hunt tab",
    closeTabAria: "Close this hunt",
    searchPlaceholder: "Search a product",
    searchSubmitAria: "Search",
    locationAria: "Choose location",
    homeAria: "Home",
    cartAria: "Saved deals",
    profileAria: "Profile",
    defaultTab: "Hunt {n}",
    languageAria: "Language"
  },

  /* Language switcher at the top. Add more { id, label, dir } later. */
  languages: [
    { id: "en", label: "EN", dir: "ltr" },
    { id: "tr", label: "TR", dir: "ltr" }
  ],

  /* -------------------------------------------------------------------------- */
  /* Banner carousel (the big image under the header)                           */
  /* -------------------------------------------------------------------------- */
  banners: [
    {
      image: "assets/banners/aisle.jpg",
      kicker: "Tonight’s aisle",
      title: "Walk the aisle. Leave with the lowest ticket.",
      subtitle: "We scan nearby shelves so you don’t have to."
    },
    {
      image: "assets/banners/warehouse.jpg",
      kicker: "Bulk & local",
      title: "Pallets or corner shop — we pick the cheaper one.",
      subtitle: "Same product, every store in range, one number."
    },
    {
      image: "assets/banners/electronics.jpg",
      kicker: "Tech shelves",
      title: "Gadgets, scanned nightly.",
      subtitle: "If the price dropped since yesterday, it shows in green."
    }
  ],

  /* -------------------------------------------------------------------------- */
  /* Main hunt — the question in the middle of the page                         */
  /* -------------------------------------------------------------------------- */
  hunter: {
    lead: "What will we find you next?",
    stamp: "for the Best Price!",
    placeholder: "Name a product…",
    find: "Find it",
    clearAria: "Clear search",
    locationHint: "Area · {location}",
    dotsAria: "Banner slides"
  },

  live: {
    aisle: "FDM printers",
    loading: "Scanning Rhino, Metatech, 3D Teknomarket and Robolink Market — printers and filament…",
    error: "Could not reach the shops. Try Find it again.",
    results: "{n} in stock",
    resultsBoth: "{p} printers · {f} spools",
    open: "Open shop",
    openStore: "Open {store}",
    storesCount: "{n} shops",
    compared: "Matched",
    preorder: "Pre-order",
    online: "online",
    hint: "Find it searches Rhino, Metatech, 3D Teknomarket and Robolink Market, then matches like-for-like prices.",
    printersWorld: "Printers",
    filamentWorld: "Filament",
    filterAisle: "Aisle",
    printerResults: "Printers",
    printerHint: "Narrow with the filters. The shelf follows.",
    aisles: [
      { id: "fdm", name: "FDM printers" },
      { id: "renk-modulu", name: "Color module" },
      { id: "renk-modulu-aksesuari", name: "Color module accessory" },
      { id: "filament-kurutucu", name: "Filament dryer" }
    ]
  },

  /* Filament bay — polymer → type → brand price → colors */
  filament: {
    crumb: "Filament",
    back: "Back",
    polymersTitle: "Pick the polymer",
    polymersHint: "Base material first. Types, brands, then colors.",
    variantsTitle: "{polymer} types",
    variantsHint: "Same polymer, different recipes.",
    brandsTitle: "{polymer} {variant}",
    brandsHint: "Same type, compared by brand.",
    colorsTitle: "{brand} {polymer} {variant}",
    colorsHint: "Now the colors.",
    fromPrice: "from {price}",
    priceRange: "{min} – {max}",
    spoolCount: "{n} spools",
    colorCount: "{n} colors",
    brandCount: "{n} brands",
    cheapest: "Lowest",
    empty: "No in-stock spools for this cut.",
    hitsTitle: "Top matches",
    hitsHint: "Ranked for “{q}”. The list follows what you pick.",
    hitsCount: "{n} matches",
    filtersTitle: "Filters",
    filterPolymer: "Polymer",
    filterType: "Type",
    filterBrand: "Brand",
    resultsTitle: "Spools",
    resultsHint: "Narrow with the filters. The shelf follows.",
    order: [
      "pla",
      "plabs",
      "petg",
      "pet",
      "abs",
      "asa",
      "tpu",
      "pc",
      "pa",
      "ppa",
      "pps",
      "pekk",
      "peek",
      "pek",
      "pva",
      "hips",
      "pp",
      "other"
    ],
    polymers: {
      pla: "PLA",
      plabs: "PLABS",
      petg: "PETG",
      pet: "PET",
      abs: "ABS",
      asa: "ASA",
      tpu: "TPU",
      pc: "PC",
      pa: "PA",
      ppa: "PPA",
      pps: "PPS",
      pekk: "PEKK",
      peek: "PEEK",
      pek: "PEK",
      pva: "PVA",
      hips: "HIPS",
      pp: "PP",
      other: "Other"
    },
    variants: {
      standard: "Standard",
      plus: "Plus",
      "plus-hs": "Plus Rapid",
      rapid: "Rapid",
      silk: "Silk",
      rainbow: "Rainbow",
      pure: "Pure",
      cf: "Carbon fiber",
      gf: "Glass fiber",
      glow: "Glow",
      marble: "Marble",
      wood: "Wood",
      tough: "Tough",
      semiflex: "Semi-flex",
      matte: "Matte",
      basic: "Basic",
      combo: "Combo"
    }
  },

  /* -------------------------------------------------------------------------- */
  /* Aisles (the 3D columns of deals)                                           */
  /* -------------------------------------------------------------------------- */
  aisles: [
    { id: "grocery", name: "Grocery" },
    { id: "tech", name: "Tech" },
    { id: "home", name: "Home" },
    { id: "sport", name: "Sport" }
  ],
  aisleArrowAria: "This aisle is selected",
  emptyAisle: "Nothing on this shelf yet.",
  emptySearchTitle: "No matches on the shelf",
  emptySearchBody: "Try another word, or clear the hunt to see every aisle.",
  resultsCount: "{n} deals",
  bestOffer: "Best",
  wasPrice: "was {price}",
  distanceAway: "{distance} away",
  saveDeal: "Save",
  savedDeal: "Saved",
  viewOffers: "All offers",
  offerCount: "{n} stores",

  /* -------------------------------------------------------------------------- */
  /* Products — translate names, units, store names. Keep "id" and "aisle"      */
  /*            and image paths unless you add your own photos.                 */
  /* -------------------------------------------------------------------------- */
  products: [
    {
      id: "olive",
      aisle: "grocery",
      name: "Extra virgin olive oil",
      unit: "750 ml",
      image: "assets/products/olive-oil.jpg",
      offers: [
        { store: "Harbor Mart", price: 8.4, was: 11.9, km: 1.2 },
        { store: "City Co-op", price: 9.1, km: 0.6 },
        { store: "North Bulk", price: 7.95, was: 10.5, km: 4.8 }
      ]
    },
    {
      id: "coffee",
      aisle: "grocery",
      name: "Arabica coffee beans",
      unit: "1 kg",
      image: "assets/products/coffee.jpg",
      offers: [
        { store: "City Co-op", price: 14.2, was: 16.0, km: 0.6 },
        { store: "Harbor Mart", price: 15.5, km: 1.2 }
      ]
    },
    {
      id: "rice",
      aisle: "grocery",
      name: "Long-grain rice",
      unit: "5 kg",
      image: "assets/products/rice.jpg",
      offers: [
        { store: "North Bulk", price: 6.3, km: 4.8 },
        { store: "Harbor Mart", price: 7.8, was: 9.2, km: 1.2 },
        { store: "City Co-op", price: 7.4, km: 0.6 }
      ]
    },
    {
      id: "earbuds",
      aisle: "tech",
      name: "Wireless earbuds",
      unit: "pair",
      image: "assets/products/earbuds.jpg",
      offers: [
        { store: "Screen Barn", price: 29.0, was: 49.0, km: 2.1 },
        { store: "Harbor Mart", price: 34.5, km: 1.2 }
      ]
    },
    {
      id: "lamp",
      aisle: "home",
      name: "Brass desk lamp",
      unit: "each",
      image: "assets/products/lamp.jpg",
      offers: [
        { store: "Home Yard", price: 42.0, was: 55.0, km: 3.0 },
        { store: "City Co-op", price: 48.0, km: 0.6 }
      ]
    },
    {
      id: "kettle",
      aisle: "home",
      name: "Matte electric kettle",
      unit: "1.5 L",
      image: "assets/products/kettle.jpg",
      offers: [
        { store: "Home Yard", price: 24.9, km: 3.0 },
        { store: "Screen Barn", price: 27.0, was: 32.0, km: 2.1 }
      ]
    },
    {
      id: "shoes",
      aisle: "sport",
      name: "Road running shoes",
      unit: "pair",
      image: "assets/products/shoes.jpg",
      offers: [
        { store: "Sport Lane", price: 68.0, was: 90.0, km: 1.8 },
        { store: "Harbor Mart", price: 74.0, km: 1.2 }
      ]
    },
    {
      id: "bottle",
      aisle: "sport",
      name: "Steel water bottle",
      unit: "750 ml",
      image: "assets/products/bottle.jpg",
      offers: [
        { store: "Sport Lane", price: 12.5, km: 1.8 },
        { store: "City Co-op", price: 11.9, was: 14.0, km: 0.6 },
        { store: "North Bulk", price: 13.2, km: 4.8 }
      ]
    }
  ],

  /* -------------------------------------------------------------------------- */
  /* Google ads slots (replace inner markup later with your AdSense code)       */
  /* -------------------------------------------------------------------------- */
  ads: {
    label: "Google ads",
    hint: "Ad slot"
  },

  /* -------------------------------------------------------------------------- */
  /* Locations — replace with your real cities / areas.                         */
  /* -------------------------------------------------------------------------- */
  locations: [
    { id: "near", name: "Near me" },
    { id: "downtown", name: "Downtown" },
    { id: "harbor", name: "Harbor" },
    { id: "north", name: "North side" },
    { id: "mall", name: "Mall district" }
  ],
  locationTitle: "Where should we hunt?",
  locationClose: "Close",

  /* -------------------------------------------------------------------------- */
  /* Saved deals (cart icon)                                                    */
  /* -------------------------------------------------------------------------- */
  cart: {
    title: "Saved deals",
    empty: "No deals saved yet. Tap Save on a price ticket.",
    remove: "Remove",
    close: "Close"
  },

  /* -------------------------------------------------------------------------- */
  /* Profile (person icon)                                                      */
  /* -------------------------------------------------------------------------- */
  profile: {
    title: "Your hunt",
    greeting: "Hunting from {location}",
    savedCount: "{n} saved deals",
    hint: "Location and saved deals stay on this device.",
    close: "Close"
  },

  /* -------------------------------------------------------------------------- */
  /* Product sheet (all offers for one item)                                    */
  /* -------------------------------------------------------------------------- */
  sheet: {
    title: "Offers",
    close: "Close",
    bestAt: "Best at {store}",
    go: "Open store"
  },

  /* -------------------------------------------------------------------------- */
  /* Footer                                                                     */
  /* -------------------------------------------------------------------------- */
  footer: {
    note: "Live prices from Rhino, Metatech, 3D Teknomarket and Robolink Market. Wording lives in content/site-content.js.",
    copyright: "3D Price"
  },

  /* -------------------------------------------------------------------------- */
  /* Product names from Turkish shops → English (used when language is EN)      */
  /* Exact title first; leftover phrases are replaced longest-first.            */
  /* -------------------------------------------------------------------------- */
  productExact: {
    "FLASHFORGE Adventurer 5X & Enclosed Kit Bundle (Kamera Hediyeli)":
      "FLASHFORGE Adventurer 5X & Enclosed Kit Bundle (camera included)",
    "QIDI Tech Plus5 Combo 3D Yazıcı": "QIDI Tech Plus5 Combo 3D Printer",
    "QIDI Q2C ve Outlet QIDI Box Özel Set": "QIDI Q2C and Outlet QIDI Box Special Set",
    "Flashforge Creator 5 PRO 3d Yazıcı": "Flashforge Creator 5 PRO 3D Printer",
    "Anycubic Kobra 3 V2 Combo 3D Yazıcı": "Anycubic Kobra 3 V2 Combo 3D Printer",
    "Anycubic KOBRA X 3D Yazıcı": "Anycubic KOBRA X 3D Printer",
    "Aktip Tekno AT1000 3D Yazıcı": "Aktip Tekno AT1000 3D Printer",
    "Creality K2 3D Yazıcı": "Creality K2 3D Printer",
    "Snapmaker U1 Yazıcı I Fiyat I İnceleme 2026": "Snapmaker U1 Printer — Price & Review 2026",
    "Bambu Lab A1 Mini Combo 3D Yazıcı - STOKTAN": "Bambu Lab A1 Mini Combo 3D Printer — in stock",
    "QIDI Tech Max4 Combo 3d Yazıcı": "QIDI Tech Max4 Combo 3D Printer",
    "Bambu Lab H2D Laser Full Combo 10W 3d Yazıcı Fiyatı Ve Özellikleri":
      "Bambu Lab H2D Laser Full Combo 10W 3D Printer — price and specs",
    "Flashforge Creator 5 3d Yazıcı": "Flashforge Creator 5 3D Printer",
    "Qidi Box Renk Modülü": "Qidi Box Color Module",
    "Qidi Q2 Combo 3d Yazıcı": "Qidi Q2 Combo 3D Printer",
    "Qidi Q2C 3d Yazıcı": "Qidi Q2C 3D Printer",
    "Qidi Q2C Combo 3d Yazıcı": "Qidi Q2C Combo 3D Printer",
    "Creality K1 Max 3D Yazıcı - 2025 Yeni Versiyon": "Creality K1 Max 3D Printer — 2025 New Version",
    "Bambu Lab H2C Combo 3D Yazıcı": "Bambu Lab H2C Combo 3D Printer",
    "Creality K2 Combo 3D Yazıcı": "Creality K2 Combo 3D Printer",
    "Bambu Lab P2S 3D Yazıcı": "Bambu Lab P2S 3D Printer",
    "Creality K2 Pro Combo 3D Yazıcı": "Creality K2 Pro Combo 3D Printer",
    "Bambu Lab P2S Combo 3D Yazıcı": "Bambu Lab P2S Combo 3D Printer",
    "Creality K1 Serisi CFS Upgrade Kiti": "Creality K1 Series CFS Upgrade Kit",
    "Creality SpacePi X4 Filament Kurutucu": "Creality SpacePi X4 Filament Dryer",
    "Zaxe Z3S 3D Yazıcı": "Zaxe Z3S 3D Printer",
    "Zaxe X4 3D Yazıcı": "Zaxe X4 3D Printer",
    "QIDI Box Çok Renkli Baskı Modülü *Outlet*": "QIDI Box Multicolor Print Module *Outlet*",
    "Bambu Lab P1S 3D Yazıcı": "Bambu Lab P1S 3D Printer",
    "Bambu Lab P1S Combo 3D Yazıcı": "Bambu Lab P1S Combo 3D Printer",
    "Bambu Lab A1 Combo 3D Yazıcı": "Bambu Lab A1 Combo 3D Printer",
    "Bambu Lab X1E Combo 3D Yazıcı": "Bambu Lab X1E Combo 3D Printer",
    "Flashforge Adventurer 5X Renkli 3D Yazıcı": "Flashforge Adventurer 5X Color 3D Printer",
    "QIDI Q2 Box Hub": "QIDI Q2 Box Hub"
  },
  productPhrases: [
    ["3 Renkli", "3-color"],
    ["Naylon", "Nylon"],
    ["Transparan", "Transparent"],
    ["Polikarbon", "Polycarbonate"],
    ["Medikal", "Medical"],
    ["İpek", "Silk"],
    ["Menekse Moru", "Violet"],
    ["Fiyatı Ve Özellikleri", "Price and Specs"],
    ["Fiyat I İnceleme", "Price & Review"],
    ["Yeni Versiyon", "New Version"],
    ["Kamera Hediyeli", "camera included"],
    ["Filament Kurutucu", "Filament Dryer"],
    ["Çok Renkli Baskı Modülü", "Multicolor Print Module"],
    ["Renk Modülü", "Color Module"],
    ["Upgrade Kiti", "Upgrade Kit"],
    ["Özel Set", "Special Set"],
    ["Serisi", "Series"],
    ["3D Yazıcı", "3D Printer"],
    ["3d Yazıcı", "3D Printer"],
    ["3D yazıcı", "3D Printer"],
    ["Renkli 3D", "Color 3D"],
    ["Yazıcı", "Printer"],
    ["STOKTAN", "in stock"],
    ["ve Outlet", "and Outlet"]
  ],

  /* Extra UI copy when TR is selected. English is the default object above. */
  locale: {
    tr: {
      lang: "tr",
      dir: "ltr",
      documentTitle: "3D Price — sıradaki en iyi fiyat",
      brand: {
        tagline: "Ürün. Yer. Fiyat."
      },
      units: {
        vat: "KDV dahil"
      },
      header: {
        skipToContent: "Aramaya geç",
        newTab: "Yeni arama",
        newTabAria: "Yeni arama sekmesi aç",
        closeTabAria: "Bu aramayı kapat",
        searchPlaceholder: "Ürün ara",
        searchSubmitAria: "Ara",
        locationAria: "Konum seç",
        homeAria: "Ana sayfa",
        cartAria: "Kaydedilenler",
        profileAria: "Profil",
        defaultTab: "Arama {n}",
        languageAria: "Dil"
      },
      hunter: {
        lead: "Sırada ne bulalım?",
        stamp: "en iyi fiyata!",
        placeholder: "Bir ürün yazın…",
        find: "Bul",
        clearAria: "Aramayı temizle",
        locationHint: "Bölge · {location}",
        dotsAria: "Banner slaytları"
      },
      live: {
        aisle: "FDM printers",
        loading: "Rhino, Metatech, 3D Teknomarket ve Robolink Market taranıyor — yazıcılar ve filament…",
        error: "Mağazalara ulaşılamadı. Bul’a tekrar basın.",
        results: "{n} stokta",
        resultsBoth: "{p} yazıcı · {f} makara",
        open: "Mağazayı aç",
        openStore: "{store}’ta aç",
        storesCount: "{n} mağaza",
        compared: "Eşleşti",
        preorder: "Ön sipariş",
        online: "çevrimiçi",
        hint: "Bul, Rhino, Metatech, 3D Teknomarket ve Robolink Market’i tarar, sonra aynı ürünleri fiyatlar.",
        printersWorld: "Yazıcılar",
        filamentWorld: "Filament",
        filterAisle: "Raf",
        printerResults: "Yazıcılar",
        printerHint: "Filtrelerle daraltın. Raf onu izler."
      },
      filament: {
        crumb: "Filament",
        back: "Geri",
        polymersTitle: "Polimeri seçin",
        polymersHint: "Önce ana malzeme. Sonra tür, marka, renk.",
        variantsTitle: "{polymer} türleri",
        variantsHint: "Aynı polimer, farklı reçeteler.",
        brandsTitle: "{polymer} {variant}",
        brandsHint: "Aynı tür, markaya göre fiyat.",
        colorsTitle: "{brand} {polymer} {variant}",
        colorsHint: "Sıra renklerde.",
        fromPrice: "{price}’den",
        priceRange: "{min} – {max}",
        spoolCount: "{n} makara",
        colorCount: "{n} renk",
        brandCount: "{n} marka",
        cheapest: "En düşük",
        empty: "Bu kesitte stokta makara yok.",
        hitsTitle: "En yakın sonuçlar",
        hitsHint: "“{q}” için sıralandı. Seçtikçe liste yenilenir.",
        hitsCount: "{n} eşleşme",
        filtersTitle: "Filtreler",
        filterPolymer: "Polimer",
        filterType: "Tür",
        filterBrand: "Marka",
        resultsTitle: "Makaralar",
        resultsHint: "Filtrelerle daraltın. Raf onu izler.",
        variants: {
          standard: "Standart",
          plus: "Plus",
          "plus-hs": "Plus Rapid",
          rapid: "Rapid",
          silk: "İpek",
          rainbow: "Rainbow",
          pure: "Pure",
          cf: "Karbon fiber",
          gf: "Cam elyaf",
          glow: "Glow",
          marble: "Mermer",
          wood: "Ahşap",
          tough: "Tough",
          semiflex: "Semi-flex",
          matte: "Matte",
          basic: "Basic",
          combo: "Combo"
        }
      },
      emptyAisle: "Bu rafta henüz bir şey yok.",
      emptySearchTitle: "Rafta eşleşme yok",
      emptySearchBody: "Başka bir sözcük deneyin, veya aramayı temizleyip tüm rafları görün.",
      resultsCount: "{n} fırsat",
      bestOffer: "En iyi",
      wasPrice: "eski {price}",
      saveDeal: "Kaydet",
      savedDeal: "Kayıtlı",
      viewOffers: "Tüm teklifler",
      offerCount: "{n} mağaza",
      locationTitle: "Nereden arayalım?",
      locationClose: "Kapat",
      cart: {
        title: "Kaydedilenler",
        empty: "Henüz kayıt yok. Bir fiyat etiketinde Kaydet’e basın.",
        remove: "Kaldır",
        close: "Kapat"
      },
      profile: {
        title: "Aramanız",
        greeting: "{location} bölgesinden arama",
        savedCount: "{n} kayıtlı fırsat",
        hint: "Konum ve kayıtlar bu cihazda kalır.",
        close: "Kapat"
      },
      sheet: {
        title: "Teklifler",
        close: "Kapat",
        bestAt: "En iyi: {store}",
        go: "Mağazayı aç"
      },
      footer: {
        note: "Canlı fiyatlar Rhino, Metatech, 3D Teknomarket ve Robolink Market’ten gelir. Metinler content/site-content.js içindedir.",
        copyright: "3D Price"
      }
    }
  }
};

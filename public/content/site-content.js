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
 *  Words in {curly braces} are filled in by the site — keep them as they are.
 *
 *  Banners set in the admin (Storefront tab) replace the default banners
 *  below. With no banners saved there, these defaults are shown.
 * =============================================================================
 */

window.SITE_CONTENT = {
  /* Language code for the page (en, ar, fr, …). */
  lang: "en",

  /* "ltr" = left-to-right,  "rtl" = right-to-left. */
  dir: "ltr",

  /* Shown in the browser tab, and in search results and link previews. */
  documentTitle: "3D Price — compare 3D printer prices in Turkey",
  metaDescription:
    "Compare 3D printer and filament prices across Turkish 3D printing shops. The same model, matched like for like, with the best in-stock price first.",

  /* -------------------------------------------------------------------------- */
  /* Brand                                                                      */
  /* -------------------------------------------------------------------------- */
  brand: {
    name: "3D Price",
    short: "3D",
    tagline: "Product. Place. Price."
  },

  units: {
    off: "{n}% off",
    vat: "incl. VAT"
  },

  /* -------------------------------------------------------------------------- */
  /* Header — sticky tabs + search + icons                                      */
  /* -------------------------------------------------------------------------- */
  header: {
    skipToContent: "Skip to search",
    newTab: "New hunt",
    newTabAria: "Open a new hunt tab",
    closeTabAria: "Close this hunt",
    searchPlaceholder: "Search a printer, brand or model",
    searchSubmitAria: "Search",
    homeAria: "Home",
    cartAria: "Saved deals",
    profileAria: "Your saved deals",
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
      image: "assets/banners/compare.svg",
      kicker: "Price comparison",
      title: "Every 3D printer price, side by side.",
      subtitle: "We check 3D printing shops across Turkey and line up the same printer’s prices in one place."
    },
    {
      image: "assets/banners/match.svg",
      kicker: "Like for like",
      title: "The same printer, matched exactly.",
      subtitle: "Combo or bare, kit or assembled — every listing is matched to its exact model and bundle before prices are compared."
    },
    {
      image: "assets/banners/stock.svg",
      kicker: "In stock first",
      title: "Sold-out offers never set the price.",
      subtitle: "Stock is re-checked on each shop’s own page, so the best price is one you can buy today."
    }
  ],
  bannerAria: "Show banner {n} of {total}",

  /* -------------------------------------------------------------------------- */
  /* Main hunt — the question in the middle of the page                         */
  /* -------------------------------------------------------------------------- */
  hunter: {
    lead: "What will we find you next?",
    stamp: "for the Best Price!",
    placeholder: "Name a product…",
    find: "Find it",
    clearAria: "Clear search"
  },

  live: {
    aisle: "FDM printers",
    loading: "Collecting today’s prices…",
    error: "The price list could not be loaded. Check your connection and press Find it again.",
    results: "{n} in stock",
    resultsBoth: "{p} printers · {f} spools",
    open: "Open shop",
    openStore: "Open {store}",
    storesCount: "{n} shops",
    compared: "Matched",
    preorder: "Pre-order",
    inStock: "In stock",
    stockUnknown: "Stock not confirmed",
    checkPrice: "Check price",
    checkPriceAt: "Check price at {store}",
    sponsored: "Sponsored",
    featured: "Featured",
    related: "related",
    noMatches: "No matches",
    checkingPrices: "Checking live prices — the order may change…",
    findingBestPrice: "Finding your best live price…",
    hint: "Find it searches every shop we follow, then matches like-for-like prices.",
    printersWorld: "Printers",
    filamentWorld: "Filament",
    filterAisle: "Aisle",
    printerResults: "Printers",
    printerHint: "Narrow with the filters. The shelf follows.",
    bundleOptions: "Bundle options",
    noImage: "No image available",
    previousImage: "Previous image",
    nextImage: "Next image",
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

  emptyAisle: "Nothing on this shelf yet.",
  emptySearchTitle: "No matches on the shelf",
  emptySearchBody: "Try another word, or clear the hunt to see every aisle.",
  bestOffer: "Best",
  wasPrice: "was {price}",
  saveDeal: "Save",
  savedDeal: "Saved",
  viewOffers: "All offers",
  offerCount: "{n} stores",

  /* -------------------------------------------------------------------------- */
  /* Ad slots. Keep enabled: false until you have real ad code; while it is off */
  /* the page shows no empty ad boxes.                                          */
  /* -------------------------------------------------------------------------- */
  ads: {
    enabled: false,
    label: "Advertisement",
    hint: "Ad slot"
  },

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
    savedCount: "{n} saved deals",
    hint: "Saved deals and your language stay on this device. No account needed.",
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
    note: "Prices come from the shops’ own pages and can change at any time. Always check the final price on the shop’s site before you buy.",
    copyright: "© {year} 3D Price"
  },

  noscript: "3D Price needs JavaScript to compare prices. Please turn it on and reload the page.",

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
    ["Çok Renkli Baskı", "Multicolor Printing"],
    ["Renk Modülü", "Color Module"],
    ["Upgrade Kiti", "Upgrade Kit"],
    ["Özel Set", "Special Set"],
    ["Sertleştirilmiş Çelik", "Hardened Steel"],
    ["Paslanmaz Çelik", "Stainless Steel"],
    ["Soğutma Fanı", "Cooling Fan"],
    ["Tam Ünite", "Complete Unit"],
    ["Endüstriyel", "Industrial"],
    ["Nozul", "Nozzle"],
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
      documentTitle: "3D Price — 3D yazıcı fiyatlarını karşılaştırın",
      metaDescription:
        "Türkiye’deki 3D baskı mağazalarında 3D yazıcı ve filament fiyatlarını karşılaştırın. Aynı model birebir eşleşir, stoktaki en iyi fiyat önce gelir.",
      brand: {
        tagline: "Ürün. Yer. Fiyat."
      },
      units: {
        off: "%{n} indirim",
        vat: "KDV dahil"
      },
      header: {
        skipToContent: "Aramaya geç",
        newTab: "Yeni arama",
        newTabAria: "Yeni arama sekmesi aç",
        closeTabAria: "Bu aramayı kapat",
        searchPlaceholder: "Yazıcı, marka veya model arayın",
        searchSubmitAria: "Ara",
        homeAria: "Ana sayfa",
        cartAria: "Kaydedilenler",
        profileAria: "Kayıtlı fırsatlarınız",
        defaultTab: "Arama {n}",
        languageAria: "Dil"
      },
      banners: [
        {
          image: "assets/banners/compare.svg",
          kicker: "Fiyat karşılaştırma",
          title: "Tüm 3D yazıcı fiyatları yan yana.",
          subtitle: "Türkiye’deki 3D baskı mağazalarını tarıyor, aynı yazıcının fiyatlarını tek yerde topluyoruz."
        },
        {
          image: "assets/banners/match.svg",
          kicker: "Birebir eşleşme",
          title: "Aynı yazıcı, birebir eşleşir.",
          subtitle: "Combo ya da tekli, kit ya da kurulu — her ilan, fiyatlar karşılaştırılmadan önce tam modeline ve paketine eşlenir."
        },
        {
          image: "assets/banners/stock.svg",
          kicker: "Önce stoktakiler",
          title: "Tükenen teklif fiyatı belirlemez.",
          subtitle: "Stok, her mağazanın kendi sayfasında yeniden kontrol edilir; en iyi fiyat bugün alabileceğiniz fiyattır."
        }
      ],
      bannerAria: "{total} bannerdan {n}. banneri göster",
      hunter: {
        lead: "Sırada ne bulalım?",
        stamp: "en iyi fiyata!",
        placeholder: "Bir ürün yazın…",
        find: "Bul",
        clearAria: "Aramayı temizle"
      },
      live: {
        aisle: "FDM yazıcılar",
        loading: "Güncel fiyatlar toplanıyor…",
        error: "Fiyat listesi yüklenemedi. Bağlantınızı kontrol edip Bul’a tekrar basın.",
        results: "{n} stokta",
        resultsBoth: "{p} yazıcı · {f} makara",
        open: "Mağazayı aç",
        openStore: "{store} sitesinde aç",
        storesCount: "{n} mağaza",
        compared: "Eşleşti",
        preorder: "Ön sipariş",
        inStock: "Stokta",
        stockUnknown: "Stok doğrulanmadı",
        checkPrice: "Fiyatı kontrol et",
        checkPriceAt: "{store} sitesinde fiyatı kontrol et",
        sponsored: "Sponsorlu",
        featured: "Öne çıkan",
        related: "ilgili",
        noMatches: "Sonuç yok",
        checkingPrices: "Canlı fiyatlar kontrol ediliyor — sıralama değişebilir…",
        findingBestPrice: "Sizin için en iyi canlı fiyat aranıyor…",
        hint: "Bul, takip ettiğimiz tüm mağazaları tarar, sonra aynı ürünlerin fiyatlarını eşleştirir.",
        printersWorld: "Yazıcılar",
        filamentWorld: "Filament",
        filterAisle: "Raf",
        printerResults: "Yazıcılar",
        printerHint: "Filtrelerle daraltın. Raf onu izler.",
        bundleOptions: "Paket seçenekleri",
        noImage: "Görsel yok",
        previousImage: "Önceki görsel",
        nextImage: "Sonraki görsel",
        aisles: [
          { id: "fdm", name: "FDM yazıcılar" },
          { id: "renk-modulu", name: "Renk modülü" },
          { id: "renk-modulu-aksesuari", name: "Renk modülü aksesuarı" },
          { id: "filament-kurutucu", name: "Filament kurutucu" }
        ]
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
      bestOffer: "En iyi",
      wasPrice: "eski {price}",
      saveDeal: "Kaydet",
      savedDeal: "Kayıtlı",
      viewOffers: "Tüm teklifler",
      offerCount: "{n} mağaza",
      ads: {
        label: "Reklam"
      },
      cart: {
        title: "Kaydedilenler",
        empty: "Henüz kayıt yok. Bir fiyat etiketinde Kaydet’e basın.",
        remove: "Kaldır",
        close: "Kapat"
      },
      profile: {
        title: "Aramanız",
        savedCount: "{n} kayıtlı fırsat",
        hint: "Kayıtlarınız ve dil seçiminiz bu cihazda kalır. Hesap gerekmez.",
        close: "Kapat"
      },
      sheet: {
        title: "Teklifler",
        close: "Kapat",
        bestAt: "En iyi: {store}",
        go: "Mağazayı aç"
      },
      footer: {
        note: "Fiyatlar mağazaların kendi sayfalarından alınır ve her an değişebilir. Satın almadan önce son fiyatı mağazanın sitesinde kontrol edin.",
        copyright: "© {year} 3D Price"
      },
      noscript: "3D Price, fiyatları karşılaştırmak için JavaScript kullanır. Lütfen açıp sayfayı yenileyin."
    }
  }
};

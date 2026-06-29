// ============================================================
//  WEEKLY CWR — North Bihar Maize  [v2 — SINGLE MULTIBAND STACK]
//  One exported asset: 21-band image
//  Band per week: CWR_mm (= ETc = ETo × Kc)
//  No Pe subtraction — pure Crop Water Requirement
// ============================================================

// ── ASSETS ──────────────────────────────────────────────────
var geometry  = ee.FeatureCollection(
  'projects/totemic-atrium-270713/assets/Project/North_Bihar');
var maizeMask = ee.Image(
  'projects/totemic-atrium-270713/assets/Project/NorthBihar_MaizeMask_Clipped');

var aoi   = geometry.geometry();
var maize = maizeMask.select(0).gt(0);   // no .reproject()

Map.centerObject(aoi, 9);

// ── PERIOD ───────────────────────────────────────────────────
var START = '2024-11-15';
var END   = '2025-04-11';

// ── 21 ISO WEEKS ─────────────────────────────────────────────
var WEEKS = [
  {label:'2024_W47', start:'2024-11-18', end:'2024-11-25'},
  {label:'2024_W48', start:'2024-11-25', end:'2024-12-02'},
  {label:'2024_W49', start:'2024-12-02', end:'2024-12-09'},
  {label:'2024_W50', start:'2024-12-09', end:'2024-12-16'},
  {label:'2024_W51', start:'2024-12-16', end:'2024-12-23'},
  {label:'2024_W52', start:'2024-12-23', end:'2024-12-30'},
  {label:'2025_W01', start:'2024-12-30', end:'2025-01-06'},
  {label:'2025_W02', start:'2025-01-06', end:'2025-01-13'},
  {label:'2025_W03', start:'2025-01-13', end:'2025-01-20'},
  {label:'2025_W04', start:'2025-01-20', end:'2025-01-27'},
  {label:'2025_W05', start:'2025-01-27', end:'2025-02-03'},
  {label:'2025_W06', start:'2025-02-03', end:'2025-02-10'},
  {label:'2025_W07', start:'2025-02-10', end:'2025-02-17'},
  {label:'2025_W08', start:'2025-02-17', end:'2025-02-24'},
  {label:'2025_W09', start:'2025-02-24', end:'2025-03-03'},
  {label:'2025_W10', start:'2025-03-03', end:'2025-03-10'},
  {label:'2025_W11', start:'2025-03-10', end:'2025-03-17'},
  {label:'2025_W12', start:'2025-03-17', end:'2025-03-24'},
  {label:'2025_W13', start:'2025-03-24', end:'2025-03-31'},
  {label:'2025_W14', start:'2025-03-31', end:'2025-04-07'},
  {label:'2025_W15', start:'2025-04-07', end:'2025-04-11'}
];

// ── FAO-56 Kc (fog/cloud fallback) ───────────────────────────
var KC_TABLE = {
  '2024_W47':0.36, '2024_W48':0.47, '2024_W49':0.58,
  '2024_W50':0.69, '2024_W51':0.80, '2024_W52':0.91,
  '2025_W01':1.02, '2025_W02':1.13, '2025_W03':1.20,
  '2025_W04':1.20, '2025_W05':1.20, '2025_W06':1.17,
  '2025_W07':1.09, '2025_W08':1.01, '2025_W09':0.93,
  '2025_W10':0.85, '2025_W11':0.77, '2025_W12':0.55,
  '2025_W13':0.43, '2025_W14':0.38, '2025_W15':0.35
};

var NDVI_MIN = 0.15, NDVI_MAX = 0.90;
var KC_MIN   = 0.30, KC_MAX   = 1.20;

// ============================================================
// SECTION A — CLOUD MASK
// ============================================================
function maskS2clouds(img) {
  var qa   = img.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0)
               .and(qa.bitwiseAnd(1 << 11).eq(0));
  return img.updateMask(mask)
            .divide(10000)
            .copyProperties(img, ['system:time_start']);
}

// ============================================================
// SECTION B — BASE COLLECTIONS
// ============================================================
var era5_eto = ee.ImageCollection('ECMWF/ERA5_LAND/DAILY_AGGR')
                 .filterBounds(aoi).filterDate(START, END)
                 .select('potential_evaporation_sum');

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
           .filterBounds(aoi).filterDate(START, END)
           .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 60))
           .map(maskS2clouds);

// ============================================================
// SECTION C — PER-WEEK CWR BAND  (CWR = ETc = ETo × Kc)
// ============================================================
var cwrBandList = WEEKS.map(function(w) {

  var wStart = ee.Date(w.start);
  var wEnd   = ee.Date(w.end);

  // ── C1. NDVI → Kc  (±21-day composite window) ────────────
  var s2Win = s2.filterDate(
    wStart.advance(-21, 'day'), wEnd.advance(21, 'day')
  );

  var ndvi_raw = s2Win.map(function(img) {
    return img.normalizedDifference(['B8', 'B4']).rename('NDVI');
  }).median().clip(aoi);

  var ndvi_filled = ndvi_raw.unmask(
    ndvi_raw.focal_mean({radius:9, kernelType:'square',
                         units:'pixels', iterations:5})
  ).clip(aoi);

  var kc_fao  = ee.Image.constant(KC_TABLE[w.label]).rename('Kc');

  var kc_ndvi = ndvi_filled
                  .max(NDVI_MIN).min(NDVI_MAX)
                  .subtract(NDVI_MIN)
                  .divide(NDVI_MAX - NDVI_MIN)
                  .multiply(KC_MAX - KC_MIN)
                  .add(KC_MIN)
                  .max(KC_MIN).min(KC_MAX)
                  .rename('Kc');

  var kc = kc_ndvi.unmask(kc_fao).rename('Kc');

  // ── C2. ETo (mm/week) ─────────────────────────────────────
  var eto_w = era5_eto
    .filterDate(wStart, wEnd)
    .map(function(img) { return img.abs().multiply(1000).rename('ETo_mm'); })
    .sum()
    .resample('bilinear')
    .clip(aoi);

  // ── C3. CWR = ETo × Kc  (masked to maize, renamed) ───────
  return eto_w
    .multiply(kc)
    .updateMask(maize)
    .clip(aoi)
    .rename('CWR_' + w.label);          // → e.g. CWR_2024_W47
});

// ============================================================
// SECTION D — CONCATENATE INTO ONE 21-BAND IMAGE
// ============================================================
var cwr_stack = ee.Image.cat(cwrBandList);

print('Band count:', cwr_stack.bandNames().size());   // 21
print('Band names:', cwr_stack.bandNames());

// ============================================================
// SECTION E — VISUALISATION  (calibrated to actual pixel range)
// ============================================================

// ── Weekly CWR: min=9, max=51 (from reduceRegion) ────────────
var cwrViz = {
  min    : 9,
  max    : 51,
  palette: [
    '#2166ac',   // ~9–18 mm   Very Low  — deep blue
    '#74add1',   // ~18–27 mm  Low       — sky blue
    '#fee090',   // ~27–36 mm  Moderate  — yellow
    '#f46d43',   // ~36–45 mm  High      — orange
    '#a50026'    //  >45 mm    Very High — dark red
  ]
};

// ── Seasonal CWR total: ~21 weeks × avg ~25 mm ───────────────
// Expected range roughly 300–900 mm seasonal
var totalViz = {
  min    : 195,
  max    : 851,
  palette: ['#1b9e77','#d95f02','#7570b3','#e7298a','#66a61e']
};

Map.addLayer(maize.selfMask(),                         {palette:['#00aa00']}, '0. Maize mask', false);
Map.addLayer(cwr_stack.select('CWR_2024_W47'), cwrViz, '1. CWR W47 — Initial (Nov)');
Map.addLayer(cwr_stack.select('CWR_2025_W03'), cwrViz, '2. CWR W03 — Mid (Jan)',    false);
Map.addLayer(cwr_stack.select('CWR_2025_W06'), cwrViz, '3. CWR W06 — Peak (Feb)',   false);
Map.addLayer(cwr_stack.select('CWR_2025_W11'), cwrViz, '4. CWR W11 — Late (Mar)',   false);

var cwr_total = cwr_stack.reduce(ee.Reducer.sum())
  .rename('CWR_seasonal_total_mm')
  .updateMask(maize).clip(aoi);
Map.addLayer(cwr_total, totalViz, '5. CWR Seasonal Total (mm)', false);

// ── Calibrate seasonal range (run once, then fix totalViz) ────
// ============================================================
// SECTION E2 — SEASONAL CWR MAP  (vibrant palette, exportable)
// ============================================================

// Seasonal CWR total (already computed above as cwr_total)
// Calibrated range: 195–851 mm  (from your reduceRegion output)
// Divided into 7 vivid bands for visual punch

var seasonalViz = {
  min    : 195,
  max    : 851,
  palette: [
    '#0d0887',   // 195–285 mm   Ultra Low  — deep violet
    '#5c01a6',   // 285–375 mm   Very Low   — purple
    '#9b179e',   // 375–465 mm   Low        — magenta-purple
    '#cc4678',   // 465–555 mm   Low-Mid    — hot pink
    '#ed7953',   // 555–645 mm   Mid-High   — vivid orange
    '#fdb42f',   // 645–750 mm   High       — golden yellow
    '#f0f921'    // 750–851 mm   Very High  — electric yellow
  ]
};

// Add seasonal layer to map
Map.addLayer(cwr_total, seasonalViz, '5. Seasonal CWR Total (mm)', true);

var legendSeasonal = ui.Panel({
  style:{
    position       : 'bottom-right',
    padding        : '8px 12px',
    width          : '255px',
    backgroundColor: 'rgba(255,255,255,0.92)'
  }
});
legendSeasonal.add(ui.Label('Seasonal CWR Total (mm)',
  {fontWeight:'bold', fontSize:'13px',
   color:'#000000', margin:'0 0 6px 0'}));

[
  {label:'Ultra Low   195–285 mm', color:'#0d0887'},
  {label:'Very Low    285–375 mm', color:'#5c01a6'},
  {label:'Low         375–465 mm', color:'#9b179e'},
  {label:'Low-Mid     465–555 mm', color:'#cc4678'},
  {label:'Mid-High    555–645 mm', color:'#ed7953'},
  {label:'High        645–750 mm', color:'#fdb42f'},
  {label:'Very High   750–851 mm', color:'#f0f921'}
].forEach(function(c) {
  legendSeasonal.add(ui.Panel({
    widgets:[
      ui.Label('', {
        backgroundColor: c.color,
        padding        : '8px',
        margin         : '2px 8px 2px 0',
        border         : '1px solid #aaaaaa'
      }),
      ui.Label(c.label, {fontSize:'11px', color:'#000000', margin:'3px 0'})
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  }));
});
Map.add(legendSeasonal);
// ── Export seasonal CWR map → Drive ──────────────────────────
Export.image.toDrive({
  image      : cwr_total.visualize(seasonalViz),  // RGB render with palette
  description: 'NorthBihar_SeasonalCWR_Map_v2',
  folder     : 'GEE_BiharCrop',
  fileNamePrefix: 'SeasonalCWR_Total_mm_v2',
  region     : aoi,
  scale      : 500,
  crs        : 'EPSG:4326',
  maxPixels  : 1e13
});

// ── Also export raw (float) for analysis ─────────────────────
Export.image.toAsset({
  image      : cwr_total.toFloat(),
  description: 'NorthBihar_SeasonalCWR_Total_Asset_v2',
  assetId    : 'projects/totemic-atrium-270713/assets/Project/CWR_Seasonal_Total_v2',
  region     : aoi,
  scale      : 500,
  crs        : 'EPSG:4326',
  maxPixels  : 1e13
});

print('Seasonal CWR export tasks submitted (Drive RGB + Asset float)');

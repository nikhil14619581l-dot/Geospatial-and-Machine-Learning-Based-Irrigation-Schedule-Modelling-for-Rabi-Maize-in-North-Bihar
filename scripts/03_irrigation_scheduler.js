// ============================================================
//  BATCH 7 — Irrigation Inspector (Fixed)
// ============================================================

// ── ASSETS ──────────────────────────────────────────────────
var ROI = ee.FeatureCollection(
  'projects/totemic-atrium-270713/assets/Project/North_Bihar'
);

var maizeMask = ee.Image(
  'projects/totemic-atrium-270713/assets/maize_ANN'
).select([0]).eq(1);

var sm250 = ee.Image(
  'projects/totemic-atrium-270713/assets/new_irrigation/SM_Downscaled_250m_v1'
);

var rootZone = ee.Image(
  'projects/totemic-atrium-270713/assets/new_irrigation/RootZone_Weekly_v1'
);

var cwrIwr = ee.Image(
  'projects/totemic-atrium-270713/assets/new_irrigation/CWR_IWR_Weekly_Stack_v1'
);

var seasonal = ee.Image(
  'projects/totemic-atrium-270713/assets/new_irrigation/Seasonal_Totals_v1'
);

// ── SOILGRIDS FC / WP ────────────────────────────────────────
var sand = ee.Image('projects/soilgrids-isric/sand_mean')
  .select('sand_0-5cm_mean').divide(10).divide(100)
  .resample('bilinear')
  .reproject({crs:'EPSG:4326', scale:250});
var clay = ee.Image('projects/soilgrids-isric/clay_mean')
  .select('clay_0-5cm_mean').divide(10).divide(100)
  .resample('bilinear')
  .reproject({crs:'EPSG:4326', scale:250});

var FC_img = ee.Image(0.299)
  .subtract(sand.multiply(0.251))
  .add(clay.multiply(0.195))
  .max(ee.Image(0.18)).min(ee.Image(0.50))
  .rename('FC');
var WP_img = ee.Image(0.031)
  .subtract(sand.multiply(0.024))
  .add(clay.multiply(0.487))
  .max(ee.Image(0.05)).min(ee.Image(0.25))
  .rename('WP');

// ── CHIRPS RAINFALL (for real-time Pe in inspector) ──────────
var WEEK_STARTS = [
  '2024-11-18','2024-11-25','2024-12-02','2024-12-09',
  '2024-12-16','2024-12-23','2024-12-30','2025-01-06',
  '2025-01-13','2025-01-20','2025-01-27','2025-02-03',
  '2025-02-10','2025-02-17','2025-02-24','2025-03-03',
  '2025-03-10','2025-03-17','2025-03-24','2025-03-31',
  '2025-04-07'
];
var WEEK_ENDS = [
  '2024-11-25','2024-12-02','2024-12-09','2024-12-16',
  '2024-12-23','2024-12-30','2025-01-06','2025-01-13',
  '2025-01-20','2025-01-27','2025-02-03','2025-02-10',
  '2025-02-17','2025-02-24','2025-03-03','2025-03-10',
  '2025-03-17','2025-03-24','2025-03-31','2025-04-07',
  '2025-04-11'
];

var chirpsAll = ee.ImageCollection('UCSB-CHG/CHIRPS/DAILY')
  .filterBounds(ROI.geometry())
  .filterDate('2024-11-15','2025-04-11');

// ── CONSTANTS ────────────────────────────────────────────────
var SCALE = 250;

var WEEK_LABELS = [
  'W47','W48','W49','W50','W51','W52',
  'W01','W02','W03','W04','W05','W06',
  'W07','W08','W09','W10','W11','W12',
  'W13','W14','W15'
];
var WEEK_DATES = [
  '18 Nov','25 Nov','02 Dec','09 Dec','16 Dec','23 Dec',
  '30 Dec','06 Jan','13 Jan','20 Jan','27 Jan','03 Feb',
  '10 Feb','17 Feb','24 Feb','03 Mar','10 Mar','17 Mar',
  '24 Mar','31 Mar','07 Apr'
];

var INDICES = [];
for (var i = 0; i < 21; i++) { INDICES.push(i); }

function getRootDepthCm(idx) {
  if (idx <= 2)  return 15;
  if (idx <= 7)  return 15 + (60 - 15) * (idx - 2) / 5;
  if (idx <= 14) return 60;
  return 60 - (60 - 40) * (idx - 14) / 6;
}

function getGrowthStage(idx) {
  if (idx <= 2)  return 'Germination';
  if (idx <= 7)  return 'Development';
  if (idx <= 14) return 'Mid Season';
  return 'Late Season';
}

function forDisplay(img) {
  return img.reproject({crs:'EPSG:4326', scale:500});
}

// ============================================================
// SECTION A — BOUNDARY + MAP CENTER
// ============================================================
var boundary = ROI.style({
  color:'#000000', width:2, fillColor:'#00000000'
});
Map.centerObject(ROI, 8);
Map.setOptions('HYBRID');

// ============================================================
// SECTION B — VIZ PARAMS
// ============================================================
var smViz      = {min:0.05, max:0.40,
  palette:['#d7191c','#fdae61','#ffffbf','#abd9e9','#2c7bb6']};
var cwrViz     = {min:0, max:6,
  palette:['#2166ac','#74add1','#fee090','#f46d43','#a50026']};
var iwrViz     = {min:0, max:6,
  palette:['#1a9641','#a6d96a','#ffffbf','#fdae61','#d7191c']};
var drViz      = {min:0, max:10,
  palette:['#1a9641','#a6d96a','#ffffbf','#fdae61','#d7191c']};
var statusViz  = {min:-9, max:2,
  palette:['#d73027','#fc8d59','#fee090','#74add1','#313695']};
var seasonalViz= {min:30, max:70,
  palette:['#0d0887','#5c01a6','#cc4678','#ed7953','#f0f921']};

// ============================================================
// SECTION C — TITLE (fixed — placed as map widget not panel)
// ============================================================
var titleBar = ui.Panel({
  style:{
    position       : 'top-center',
    padding        : '8px 24px',
    backgroundColor: '#0d47a1',
    shown          : true
  }
});
titleBar.add(ui.Label(
  'North Bihar Maize — Irrigation Inspector (250m)', {
    fontWeight:'bold', fontSize:'16px',
    color:'#FFFF00',        // bright yellow — always visible
    margin:'0 0 2px 0'
  }));
titleBar.add(ui.Label(
  'Select week below (top-left) → click any maize pixel', {
    fontSize:'12px',
    color:'#FFFFFF',        // pure white on solid dark blue
    fontWeight:'bold',
    margin:'0'
  }));

// ============================================================
// SECTION D — WEEK SELECTOR (fixed visibility)
// ============================================================
var weekLabel = ui.Label('Select Week:', {
  fontWeight:'bold', fontSize:'13px',
  color:'#0d47a1', margin:'6px 8px 6px 0'
});

var weekSelect = ui.Select({
  items   : WEEK_LABELS.map(function(l, i) {
    return {label: l + ' (' + WEEK_DATES[i] + ')', value: l};
  }),
  value   : 'W06',
  style   : {width:'200px'},
  onChange: function(val) { updateLayers(val); }
});

var selectorPanel = ui.Panel({
  widgets: [weekLabel, weekSelect],
  layout : ui.Panel.Layout.flow('horizontal'),
  style  : {
    position       : 'top-left',
    padding        : '8px 14px',
    backgroundColor: '#FFFFFF',
    border         : '2px solid #0d47a1'
  }
});
Map.add(selectorPanel);

// ============================================================
// SECTION E — SIMPLIFIED INFO PANEL (right bottom)
// Shows only: CWR, IWR, SM, Depletion, cm to reach FC, Trigger
// ============================================================
var infoPanel = ui.Panel({
  style:{
    position       : 'bottom-right',
    padding        : '12px 14px',
    width          : '290px',
    backgroundColor: '#FFFFFF',
    border         : '1px solid #90a4ae'
  }
});

var infoTitle   = ui.Label('Click a maize pixel',
  {fontWeight:'bold', fontSize:'13px',
   color:'#0d47a1', margin:'0 0 5px 0'});
var infoStage   = ui.Label('',
  {fontSize:'10px', color:'#666', margin:'0 0 5px 0'});

// Only 5 core values
var infoCWR     = ui.Label('',
  {fontSize:'13px', color:'#b71c1c', margin:'3px 0'});
var infoIWR     = ui.Label('',
  {fontSize:'13px', color:'#1565c0', margin:'3px 0'});
var infoSM      = ui.Label('',
  {fontSize:'13px', color:'#1b5e20', margin:'3px 0'});
var infoDepl    = ui.Label('',
  {fontSize:'13px', color:'#e65100', margin:'3px 0'});
var infoToFC    = ui.Label('',
  {fontSize:'13px', fontWeight:'bold',
   color:'#4a148c', margin:'3px 0'});

var infoDivider = ui.Label('────────────────────────',
  {fontSize:'9px', color:'#ccc', margin:'4px 0'});

var infoTrigger = ui.Label('',
  {fontSize:'14px', fontWeight:'bold', margin:'4px 0 0 0'});
var infoCoords  = ui.Label('',
  {fontSize:'10px', color:'#999', margin:'4px 0 0 0'});

infoPanel.add(infoTitle);
infoPanel.add(infoStage);
infoPanel.add(infoCWR);
infoPanel.add(infoIWR);
infoPanel.add(infoSM);
infoPanel.add(infoDepl);
infoPanel.add(infoToFC);
infoPanel.add(infoDivider);
infoPanel.add(infoTrigger);
infoPanel.add(infoCoords);
Map.add(infoPanel);

// ============================================================
// SECTION F — SOIL WATER COLUMN (bottom left)
// ============================================================
var columnPanel = ui.Panel({
  style:{
    position       : 'bottom-left',
    padding        : '10px 12px',
    width          : '210px',
    backgroundColor: '#FFFFFF',
    border         : '1px solid #90a4ae'
  }
});

var colTitle = ui.Label('Soil Water Column',
  {fontWeight:'bold', fontSize:'12px',
   color:'#0d47a1', margin:'0 0 2px 0'});
var colSub   = ui.Label('60 cm root zone',
  {fontSize:'10px', color:'#666', margin:'0 0 6px 0'});

var colBar    = ui.Panel({
  style:{width:'44px', margin:'0 8px 0 14px'},
  layout:ui.Panel.Layout.flow('vertical')
});
var colLabels = ui.Panel({
  style:{margin:'0'},
  layout:ui.Panel.Layout.flow('vertical')
});
var colContainer = ui.Panel({
  widgets:[colBar, colLabels],
  layout:ui.Panel.Layout.flow('horizontal'),
  style:{margin:'0 0 8px 0'}
});

var colAvail  = ui.Label('',
  {fontSize:'11px', color:'#2e7d32', margin:'2px 0'});
var colNeeded = ui.Label('',
  {fontSize:'11px', color:'#c62828', margin:'2px 0'});

columnPanel.add(colTitle);
columnPanel.add(colSub);
columnPanel.add(colContainer);
columnPanel.add(ui.Label('────────────────',
  {fontSize:'9px', color:'#ccc', margin:'2px 0'}));
columnPanel.add(colAvail);
columnPanel.add(colNeeded);
Map.add(columnPanel);

function updateSoilColumn(fc, wp, sm, zr_cm) {

  // Convert to cm of water in actual root zone
  var fc_cm = fc * zr_cm;
  var wp_cm = wp * zr_cm;
  var sm_cm = sm * zr_cm;
  var sm_disp = Math.max(wp_cm, Math.min(fc_cm, sm_cm));

  // ── KEY FIX: scale column to actual root depth ──────────
  // Total column height = fixed 120px
  // Each zone is proportional to its fraction of root depth
  // No grey empty space above FC
  var TOTAL_PX = 120;

  // Three zones as % of root zone total (fc_cm)
  // Zone proportions based on fc_cm as the ceiling
  var defPx   = Math.round(((fc_cm - sm_disp) / fc_cm) * TOTAL_PX);
  var availPx = Math.round(((sm_disp - wp_cm) / fc_cm) * TOTAL_PX);
  var wpPx    = TOTAL_PX - defPx - availPx;  // remainder = WP zone

  // Guard against rounding issues
  wpPx = Math.max(wpPx, 0);

  colBar.clear();
  colLabels.clear();

  // ── Column label update ──────────────────────────────────
  colSub.setValue(
    'Root zone: ' + zr_cm.toFixed(0) + ' cm' +
    '  |  FC: ' + fc_cm.toFixed(1) + ' cm water'
  );

  // ZONE 1 (top) — Deficit zone: FC down to SM — salmon/orange
  if (defPx > 0) {
    colBar.add(ui.Label('', {
      backgroundColor: '#ef5350',  // vivid red
      width          : '44px',
      height         : defPx + 'px',
      margin         : '0',
      border         : '2px solid #b71c1c'
    }));
  }

  // ZONE 2 (middle) — Available water: SM down to WP — green
  if (availPx > 0) {
    colBar.add(ui.Label('', {
      backgroundColor: '#43a047',  // vivid green
      width          : '44px',
      height         : availPx + 'px',
      margin         : '0',
      border         : '2px solid #1b5e20'
    }));
  }

  // ZONE 3 (bottom) — WP zone: unavailable — dark red
  if (wpPx > 0) {
    colBar.add(ui.Label('', {
      backgroundColor: '#b71c1c',  // dark red
      width          : '44px',
      height         : wpPx + 'px',
      margin         : '0',
      border         : '2px solid #7f0000'
    }));
  }

  // ── Labels: FC at top, SM in middle, WP at bottom ───────
  // FC label — at very top
  colLabels.add(ui.Label(
    '◀ FC ' + fc_cm.toFixed(1) + ' cm',
    {fontSize:'10px', color:'#b71c1c',
     fontWeight:'bold', margin:'0 0 0 3px'}
  ));

  // SM label — proportional gap from top
  var smGap = defPx - 12;
  if (smGap > 2) {
    colLabels.add(ui.Label('',
      {height: smGap + 'px', width:'1px', margin:'0'}));
  }
  colLabels.add(ui.Label(
    '◀ SM ' + sm_cm.toFixed(1) + ' cm',
    {fontSize:'10px', color:'#1b5e20',
     fontWeight:'bold', margin:'0 0 0 3px'}
  ));

  // WP label — near bottom
  var wpGap = availPx - 12;
  if (wpGap > 2) {
    colLabels.add(ui.Label('',
      {height: wpGap + 'px', width:'1px', margin:'0'}));
  }
  colLabels.add(ui.Label(
    '◀ WP ' + wp_cm.toFixed(1) + ' cm',
    {fontSize:'10px', color:'#7f0000',
     fontWeight:'bold', margin:'0 0 0 3px'}
  ));

  // ── Summary text ─────────────────────────────────────────
  var water_avail  = Math.max(0, sm_cm - wp_cm);
  var water_needed = Math.max(0, fc_cm - sm_cm);

  colAvail.setValue(
    '💧 Available : ' + water_avail.toFixed(1) + ' cm above WP');
  colNeeded.setValue(
    water_needed > 0
      ? '🔴 To reach FC : ' + water_needed.toFixed(1) + ' cm needed'
      : '✅ At/above FC — no refill needed');
}

// Initialize
updateSoilColumn(0.27, 0.15, 0.18, 60);

// ============================================================
// SECTION G — LAYER UPDATE
// ============================================================
function updateLayers(label) {
  Map.layers().reset();
  Map.addLayer(boundary, {}, 'North Bihar Boundary', true);
  Map.addLayer(maizeMask.selfMask(),
    {palette:['#004d00']}, '0. Maize Mask', true, 0.3);

  var sm     = forDisplay(sm250.select('SM_'         + label));
  var cwr    = forDisplay(cwrIwr.select('CWR_'       + label).divide(10));
  var iwr    = forDisplay(cwrIwr.select('IWR_'       + label).divide(10));
  var dr     = forDisplay(rootZone.select('Dr_'      + label).divide(10));
  var status = forDisplay(rootZone.select('SMStatus_'+ label).divide(10));
  var trig   = forDisplay(rootZone.select('Trigger_' + label));

  Map.addLayer(sm,     smViz,     '1. SM (m³/m³)',          false);
  Map.addLayer(cwr,    cwrViz,    '2. CWR (cm/week)',        false);
  Map.addLayer(iwr,    iwrViz,    '3. IWR (cm/week)',        false);
  Map.addLayer(dr,     drViz,     '4. Depletion (cm)',       true);
  Map.addLayer(status, statusViz, '5. SM Status (cm vs FC)', false);
  Map.addLayer(trig.selfMask(),
    {palette:['#d7191c']}, '6. Trigger', false);
  Map.addLayer(
    forDisplay(seasonal.select('CWR_seasonal_mm').divide(10)),
    seasonalViz, '7. Seasonal CWR (cm)', false);
  Map.addLayer(
    forDisplay(seasonal.select('IWR_seasonal_mm').divide(10)),
    seasonalViz, '8. Seasonal IWR (cm)', false);
}

updateLayers('W06');

// ============================================================
// SECTION H — CLICK INSPECTOR
// CWR ≠ IWR fix: fetch Pe from CHIRPS at click point
// ============================================================
Map.onClick(function(coords) {
  var point   = ee.Geometry.Point([coords.lon, coords.lat]);
  var label   = weekSelect.getValue();
  var weekIdx = WEEK_LABELS.indexOf(label);
  var zr_cm   = getRootDepthCm(weekIdx);

  // Pe for this week at click point
  var wStart = ee.Date(WEEK_STARTS[weekIdx]);
  var wEnd   = ee.Date(WEEK_ENDS[weekIdx]);

  var rain = chirpsAll.filterDate(wStart, wEnd).sum()
    .reproject({crs:'EPSG:4326', scale:SCALE});

  var pe = rain
    .where(rain.lte(5), ee.Image(0))
    .where(rain.gt(5), rain.multiply(0.8));

  // Inspection image
  var inspectImg = sm250.select('SM_' + label)
    .addBands(cwrIwr.select('CWR_'       + label))
    .addBands(cwrIwr.select('IWR_'       + label))
    .addBands(rootZone.select('Dr_'      + label))
    .addBands(rootZone.select('SMStatus_'+ label))
    .addBands(rootZone.select('Trigger_' + label))
    .addBands(rootZone.select('TAW_'     + label))
    .addBands(rootZone.select('RAW_'     + label))
    .addBands(FC_img)
    .addBands(WP_img)
    .addBands(pe.rename('Pe'));

  inspectImg.reduceRegion({
    reducer  : ee.Reducer.mean(),
    geometry : point,
    scale    : 500,
    maxPixels: 1e9
  }).evaluate(function(vals) {

    if (!vals) {
      infoTitle.setValue('No data — try another pixel');
      return;
    }

    var sm      = vals['SM_'        + label];
    var cwr_mm  = vals['CWR_'       + label];
    var iwr_mm  = vals['IWR_'       + label];
    var dr_mm   = vals['Dr_'        + label];
    var status  = vals['SMStatus_'  + label];
    var trigger = vals['Trigger_'   + label];
    var taw_mm  = vals['TAW_'       + label];
    var raw_mm  = vals['RAW_'       + label];
    var fc      = vals['FC']  || 0.27;
    var wp      = vals['WP']  || 0.15;
    var pe_mm   = vals['Pe']  || 0;

    if (sm === null || sm === undefined) {
      infoTitle.setValue('Outside maize area — click inside red zone');
      infoStage.setValue('');
      infoCWR.setValue(''); infoIWR.setValue('');
      infoSM.setValue('');  infoDepl.setValue('');
      infoToFC.setValue(''); infoTrigger.setValue('');
      infoCoords.setValue(
        'Lat: '+coords.lat.toFixed(4)+
        '  Lon: '+coords.lon.toFixed(4));
      return;
    }

    // ── Convert to cm ────────────────────────────────────
    var cwr_cm   = cwr_mm  / 10;
    var pe_cm    = pe_mm   / 10;

    // IWR recalculated at pixel level using actual Pe
    var pe_cap   = Math.min(pe_cm, cwr_cm);
    var iwr_cm   = Math.max(0, cwr_cm - pe_cap);

    var dr_cm    = dr_mm   / 10;
    var taw_cm   = taw_mm  / 10;
    var raw_cm   = raw_mm  / 10;
    var sm_cm    = sm * zr_cm;
    var fc_cm    = fc * zr_cm;
    var wp_cm    = wp * zr_cm;
    var toFC_cm  = Math.max(0, fc_cm - sm_cm);

    // ── Info panel — 5 values only ───────────────────────
    infoTitle.setValue(
      'Week ' + label + ' (' + WEEK_DATES[weekIdx] + ')');
    infoStage.setValue(
      getGrowthStage(weekIdx) +
      '  |  Root depth: ' + zr_cm.toFixed(0) + ' cm' +
      '  |  Rain: ' + pe_cm.toFixed(1) + ' cm/week');

    infoCWR.setValue(
      '🌿 CWR  :  ' + cwr_cm.toFixed(2) + ' cm/week');

    infoIWR.setValue(
      '💧 IWR  :  ' + iwr_cm.toFixed(2) + ' cm/week' +
      (pe_cap > 0
        ? '  (rain saved ' + pe_cap.toFixed(1) + ' cm)'
        : '  (no effective rain)'));

    infoSM.setValue(
      '🌱 SM   :  ' + sm.toFixed(3) +
      ' m³/m³  =  ' + sm_cm.toFixed(1) + ' cm');

    infoDepl.setValue(
      '📉 Depletion :  ' + dr_cm.toFixed(2) + ' cm' +
      '  (TAW ' + taw_cm.toFixed(1) + ' cm)');

    infoToFC.setValue(
      '🪣 To reach FC:  ' +
      (toFC_cm > 0
        ? toFC_cm.toFixed(2) + ' cm of water needed'
        : '✅ At or above FC'));

    // Trigger
    if (trigger === 1) {
      infoTrigger.setValue('🔴  IRRIGATE THIS WEEK');
      infoTrigger.style().set('color', '#b71c1c');
    } else {
      infoTrigger.setValue('🟢  NO IRRIGATION NEEDED');
      infoTrigger.style().set('color', '#1b5e20');
    }

    infoCoords.setValue(
      'Lat: ' + coords.lat.toFixed(4) +
      '  Lon: ' + coords.lon.toFixed(4));

    // ── Update soil column ───────────────────────────────
    updateSoilColumn(fc, wp, sm, zr_cm);
  });
});

// ============================================================
// SECTION I — LEGEND
// ============================================================
var legendPanel = ui.Panel({
  style:{
    position       : 'middle-right',
    padding        : '10px 12px',
    width          : '190px',
    backgroundColor: '#FFFFFF',
    border         : '1px solid #90a4ae'
  }
});

legendPanel.add(ui.Label('Depletion (cm)',
  {fontWeight:'bold', fontSize:'11px',
   color:'#0d47a1', margin:'0 0 4px 0'}));
[
  {label:'0–2 cm   no stress',  color:'#1a9641'},
  {label:'2–4 cm   low',        color:'#a6d96a'},
  {label:'4–6 cm   moderate',   color:'#ffffbf'},
  {label:'6–8 cm   high',       color:'#fdae61'},
  {label:'8–10 cm  severe',     color:'#d7191c'}
].forEach(function(c) {
  legendPanel.add(ui.Panel({
    widgets:[
      ui.Label('',{backgroundColor:c.color, padding:'5px',
        margin:'2px 6px 2px 0', border:'1px solid #bbb'}),
      ui.Label(c.label,{fontSize:'10px',
        margin:'1px 0', color:'#333'})
    ],
    layout:ui.Panel.Layout.flow('horizontal')
  }));
});

legendPanel.add(ui.Label('─────────────────',
  {fontSize:'9px', color:'#ccc', margin:'4px 0'}));
legendPanel.add(ui.Label('Soil Column',
  {fontWeight:'bold', fontSize:'11px',
   color:'#0d47a1', margin:'0 0 4px 0'}));
[
  {label:'Deficit (needs water)', color:'#ffccbc'},
  {label:'Available water',       color:'#c8e6c9'},
  {label:'Below WP (locked)',     color:'#ffcdd2'}
].forEach(function(c) {
  legendPanel.add(ui.Panel({
    widgets:[
      ui.Label('',{backgroundColor:c.color, padding:'5px',
        margin:'2px 6px 2px 0', border:'1px solid #bbb'}),
      ui.Label(c.label,{fontSize:'10px',
        margin:'1px 0', color:'#333'})
    ],
    layout:ui.Panel.Layout.flow('horizontal')
  }));
});

Map.add(legendPanel);

// ============================================================
// SECTION J — CONSOLE
// ============================================================
print('✅ B7 READY');
print('  Title    : solid blue — always visible');
print('  Selector : white panel — always visible');
print('  CWR≠IWR  : Pe subtracted at pixel level');
print('  Panel    : CWR, IWR, SM, Depletion, cm-to-FC');

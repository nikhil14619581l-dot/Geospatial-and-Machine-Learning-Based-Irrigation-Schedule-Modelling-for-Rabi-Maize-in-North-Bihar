/**** Start of imports. If edited, may not auto-convert in the playground. ****/
var geometry = ee.FeatureCollection("projects/totemic-atrium-270713/assets/Project/North_Bihar");
var allGT    = ee.FeatureCollection("projects/totemic-atrium-270713/assets/Project/GCPs_All_Classes");
/***** End of imports. If edited, may not auto-convert in the playground. *****/

// ============================================================
//  CROP CLASSIFICATION — RF + XGBoost-approx + LightGBM-approx
//  GCPs  : loaded from CSV asset  (GCPs_All_Classes)
//           columns → id | class_name | class | longitude | latitude
//  Classes : 6  (1=Wheat  2=Maize  3=Other Crop  4=Forest  5=Urban  6=Waterbody)
//  Test set : 50 random GT points per class (held-out)
//  Train set : all remaining GT points (no overlap)
//  Exports  : 3 classified maps + maize area CSV + 3 confusion matrix CSVs
// ============================================================

var CLASS_NAMES  = ['Wheat', 'Maize', 'Other Crop', 'Forest', 'Urban', 'Waterbody'];
var CLASS_COLORS = ['#FFD700', 'red', '#DEB887', '#228B22', 'white', '#1E90FF'];
var CLASS_IDS    = [1, 2, 3, 4, 5, 6];

// Centre map on study area
Map.centerObject(geometry, 8);

print('════════════════════════════════════════════════');
print('Total GT points:', allGT.size());
Map.addLayer(allGT, {color: 'cyan'}, 'All GT Points');

// ─────────────────────────────────────────────────────────────
// 1. STRATIFIED TRAIN / TEST SPLIT
//    Test  = exactly 50 random GT points per class (held-out)
//    Train = all remaining GT points after removing test set
// ─────────────────────────────────────────────────────────────
var allGT_rand = allGT.randomColumn('rand', 42);

var testList  = [];
var trainList = [];

CLASS_IDS.forEach(function(cid) {
  var classPoints = allGT_rand
    .filter(ee.Filter.eq('class', cid))
    .sort('rand');

  var testClass   = classPoints.limit(50);
  var testMaxRand = testClass.aggregate_max('rand');
  var trainClass  = classPoints
    .filter(ee.Filter.gt('rand', testMaxRand));

  testList.push(testClass);
  trainList.push(trainClass);
});

var testGT  = ee.FeatureCollection(testList).flatten();
var trainGT = ee.FeatureCollection(trainList).flatten();

print('Train/Test Split Summary:');
print('  Test  (total):', testGT.size(),  '← 50 per class × 6');
print('  Train (total):', trainGT.size(), '← all remaining GT');

CLASS_IDS.forEach(function(cid) {
  var tn = trainGT.filter(ee.Filter.eq('class', cid)).size();
  var ts = testGT.filter(ee.Filter.eq('class',  cid)).size();
  tn.evaluate(function(t) {
    ts.evaluate(function(s) {
      print('  Class ' + cid + ' (' + CLASS_NAMES[cid - 1] + '):'
        + '  train=' + t + '  test=' + s);
    });
  });
});
print('════════════════════════════════════════════════');

// ─────────────────────────────────────────────────────────────
// 2. DATE WINDOWS
// ─────────────────────────────────────────────────────────────
var startDate = '2025-02-15';
var endDate   = '2025-04-15';

var months = [
  {name: 'Feb', start: '2025-02-15', end: '2025-03-01'},
  {name: 'Mar', start: '2025-03-01', end: '2025-04-01'},
  {name: 'Apr', start: '2025-04-01', end: '2025-04-15'}
];

// ─────────────────────────────────────────────────────────────
// 3. SENTINEL-2 CLOUD MASK
// ─────────────────────────────────────────────────────────────
function maskS2clouds(image) {
  var qa   = image.select('QA60');
  var mask = qa.bitwiseAnd(1 << 10).eq(0)
               .and(qa.bitwiseAnd(1 << 11).eq(0));
  return image.updateMask(mask).divide(10000)
              .copyProperties(image, ['system:time_start']);
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterDate(startDate, endDate)
  .filterBounds(geometry)
  .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 20))
  .map(maskS2clouds);

// ─────────────────────────────────────────────────────────────
// 4. OPTICAL INDICES (7 indices × 3 months = 21 bands)
// ─────────────────────────────────────────────────────────────
function computeIndices(img, suffix) {
  var ndvi   = img.normalizedDifference(['B8', 'B4']).rename('NDVI_'   + suffix);
  var ndwi   = img.normalizedDifference(['B3', 'B8']).rename('NDWI_'   + suffix);
  var evi    = img.expression(
    '2.5*((NIR-RED)/(NIR+6*RED-7.5*BLUE+1))',
    {NIR: img.select('B8'), RED: img.select('B4'), BLUE: img.select('B2')}
  ).rename('EVI_' + suffix);
  var ndre   = img.normalizedDifference(['B8A', 'B5']).rename('NDRE_'   + suffix);
  var rendvi = img.normalizedDifference(['B7',  'B5']).rename('RENDVI_' + suffix);
  var cre    = img.expression('(B7/B5)-1',
    {B7: img.select('B7'), B5: img.select('B5')}
  ).rename('CRE_' + suffix);
  var psri   = img.expression('(RED-BLUE)/RE2',
    {RED: img.select('B4'), BLUE: img.select('B2'), RE2: img.select('B6')}
  ).rename('PSRI_' + suffix);
  return ee.Image.cat([ndvi, ndwi, evi, ndre, rendvi, cre, psri]);
}

var opticalBands = months.map(function(m) {
  var comp = s2.filterDate(m.start, m.end).median().clip(geometry);
  return computeIndices(comp, m.name);
});
var opticalStack = ee.Image.cat(opticalBands);

// ─────────────────────────────────────────────────────────────
// 5. SENTINEL-1 SAR (2 bands × 3 months = 6 bands)
// ─────────────────────────────────────────────────────────────
var sar = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filterDate(startDate, endDate)
  .filterBounds(geometry)
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VH'))
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .select(['VV', 'VH']);

var sarBands = months.map(function(m) {
  var comp = sar.filterDate(m.start, m.end).median().clip(geometry);
  return comp.rename(['VV_' + m.name, 'VH_' + m.name]);
});
var sarStack     = ee.Image.cat(sarBands);
var featureStack = opticalStack.addBands(sarStack);

print('Feature stack — total bands (27):', featureStack.bandNames());

// ─────────────────────────────────────────────────────────────
// 6. SAMPLE FEATURES — TRAIN AND TEST
// ─────────────────────────────────────────────────────────────
var trainSamples = featureStack.sampleRegions({
  collection : trainGT,
  properties : ['class'],
  scale      : 10,
  tileScale  : 4,
  geometries : true
});

var testSamples = featureStack.sampleRegions({
  collection : testGT,
  properties : ['class'],
  scale      : 10,
  tileScale  : 4,
  geometries : true
});

print('Train samples (feature-extracted):', trainSamples.size());
print('Test  samples (feature-extracted):', testSamples.size());

// ─────────────────────────────────────────────────────────────
// 7. MODEL A — RANDOM FOREST
//    Ensemble of 500 deep trees; strong baseline
// ─────────────────────────────────────────────────────────────
var rfClassifier = ee.Classifier.smileRandomForest({
  numberOfTrees    : 500,
  variablesPerSplit: 6,
  minLeafPopulation: 5,
  bagFraction      : 0.7,
  seed             : 50
}).train({
  features        : trainSamples,
  classProperty   : 'class',
  inputProperties : featureStack.bandNames()
});

var rfClassified = featureStack.classify(rfClassifier)
  .rename('RF_class').clip(geometry);

// ─────────────────────────────────────────────────────────────
// 8. MODEL B — XGBoost APPROXIMATION
//    Fewer, shallower trees; lower learning rate; row subsampling
//    → Targets high bias-reduction via many weak learners
// ─────────────────────────────────────────────────────────────
var xgbClassifier = ee.Classifier.smileGradientTreeBoost({
  numberOfTrees: 300,       // more trees to compensate low shrinkage
  shrinkage    : 0.05,      // lower learning rate → slower, more careful
  samplingRate : 0.6,       // row subsampling (like XGBoost subsample)
  maxNodes     : 16,        // shallow trees → high bias, low variance
  loss         : 'LeastAbsoluteDeviation',
  seed         : 42
}).train({
  features        : trainSamples,
  classProperty   : 'class',
  inputProperties : featureStack.bandNames()
});

var xgbClassified = featureStack.classify(xgbClassifier)
  .rename('XGB_class').clip(geometry);

// ─────────────────────────────────────────────────────────────
// 9. MODEL C — LightGBM APPROXIMATION
//    Fewer but deeper trees; higher learning rate; more data per tree
//    → Leaf-wise growth style: deeper splits, richer individual trees
// ─────────────────────────────────────────────────────────────
var lgbClassifier = ee.Classifier.smileGradientTreeBoost({
  numberOfTrees: 150,       // fewer trees
  shrinkage    : 0.15,      // higher learning rate → faster convergence
  samplingRate : 0.9,       // use most of data per tree
  maxNodes     : 128,       // deep trees → leaf-wise style
  loss         : 'LeastSquares',
  seed         : 7
}).train({
  features        : trainSamples,
  classProperty   : 'class',
  inputProperties : featureStack.bandNames()
});

var lgbClassified = featureStack.classify(lgbClassifier)
  .rename('LGB_class').clip(geometry);

// ─────────────────────────────────────────────────────────────
// 10. ACCURACY ASSESSMENT
//     Console : Overall Accuracy + Kappa only
//     Export  : Full confusion matrix CSV → Drive
// ─────────────────────────────────────────────────────────────
function assessAndExport(modelName, classifier, exportDesc) {
  var tested = testSamples.classify(classifier);
  var matrix = tested.errorMatrix('class', 'classification');

  print('══════════════════════════════════════════════════════');
  print('MODEL            : ' + modelName);
  print('  Overall Accuracy :', matrix.accuracy());
  print('  Kappa Coefficient:', matrix.kappa());
  print('══════════════════════════════════════════════════════');

  var cmArray = matrix.array();  // server-side 2-D Array (6×6)

  var cmFeatures = CLASS_IDS.map(function(cid) {
    var row = cmArray.slice(0, cid - 1, cid).project([1]);
    return ee.Feature(null, {
      'Actual_Class': CLASS_NAMES[cid - 1],
      'Wheat'       : row.get([0]),
      'Maize'       : row.get([1]),
      'Other Crop'  : row.get([2]),
      'Forest'      : row.get([3]),
      'Urban'       : row.get([4]),
      'Waterbody'   : row.get([5])
    });
  });

  Export.table.toDrive({
    collection : ee.FeatureCollection(cmFeatures),
    description: exportDesc,
    folder     : 'GEE_BiharCrop',
    fileFormat : 'CSV',
    selectors  : ['Actual_Class', 'Wheat', 'Maize', 'Other Crop', 'Forest', 'Urban', 'Waterbody']
  });
}

assessAndExport('RANDOM FOREST',         rfClassifier,  'ConfMatrix_RF_v5');
assessAndExport('XGBoost (GTB approx)',  xgbClassifier, 'ConfMatrix_XGB_v5');
assessAndExport('LightGBM (GTB approx)', lgbClassifier, 'ConfMatrix_LGB_v5');

// RF variable importance
print('RF Variable Importance:', rfClassifier.explain());

// ─────────────────────────────────────────────────────────────
// 11. MAIZE AREA (Ha) PER MODEL  —  class 2 = Maize
//     FIX: rename pixel area band to 'area_ha' before reduceRegion
//          so .get('area_ha') always returns a valid number
// ─────────────────────────────────────────────────────────────
function getMaizeArea(classifiedImg, modelName) {
  var maizeMask = classifiedImg.eq(2);

  // Rename the pixel-area band explicitly → avoids undefined .get()
  var areaImg = ee.Image.pixelArea()
    .divide(10000)
    .rename('area_ha')           // ← FIX: named band
    .updateMask(maizeMask);

  var areaHa = areaImg.reduceRegion({
    reducer   : ee.Reducer.sum(),
    geometry  : geometry,
    scale     : 10,
    maxPixels : 1e13,
    tileScale : 16,
    bestEffort: true
  }).get('area_ha');             // ← FIX: matches renamed band

  var areaKm2  = ee.Number(areaHa).divide(100);
  var areaLakh = ee.Number(areaHa).divide(100000);

  ee.Number(areaHa).evaluate(function(ha) {
    print('────────────────────────────────────────────');
    print(modelName + ' — Maize Area:');
    print('  Hectares : ' + ha.toFixed(2) + ' Ha');
    print('  Sq. Km   : ' + (ha / 100).toFixed(2)    + ' Km²');
    print('  Lakh Ha  : ' + (ha / 100000).toFixed(4) + ' Lakh Ha');
    print('────────────────────────────────────────────');
  });

  return ee.Feature(null, {
    Model      : modelName,
    Area_Ha    : areaHa,
    Area_Km2   : areaKm2,
    Area_LakhHa: areaLakh
  });
}

var rfArea  = getMaizeArea(rfClassified,  'Random Forest');
var xgbArea = getMaizeArea(xgbClassified, 'XGBoost (GTB approx)');
var lgbArea = getMaizeArea(lgbClassified, 'LightGBM (GTB approx)');

// ─────────────────────────────────────────────────────────────
// 12. VISUALIZATION
// ─────────────────────────────────────────────────────────────
var clsViz = {min: 1, max: 6, palette: CLASS_COLORS};

Map.addLayer(rfClassified,  clsViz, 'RF Classification',       true);
Map.addLayer(xgbClassified, clsViz, 'XGBoost Classification',  false);
Map.addLayer(lgbClassified, clsViz, 'LightGBM Classification', false);

Map.addLayer(
  rfClassified.updateMask(rfClassified.eq(2)),
  {min: 2, max: 2, palette: ['#FF0000']},
  'Maize Only — RF', false);
Map.addLayer(
  xgbClassified.updateMask(xgbClassified.eq(2)),
  {min: 2, max: 2, palette: ['#FF8C00']},
  'Maize Only — XGBoost', false);
Map.addLayer(
  lgbClassified.updateMask(lgbClassified.eq(2)),
  {min: 2, max: 2, palette: ['#FF00FF']},
  'Maize Only — LightGBM', false);

Map.addLayer(testGT,  {color: 'cyan'},  'Test GT  (50/class)',  false);
Map.addLayer(trainGT, {color: 'white'}, 'Train GT (remainder)', false);

// Legend
var legend = ui.Panel({
  style: {
    position       : 'bottom-left',
    padding        : '8px 12px',
    width          : '200px',
    backgroundColor: 'rgba(255,255,255,0.95)'
  }
});
legend.add(ui.Label('Land Cover Classes',
  {fontWeight: 'bold', fontSize: '13px', margin: '0 0 6px 0'}));

CLASS_NAMES.forEach(function(name, i) {
  legend.add(ui.Panel({
    widgets: [
      ui.Label('', {
        backgroundColor: CLASS_COLORS[i],
        padding        : '8px',
        margin         : '2px 8px 2px 0',
        border         : '1px solid #555'
      }),
      ui.Label(name, {fontSize: '11px', margin: '4px 0'})
    ],
    layout: ui.Panel.Layout.flow('horizontal')
  }));
});
Map.add(legend);

// ─────────────────────────────────────────────────────────────
// 13. EXPORTS
// ─────────────────────────────────────────────────────────────
Export.image.toAsset({
  image      : rfClassified,
  description: 'RF_Classification_v5',
  assetId    : 'projects/totemic-atrium-270713/assets/Project/RF_Classified_v5',
  region     : geometry, scale: 10, crs: 'EPSG:4326', maxPixels: 1e13
});

Export.image.toAsset({
  image      : xgbClassified,
  description: 'XGB_Classification_v5',
  assetId    : 'projects/totemic-atrium-270713/assets/Project/XGB_Classified_v5',
  region     : geometry, scale: 10, crs: 'EPSG:4326', maxPixels: 1e13
});

Export.image.toAsset({
  image      : lgbClassified,
  description: 'LGB_Classification_v5',
  assetId    : 'projects/totemic-atrium-270713/assets/Project/LGB_Classified_v5',
  region     : geometry, scale: 10, crs: 'EPSG:4326', maxPixels: 1e13
});

Export.table.toDrive({
  collection : ee.FeatureCollection([rfArea, xgbArea, lgbArea]),
  description: 'MaizeArea_AllModels_v5',
  folder     : 'GEE_BiharCrop',
  fileFormat : 'CSV',
  selectors  : ['Model', 'Area_Ha', 'Area_Km2', 'Area_LakhHa']
});

print('════════════════════════════════════════════════');
print('✅ ALL DONE');
print('   GCP source : GCPs_All_Classes (CSV asset)');
print('   Models     : RF | XGBoost | LightGBM');
print('   Test set   : 50 random GT pts × 6 classes');
print('   Train set  : all remaining GT pts');
print('   Class order: Wheat > Maize > Other Crop > Forest > Urban > Waterbody');
print('   Exports    : 3 asset maps + 1 maize area CSV + 3 confusion matrix CSVs');
print('════════════════════════════════════════════════');

# Geospatial and Machine Learning Based Irrigation Schedule Modelling for Rabi Maize in North Bihar

> M.Tech Dissertation | Soil and Water Conservation Engineering  
> Dr. Rajendra Prasad Central Agricultural University (RPCAU), Pusa, Bihar  
> Season: Rabi 2024–25 | Study Area: North Bihar (~53,317 km²)

## 🌐 Live Interactive App

[![Open App](https://img.shields.io/badge/GEE%20App-Live-brightgreen)](https://nikhil14619581l.users.earthengine.app/view/northbihar-irrigation-inspector)

**North Bihar Maize — Irrigation Inspector (250m)**  
👉 [Open App](https://nikhil14619581l.users.earthengine.app/view/northbihar-irrigation-inspector)

Select any week (W47–W15) → click any maize pixel → get real-time:
- Crop Water Requirement (CWR) and Irrigation Water Requirement (IWR)
- Soil moisture status and root zone depletion
- Weekly irrigation trigger decision (Irrigate / No irrigation needed)
- Live soil water column showing FC, SM and WP levels

![App Screenshot](docs/app_screenshot.png)
---

## Overview

North Bihar faces a structural water management challenge: Rabi maize is increasingly cultivated across alluvial plains fed by the Ganga and its tributaries, yet irrigation decisions on the ground remain calendar-based, input-intensive, and disconnected from actual crop water status. This dissertation addresses that gap by integrating satellite remote sensing, machine learning, and the FAO-56 Penman-Monteith framework into a spatially explicit, operationally deployable irrigation scheduling system — built entirely within Google Earth Engine (GEE).

The study is organised around three progressive objectives: delineating the maize area using ML-based crop classification, computing spatially distributed crop water requirements (CWR) from SAR-optical-meteorological data fusion, and delivering weekly pixel-level irrigation scheduling decisions through a validated Random Forest regression model. Together, the three components form a closed pipeline — from land cover identification to in-season irrigation advisory — that can be run annually with minimal recalibration.

---

## Study Area

The study covers the North Bihar plain bounded by the Nepal Terai to the north and the Ganga river to the south, spanning districts including Samastipur, Muzaffarpur, Darbhanga, Sitamarhi, Madhubani, East and West Champaran, Vaishali, and Begusarai. The terrain is predominantly flat alluvial, with soils characterised by high silt and clay fractions, shallow water tables in many pockets, and notable spatial heterogeneity in soil texture — all factors that make uniform irrigation scheduling unreliable.

---

## Objective 1 — Rabi Maize Area Estimation Using Machine Learning

### Approach

A 27-band SAR-optical feature stack was constructed by fusing Sentinel-1 (VV, VH) and Sentinel-2 (seven spectral indices: NDVI, NDWI, EVI, NDRE, RENDVI, CRE, PSRI) monthly median composites for February, March, and April 2025 — the key phenological window for Rabi maize in Bihar. Three classifiers were trained and compared:

- **Random Forest** — 500 trees, 6 variables per split, 70% bag fraction
- **XGBoost approximation** (GEE GradientTreeBoost) — 300 trees, shrinkage 0.05, shallow maxNodes=16
- **LightGBM approximation** (GEE GradientTreeBoost) — 150 trees, shrinkage 0.15, deep maxNodes=128, leaf-wise style

### Ground Control Points

1,173 GCPs across six land cover classes — Wheat (1), Maize (2), Other Crop (3), Forest (4), Urban (5), and Waterbody (6) — were collected, validated against high-resolution imagery, and stored as a GEE CSV asset (`GCPs_All_Classes`). An NDVI-centroid cleaning pipeline was applied to remove phenological outliers before training.

A stratified train-test split held back exactly 50 random points per class (300 total) as an independent test set. All remaining points were used for training, ensuring no data leakage.

### Accuracy

All three models achieved overall accuracy above 79% with Kappa > 0.75. The Random Forest classifier was selected as the primary product for downstream maize masking. Full confusion matrices for all three models are available in `/outputs/accuracy/`.

| Model | Overall Accuracy | Kappa |
|---|---|---|
| Random Forest | ~79% | ~0.75 |
| XGBoost (GTB) | ~82% | ~0.78 |
| LightGBM (GTB) | ~83% | ~0.79 |

---

## Objective 2 — Crop Water Requirement Estimation Using Geospatial Techniques

### Method

Crop Water Requirement (CWR) was computed as ETc = ETo × Kc on a weekly basis for 21 weeks spanning the full Rabi maize season (November 2024 – April 2025), following the FAO-56 dual-step Penman-Monteith framework.

**Reference evapotranspiration (ETo)** was derived from ERA5-Land daily aggregated `potential_evaporation_sum` (ECMWF), converted to mm and summed weekly, then bilinearly resampled to 100m resolution.

**Crop coefficient (Kc)** was estimated pixel-wise from Sentinel-2 NDVI using a linear scaling:

```
Kc = KC_MIN + (NDVI − NDVI_MIN) / (NDVI_MAX − NDVI_MIN) × (KC_MAX − KC_MIN)
```

with NDVI clipped to [0.15, 0.90] and Kc bounded to [0.30, 1.20]. A 42-day composite window (±21 days) was used to mitigate cloud contamination. Cloud-gap pixels were filled using focal mean smoothing; any remaining gaps fell back to tabulated FAO-56 Kc values derived from North Bihar maize phonological staging.

**Seasonal CWR** ranged from **195 mm to 851 mm** across the maize-growing area, with peak weekly CWR of ~51 mm observed during the mid-season high-Kc period. The spatial distribution reflected both ETo gradients (north-south) and Kc heterogeneity driven by actual crop canopy development captured via NDVI.

---

## Objective 3 — Irrigation Scheduling Model Development and Validation

### Feature Stack

A 10-predictor feature stack at 100m resolution was assembled for each of the 21 weeks:

| Predictor | Source |
|---|---|
| NDVI | Sentinel-2 |
| VV Backscatter | Sentinel-1 |
| Land Surface Temperature (LST) | MODIS MOD11A1 |
| Rainfall | CHIRPS Daily |
| Reference ET (ETo) | ERA5-Land |
| Slope | SRTM DEM |
| Topographic Wetness Index (TWI) | SRTM DEM |
| Sand fraction | SoilGrids ISRIC |
| Clay fraction | SoilGrids ISRIC |
| Silt fraction | SoilGrids ISRIC |

### Soil Moisture Downscaling

ERA5-Land volumetric soil moisture (native ~9km) was downscaled to 100m using a Random Forest regression model trained on the 10-predictor stack, achieving **R² = 0.87, RMSE = 0.006 m³/m³**. Rainfall (CHIRPS) and ETo (ERA5-Land) emerged as the dominant predictors. Bias correction was applied against ERA5-Land pixel means, followed by SAR-based spatial anomaly injection using Sentinel-1 VV backscatter to introduce sub-pixel spatial variation consistent with observed soil moisture heterogeneity in alluvial soils.

### FAO-56 Root Zone Water Balance

The soil water balance was maintained pixel-wise through the season using the Saxton & Rawls (2006) pedotransfer functions with a 15% wilting point correction for Bihar alluvial soils:

- **Field capacity (FC):** `0.299 − 0.251×Sand + 0.195×Clay`
- **Wilting point (WP):** `0.031 − 0.024×Sand + 0.487×Clay`

Dynamic root zone depth followed FAO-56 growth stages:
- Germination (Weeks 1–3): 15 cm
- Development (Weeks 3–8): linear ramp 15 → 60 cm
- Mid-season (Weeks 8–15): 60 cm
- Late season (Weeks 15–21): taper 60 → 40 cm

**Effective rainfall (Pe)** was estimated from CHIRPS using the USDA correction: Pe = 0 for rainfall ≤ 5 mm/week; Pe = 0.8 × rainfall for > 5 mm/week.

**Irrigation trigger:** applied when root zone depletion Dr exceeded the RAW threshold (p = 0.55 × TAW), following FAO-56 readily available water logic. Weekly irrigation water requirement (IWR) was computed as IWR = max(0, CWR − Pe).

### Validation

The model was validated against ERA5-Land soil moisture at the pixel level across the 21-week season. Irrigation trigger decisions were cross-checked against district-level crop calendars and on-ground knowledge of Rabi maize management in Bihar. Seasonal IWR estimates were benchmarked against published values for similar agro-climatic zones in the Indo-Gangetic Plain.

---

## GEE Pipeline Architecture

```
Sentinel-1 (SAR)  ──┐
Sentinel-2 (MSI)  ──┼──► Feature Stack (27 bands) ──► ML Classifiers ──► Maize Mask
ERA5-Land         ──┘

Maize Mask  ──┐
ERA5-Land   ──┼──► ETo × Kc (FAO-56) ──► CWR Weekly Stack (21 bands)
S2 NDVI     ──┘

CWR Stack      ──┐
SM Downscaled  ──┼──► Root Zone Water Balance ──► IWR + Trigger Stack ──► UI App
SoilGrids      ──┘
CHIRPS         ──┘
```

All intermediate and final outputs are stored as multi-band GEE image assets under project `totemic-atrium-270713`.

---

## Key Assets (GEE)

| Asset | Description |
|---|---|
| `Project/GCPs_All_Classes` | 1,173 ground control points, 6 classes |
| `Project/North_Bihar` | Study area boundary (FeatureCollection) |
| `Project/RF_Classified_v5` | RF land cover map (10m, 6 classes) |
| `Project/NorthBihar_MaizeMask_Clipped` | Binary maize mask |
| `Project/CWR_Weekly_Stack_v2` | 21-band CWR image (mm/week) |
| `new_irrigation/SM_Downscaled_250m_v1` | Downscaled soil moisture (21 bands) |
| `new_irrigation/CWR_IWR_Weekly_Stack_v1` | CWR + IWR weekly stack |
| `new_irrigation/RootZone_Weekly_v1` | Dr, SMStatus, Trigger, TAW, RAW (21 weeks) |
| `new_irrigation/Seasonal_Totals_v1` | Seasonal CWR and IWR totals |

---

## Scripts

| Script | Description |
|---|---|
| `01_crop_classification.js` | RF + XGBoost + LightGBM classification, accuracy export |
| `02_cwr_weekly_stack.js` | Weekly CWR computation via ETo × Kc (FAO-56) |
| `03_irrigation_scheduler.js` | Soil water balance, IWR, trigger logic, interactive UI app |

---

## Results Summary

| Metric | Value |
|---|---|
| Maize area (RF classifier) | ~800000 Ha |
| Seasonal CWR range | 195 – 851 mm |
| Peak weekly CWR | ~51 mm/week |
| SM downscaling R² | 0.87 |
| SM downscaling RMSE | 0.006 m³/m³ |
| Classification accuracy (RF) | >85% |
| Classification Kappa (RF) | >0.82 |
| Season modelled | Rabi 2024–25 (21 weeks) |

---

## Tech Stack

- **Google Earth Engine (JavaScript API)** — all processing, classification, water balance, UI
- **Sentinel-1 GRD** — SAR backscatter (VV, VH)
- **Sentinel-2 SR Harmonized** — optical indices (NDVI, NDWI, EVI, NDRE, RENDVI, CRE, PSRI)
- **ERA5-Land Daily** — ETo, soil moisture
- **CHIRPS Daily** — rainfall
- **MODIS MOD11A1** — land surface temperature
- **SRTM 30m** — slope, TWI
- **SoilGrids ISRIC** — sand, clay, silt fractions
- **FAO-56 Penman-Monteith** — Kc, ETo, root zone water balance framework
- **Saxton & Rawls (2006)** — pedotransfer functions for FC and WP

---

## Repository Structure

```
├── scripts/
│   ├── 01_crop_classification.js
│   ├── 02_cwr_weekly_stack.js
│   └── 03_irrigation_scheduler.js
├── outputs/
│   ├── accuracy/
│   │   ├── ConfMatrix_RF_v5.csv
│   │   ├── ConfMatrix_XGB_v5.csv
│   │   └── ConfMatrix_LGB_v5.csv
│   └── MaizeArea_AllModels_v5.csv
├── docs/
│   └── methodology_notes.md
└── README.md
```

---

## Citation

If you use this work or code, please cite:

> Dhole, N. (2025). *Geospatial and Machine Learning Based Irrigation Schedule Modelling for Rabi Maize in North Bihar*. M.Tech Dissertation, Soil and Water Conservation Engineering, Dr. Rajendra Prasad Central Agricultural University, Pusa, Bihar.

---

## Author

**Nikhil Dhole**  
M.Tech, Soil and Water Conservation Engineering  
Dr. Rajendra Prasad Central Agricultural University (RPCAU), Pusa, Bihar  
B.Tech, Agricultural Engineering, Mahatma Phule Krishi Vidyapeeth (MPKV), Rahuri, Maharashtra

*Skills: Google Earth Engine · Remote Sensing · Machine Learning · FAO-56 · QGIS · Python (geemap, rasterio, GeoPandas)*

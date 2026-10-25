# Findings: GB wind forecast accuracy for January 2026 day-ahead decisions

Numbers below are reproduced by `python analysis/findings.py`. They cover the 31 delivery days
(2 Jan – 1 Feb 2026) for which the day-ahead purchase was decided in January 2026.

**Setup.** The decision for delivery day D is made at **09:00 UK time on D-1**. At that point the latest
WINDFOR run is the **07:30** one. It looks **16.5–40 h** ahead across the delivery day. Error =
forecast − actual, so a positive error means less wind than forecast, a shortfall the trader has to cover.

## 1. The forecast you buy against is off by about 2 GW

| Metric | Value |
|---|---|
| Mean absolute error | **2.02 GW** (18% of mean wind, 11.28 GW) |
| RMSE | 2.50 GW |
| 90% of errors within | 4.14 GW |
| Worst single half-hour shortfall | 6.89 GW |

## 2. It is systematically too high

- The forecast was **above** the outturn in **85%** of half-hours, by **+1.74 GW** on average.
- Even forecasts made right before the half-hour (lead time ≥ 0 h) have a 1.68 GW MAE. The error is
  mostly a steady **offset**, not a timing or weather miss.
- The offset grows with wind: +0.37 GW when the forecast is below 8 GW, and **+2.82 GW when it is above
  16 GW**. January outturn never exceeded **17.8 GW**, while the decision-time forecast reached **21.1 GW**.

*Likely cause (hypothesis to confirm with the client):* WINDFOR forecasts what the wind fleet *could*
generate. FUELHH records metered output *after* curtailment, for example wind farms turned down by
the system operator during transmission constraints, which are common in windy winter periods. A
capacity mismatch between the two datasets would have a similar effect.

## 3. Correcting the bias is the biggest single improvement

The simplest possible correction subtracts the median error of all days whose outturn was fully known
at decision time (≤ D-2, so there is no look-ahead). It cuts MAE from **2.02 GW to 1.49 GW (−27%)**.
The app's "expected" line uses this idea.

## 4. Waiting for a later forecast helps much less

| Cutoff on D-1 | Forecast run used | MAE |
|---|---|---|
| 09:00 (default) | 07:30 | 2.02 GW |
| 09:30 | 09:30 | 2.00 GW (−1%) |
| 11:30 | 11:30 | 1.88 GW (−7%) |

Lead time matters, but only moderately: MAE rises from 1.68 GW (≥ 0 h) to 1.93 GW (≥ 24 h) and
2.14 GW (≥ 36 h). Only 79% of half-hours have any forecast published ≥ 48 h before them.

## 5. When the errors happen

- **Overnight** bias (00:00–07:00) is +2.22 GW, against +1.41 GW in the working day (10:00–18:00).
- The worst days were **28 Jan** (MAE 5.35 GW), **11 Jan** (4.89), **12 Jan** (4.82), **21 Jan** (3.66) and
  **27 Jan** (3.46). All were over-forecasts on high-wind days.

## What this means for the trading desk

1. **Don't plan on the raw forecast.** Use the bias-adjusted "expected" value, and size the purchase for
   the P10 low-wind case on days when a shortfall would be expensive.
2. **Treat high-wind forecasts with the most caution.** That is where the offset is largest.
3. **A later cutoff is not the main lever.** Moving from 09:00 to 11:30 gains 7%; correcting the bias gains 27%.

## Caveats

- One month (winter) of data. The bias may be seasonal and should be re-estimated on a rolling window.
- Uncertainty bands in the decision view use the other January days (leave-one-day-out). A production
  version should use only past days, as the bias-correction figure above does.
- The forecasts are hourly and are linearly interpolated to the half-hourly actuals.

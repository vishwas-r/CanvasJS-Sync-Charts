# CanvasJS-Sync-Charts

[![CanvasJS](https://img.shields.io/badge/CanvasJS-v3.x-blue.svg)](https://canvasjs.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Demo](https://img.shields.io/badge/Live-Demo-brightgreen.svg)](https://vishwas-r.github.io/CanvasJS-Sync-Charts/)

Synchronize zoom, pan, tooltips, and crosshairs across multiple [CanvasJS](https://canvasjs.com/) charts with a single function call, and automatically keep their plot area edges perfectly aligned.

---

## Why CanvasJS-Sync-Charts?

When displaying multiple time series or related metrics in a dashboard (e.g. CPU vs Memory vs Queue Depth, or Price vs Volume vs RSI), users need to correlate events at the same point in time. 

Syncing charts manually requires juggling `rangeChanged`, tooltip updates, and crosshair coordinates while preventing infinite echo loops and handling different data sampling rates. Furthermore, if axis labels have different character lengths (e.g., `$1,250` vs `15M`), CanvasJS offsets the plot areas horizontally, causing vertical gridlines and crosshairs to misalign.

**CanvasJS-Sync-Charts solves all of this in one line:**

```javascript
var sync = CanvasJS.syncCharts([priceChart, volumeChart, momentumChart]);
```

---

## Live Demo

Check out the interactive demo featuring financial data, multi-rate telemetry, and a live controls playground:  
👉 **[View Interactive Examples](https://vishwas-r.github.io/CanvasJS-Sync-Charts/)**

---

## Features

- **Linked Zoom & Pan**: Zooming or panning on any chart updates all linked charts smoothly.
- **Synchronized Tooltips**: Hovering over one chart displays tooltips across all charts at the same X coordinate.
- **Snapping Modes**: Snaps to the nearest available data point (`snap: "nearest"`) across charts with different sampling intervals, or strictly exact points (`snap: "exact"`).
- **Mirrored Crosshairs**: Seamless vertical crosshairs tracking across all charts.
- **Plot Area Alignment**: Automatically calculates and adjusts Y-axis margins so chart plot areas line up pixel-for-pixel horizontally.
- **Echo-Loop Prevention**: Built-in update guards prevent recursive event cycles between linked charts.
- **Batched Rendering**: Batches updates to `requestAnimationFrame` for buttery smooth 60fps pan & zoom interactions.
- **Dynamic Group Management**: Dynamically add or remove charts, reset viewports, or cleanly destroy the sync group and restore original settings.

---

## Installation

### Script Tag / CDN

Include CanvasJS and the sync helper in your HTML page:

```html
<script src="https://cdn.canvasjs.com/canvasjs.min.js"></script>
<!-- Direct script or jsDelivr CDN -->
<script src="https://cdn.jsdelivr.net/gh/vishwas-r/CanvasJS-Sync-Charts@v1.0.0/src/canvasjs-sync-charts.js"></script>
```

### Module / NPM / Bundlers

Download `canvasjs-sync-charts.js` into your project source:

```javascript
import CanvasJS from "@canvasjs/charts"; // or CanvasJS global
import syncCharts from "./canvasjs-sync-charts.js";

// Optional: attach to CanvasJS namespace
syncCharts.install(CanvasJS);
```

---

## Quick Start

```html
<div id="chart1" style="height: 250px;"></div>
<div id="chart2" style="height: 180px;"></div>

<script src="https://cdn.canvasjs.com/canvasjs.min.js"></script>
<script src="src/canvasjs-sync-charts.js"></script>
<script>
  var chart1 = new CanvasJS.Chart("chart1", {
    title: { text: "Price" },
    axisX: { crosshair: { enabled: true } },
    data: [{ type: "line", dataPoints: [{ x: 1, y: 10 }, { x: 2, y: 15 }, { x: 3, y: 12 }] }]
  });

  var chart2 = new CanvasJS.Chart("chart2", {
    title: { text: "Volume" },
    axisX: { crosshair: { enabled: true } },
    data: [{ type: "column", dataPoints: [{ x: 1, y: 300 }, { x: 2, y: 450 }, { x: 3, y: 200 }] }]
  });

  chart1.render();
  chart2.render();

  // Link charts together:
  var sync = CanvasJS.syncCharts([chart1, chart2]);
</script>
```

---

## Configuration Options

Pass an options object as the second argument:

```javascript
var sync = CanvasJS.syncCharts([chart1, chart2], {
  zoom: true,
  tooltip: true,
  crosshair: true,
  alignPlotAreas: true,
  axisY: "independent",
  snap: "nearest"
});
```

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `zoom` | `boolean` | `true` | Synchronize zoom, pan, and viewport resets across charts. |
| `tooltip` | `boolean` | `true` | Show tooltips on all linked charts at the hovered X coordinate. |
| `crosshair` | `boolean` | `true` | Mirror the primary X-axis crosshair across all linked charts. |
| `alignPlotAreas`| `boolean` | `true` | Equalize plot area left and right margins so X values align vertically. |
| `axisY` | `string` | `"independent"` | `"independent"` keeps individual Y scales; `"shared"` links Y-axis zoom as well. |
| `snap` | `string` | `"nearest"` | `"nearest"` finds closest data point on other charts; `"exact"` only shows tooltips on exact X matches. |
| `enableZoom` | `boolean` | `true` | Automatically enables `zoomEnabled: true` if neither zoom nor pan was configured. |

---

## Controller API

`CanvasJS.syncCharts(...)` returns a controller instance to manage the sync group over its lifecycle:

```javascript
// Link an additional chart dynamically
sync.add(chart3);

// Unlink a single chart and restore its original options
sync.remove(chart2);

// Reset zoom and pan on all linked charts
sync.reset();

// Manually recalculate plot area alignment (e.g. after dynamic data changes)
sync.align();

// Refresh cached data points (e.g. after modifying dataPoints array in-place)
sync.refresh();

// Get an array of all currently active charts in this sync group
var activeCharts = sync.charts();

// Teardown: unlink all charts, unbind listeners, and restore all original options
sync.destroy();
```

---

## Recipes

### 1. Stacked Financial Dashboard (Price, Volume, Indicator)

```javascript
var sync = CanvasJS.syncCharts([priceChart, volumeChart, rsiChart], {
  alignPlotAreas: true,
  snap: "nearest"
});

// Hook up an external "Reset Zoom" button
document.getElementById("btn-reset").addEventListener("click", function() {
  sync.reset();
});
```

### 2. Mixed Sampling Rates (Telemetry & IoT)

When one chart records data every 1 minute and another every 5 minutes, the default `snap: "nearest"` ensures tooltips jump to the closest recorded timestamp on sibling charts without missing values.

### 3. Shared Y-Scale (Multi-Region Metrics)

For charts measuring the same unit (e.g. Server Latency across US, EU, and APAC):

```javascript
var sync = CanvasJS.syncCharts([usChart, euChart, apacChart], {
  axisY: "shared"
});
```

---

## Limitations

- **Cartesian Charts Only**: Designed for charts with coordinate axes (`line`, `area`, `column`, `scatter`, `spline`, etc.). Non-axis charts (`pie`, `doughnut`, `funnel`, `pyramid`) are skipped with a warning.
- **One Sync Group Per Chart**: A chart instance can belong to only one sync group at a time. Call `sync.destroy()` or `sync.remove(chart)` before adding to another group.
- **Secondary Y-Axis Alignment**: Left margins align via primary `axisY`. Right margins align when charts use secondary `axisY2`.

---

## License

The **CanvasJS-Sync-Charts** helper is open-source under the [MIT License](LICENSE).  
*Note: CanvasJS Chart itself is a commercial library from Fenopix. A valid CanvasJS license is required to use CanvasJS charts in your applications.*
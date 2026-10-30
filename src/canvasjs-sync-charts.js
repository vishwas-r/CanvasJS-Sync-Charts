/*!
 * canvasjs-sync-charts v1.0.0
 * Synchronize zoom/pan, tooltip and crosshair across multiple CanvasJS charts
 * with a single call, and line up their plot areas.
 *
 * Usage:
 *   var sync = CanvasJS.syncCharts([chart1, chart2, chart3], {
 *     zoom: true, tooltip: true, crosshair: true, alignPlotAreas: true
 *   });
 *   sync.reset();    // reset zoom on every chart
 *   sync.destroy();  // unlink the charts and restore their original options
 *
 * Works with CanvasJS charts that have axes (line, column, area, scatter, etc.).
 * Requires a valid CanvasJS license, same as CanvasJS itself.
 */
(function (root, factory) {
    if (typeof define === "function" && define.amd) {
        define([], function () { return factory(root); });
    } else if (typeof module === "object" && module.exports) {
        module.exports = factory(root);
    } else {
        factory(root);
    }
})(typeof window !== "undefined" ? window : this, function (root) {
    "use strict";

    var VERSION = "1.0.0";
    var NO_AXIS_TYPES = /^(pie|doughnut|funnel|pyramid)$/i;

    var DEFAULTS = {
        zoom: true,              // sync axis X zoom, pan and reset
        tooltip: true,           // show the tooltip at the same x on every chart
        crosshair: true,         // mirror the axis X crosshair on every chart
        axisY: "independent",    // "independent" | "shared" (also sync the Y viewport on zoom)
        snap: "nearest",         // "nearest" | "exact": how tooltip x is matched on other charts
        alignPlotAreas: true,    // equalize plot area edges so x positions line up vertically
        enableZoom: true         // turn on zoomEnabled for charts that did not configure zoom/pan
    };

    /* ---------- small utilities ---------- */

    function isArray(v) { return Object.prototype.toString.call(v) === "[object Array]"; }
    function hasOwn(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }
    function toNum(v) { return (v instanceof Date) ? v.getTime() : +v; }

    function warn(msg) {
        if (typeof console !== "undefined" && console.warn) console.warn("[canvasjs-sync-charts] " + msg);
    }

    function raf(fn) {
        if (root && typeof root.requestAnimationFrame === "function") return root.requestAnimationFrame(fn);
        return setTimeout(fn, 16);
    }

    function indexOf(list, item) {
        for (var i = 0; i < list.length; i++) if (list[i] === item) return i;
        return -1;
    }

    // Returns the options object for the first axis of a kind ("axisX", "axisY", "axisY2"),
    // creating it when asked to. CanvasJS accepts either an object or an array of objects.
    function axisOptions(chart, key, create) {
        var o = chart.options, a = o[key];
        if (isArray(a)) {
            if (!a[0] && create) a[0] = {};
            return a[0] || null;
        }
        if (!a && create) a = o[key] = {};
        return a || null;
    }

    function restore(obj, key, value) {
        if (!obj) return;
        if (value === undefined) delete obj[key]; else obj[key] = value;
    }

    // Calls the handler the developer had set before syncing, without letting it break the sync.
    function callOriginal(fn, ctx, arg) {
        if (typeof fn === "function") fn.call(ctx, arg);
    }

    function isRendered(chart) {
        return !!(chart && chart.plotArea && chart.axisX && chart.axisX.length);
    }

    /* ---------- main factory ---------- */

    function syncCharts(charts, userOptions) {
        var opts = {}, k;
        for (k in DEFAULTS) if (hasOwn(DEFAULTS, k)) opts[k] = DEFAULTS[k];
        if (userOptions) for (k in userOptions) if (hasOwn(userOptions, k) && userOptions[k] !== undefined) opts[k] = userOptions[k];

        var state = {
            recs: [],
            dirty: [],
            scheduled: false,
            busy: false,       // true while we push changes to other charts (prevents echo)
            internal: false,   // true while we render charts ourselves
            destroyed: false,
            resizeTimer: null
        };

        /* ----- per-chart record ----- */

        function findRec(chart) {
            for (var i = 0; i < state.recs.length; i++) if (state.recs[i].chart === chart) return state.recs[i];
            return null;
        }

        function install(chart) {
            if (!chart || !chart.options || typeof chart.render !== "function") {
                warn("Skipped an item that is not a CanvasJS chart.");
                return null;
            }
            if (findRec(chart)) return null;
            if (chart._canvasjsSync) {
                warn("A chart can belong to only one sync group. Call destroy() on the previous group first.");
                return null;
            }
            var series = chart.options.data || [];
            if (series.length && NO_AXIS_TYPES.test(series[0].type || "")) {
                warn("Skipped a " + series[0].type + " chart. Only charts with axes can be synced.");
                return null;
            }

            var rec = {
                chart: chart, orig: {}, crosshairOk: false, extraL: 0, extraR: 0,
                baseMarginY: null, baseMarginY2: null, cache: []
            };
            var o = chart.options;

            // Zoom / pan
            if (opts.zoom) {
                rec.orig.rangeChanged = o.rangeChanged;
                o.rangeChanged = function (e) {
                    try { callOriginal(rec.orig.rangeChanged, this, e); }
                    finally { onRangeChanged(rec, e); }
                };
                if (opts.enableZoom && o.zoomEnabled === undefined && !o.panEnabled) {
                    o.zoomEnabled = true;
                    rec.orig.zoomEnabledSet = true;
                }
            }

            // Tooltip
            if (opts.tooltip) {
                rec.orig.hadToolTip = !!o.toolTip;
                if (!o.toolTip) o.toolTip = {};
                rec.orig.ttUpdated = o.toolTip.updated;
                rec.orig.ttHidden = o.toolTip.hidden;
                o.toolTip.updated = function (e) {
                    try { callOriginal(rec.orig.ttUpdated, this, e); }
                    finally { onToolTipUpdated(rec, e); }
                };
                o.toolTip.hidden = function (e) {
                    try { callOriginal(rec.orig.ttHidden, this, e); }
                    finally { onToolTipHidden(rec); }
                };
            }

            // Crosshair on axis X
            if (opts.crosshair) {
                var ax = axisOptions(chart, "axisX", true);
                rec.orig.hadCrosshair = !!ax.crosshair;
                if (!ax.crosshair) ax.crosshair = {};
                if (ax.crosshair.enabled === undefined) {
                    ax.crosshair.enabled = true;
                    rec.orig.crosshairEnabledSet = true;
                }
                if (ax.crosshair.enabled !== false) {
                    rec.crosshairOk = true;
                    rec.orig.chUpdated = ax.crosshair.updated;
                    rec.orig.chHidden = ax.crosshair.hidden;
                    ax.crosshair.updated = function (e) {
                        try { callOriginal(rec.orig.chUpdated, this, e); }
                        finally { onCrosshairUpdated(rec, e); }
                    };
                    ax.crosshair.hidden = function (e) {
                        try { callOriginal(rec.orig.chHidden, this, e); }
                        finally { onCrosshairHidden(rec); }
                    };
                }
            }

            // Re-align plot areas whenever the chart renders by itself (resize, data update, ...)
            if (opts.alignPlotAreas) {
                rec.orig.ownRender = hasOwn(chart, "render");
                rec.orig.render = chart.render;
                chart.render = function () {
                    var result = rec.orig.render.apply(this, arguments);
                    if (!state.internal && !state.destroyed) schedule();
                    return result;
                };
            }

            chart._canvasjsSync = true;
            state.recs.push(rec);
            return rec;
        }

        function uninstall(rec) {
            var chart = rec.chart, o = chart.options, ax, ay, ay2;

            if (opts.zoom) {
                restore(o, "rangeChanged", rec.orig.rangeChanged);
                if (rec.orig.zoomEnabledSet) delete o.zoomEnabled;
            }
            if (opts.tooltip && o.toolTip) {
                restore(o.toolTip, "updated", rec.orig.ttUpdated);
                restore(o.toolTip, "hidden", rec.orig.ttHidden);
                if (!rec.orig.hadToolTip) delete o.toolTip;
            }
            if (opts.crosshair) {
                ax = axisOptions(chart, "axisX", false);
                if (ax && ax.crosshair) {
                    if (rec.crosshairOk) {
                        restore(ax.crosshair, "updated", rec.orig.chUpdated);
                        restore(ax.crosshair, "hidden", rec.orig.chHidden);
                    }
                    if (rec.orig.crosshairEnabledSet) delete ax.crosshair.enabled;
                    if (!rec.orig.hadCrosshair) delete ax.crosshair;
                }
            }
            if (opts.alignPlotAreas) {
                if (rec.baseMarginY !== null) {
                    ay = axisOptions(chart, "axisY", false);
                    if (ay) restore(ay, "margin", rec.origMarginY);
                }
                if (rec.baseMarginY2 !== null) {
                    ay2 = axisOptions(chart, "axisY2", false);
                    if (ay2) restore(ay2, "margin", rec.origMarginY2);
                }
                if (rec.orig.ownRender) chart.render = rec.orig.render; else delete chart.render;
            }
            delete chart._canvasjsSync;
        }

        /* ----- batching: one render per chart per frame ----- */

        function schedule() {
            if (state.scheduled || state.destroyed) return;
            state.scheduled = true;
            raf(function () { state.scheduled = false; flush(); });
        }

        function markDirty(rec) {
            if (indexOf(state.dirty, rec) < 0) state.dirty.push(rec);
            schedule();
        }

        function flush() {
            if (state.destroyed) return;
            var dirty = state.dirty;
            state.dirty = [];
            var wasInternal = state.internal;
            state.internal = true;
            try {
                for (var i = 0; i < dirty.length; i++) {
                    if (indexOf(state.recs, dirty[i]) >= 0) dirty[i].chart.render();
                }
                alignNow();
            } catch (err) {
                warn("Sync update failed: " + (err && err.message ? err.message : err));
            } finally {
                state.internal = wasInternal;
            }
        }

        /* ----- zoom / pan ----- */

        function setViewport(axisOpts, min, max) {
            axisOpts.viewportMinimum = (min === undefined) ? null : min;
            axisOpts.viewportMaximum = (max === undefined) ? null : max;
        }

        function onRangeChanged(rec, e) {
            if (state.destroyed || state.busy || !e) return;
            var reset = e.trigger === "reset";
            var ex = e.axisX && e.axisX[0];
            var ey = e.axisY && e.axisY[0];
            state.busy = true;
            try {
                for (var i = 0; i < state.recs.length; i++) {
                    var other = state.recs[i];
                    if (other === rec) continue;
                    var ax = axisOptions(other.chart, "axisX", true);
                    if (reset || !ex) setViewport(ax, null, null);
                    else setViewport(ax, ex.viewportMinimum, ex.viewportMaximum);
                    if (opts.axisY === "shared") {
                        var ay = axisOptions(other.chart, "axisY", true);
                        if (reset || !ey) setViewport(ay, null, null);
                        else setViewport(ay, ey.viewportMinimum, ey.viewportMaximum);
                    }
                    markDirty(other);
                }
            } finally {
                state.busy = false;
            }
            // The source chart may need a new plot area margin after its Y labels changed
            schedule();
        }

        /* ----- tooltip ----- */

        function seriesXs(rec, index, series) {
            var dps = series.dataPoints;
            if (!dps) return null;
            var c = rec.cache[index];
            if (!c || c.ref !== dps || c.len !== dps.length) {
                var xs = new Array(dps.length), sorted = true, prev = -Infinity;
                for (var j = 0; j < dps.length; j++) {
                    var dp = dps[j];
                    var v = (dp && dp.x !== undefined && dp.x !== null) ? toNum(dp.x) : j;
                    xs[j] = v;
                    if (v < prev) sorted = false;
                    prev = v;
                }
                c = rec.cache[index] = { ref: dps, len: dps.length, xs: xs, sorted: sorted };
            }
            return c;
        }

        function nearestIndex(c, target) {
            var xs = c.xs, n = xs.length, best = -1, bestDiff = Infinity, i, d;
            if (!n) return -1;
            if (c.sorted) {
                var lo = 0, hi = n - 1;
                while (lo < hi) {
                    var mid = (lo + hi) >> 1;
                    if (xs[mid] < target) lo = mid + 1; else hi = mid;
                }
                best = lo;
                if (lo > 0 && Math.abs(xs[lo - 1] - target) <= Math.abs(xs[lo] - target)) best = lo - 1;
                return best;
            }
            for (i = 0; i < n; i++) {
                d = Math.abs(xs[i] - target);
                if (d < bestDiff) { bestDiff = d; best = i; }
            }
            return best;
        }

        // Finds the x value of the data point closest to x in any visible series of the chart.
        function nearestX(rec, x) {
            var data = rec.chart.options.data || [];
            var target = toNum(x), bestDiff = Infinity, bestX;
            for (var s = 0; s < data.length; s++) {
                if (data[s].visible === false) continue;
                var c = seriesXs(rec, s, data[s]);
                if (!c) continue;
                var idx = nearestIndex(c, target);
                if (idx < 0) continue;
                var diff = Math.abs(c.xs[idx] - target);
                if (diff < bestDiff) {
                    bestDiff = diff;
                    var dp = data[s].dataPoints[idx];
                    bestX = (dp && dp.x !== undefined && dp.x !== null) ? dp.x : idx;
                }
            }
            return bestX;
        }

        function inViewport(chart, x) {
            var axis = chart.axisX && chart.axisX[0];
            if (!axis) return true;
            var min = axis.viewportMinimum, max = axis.viewportMaximum, t = toNum(x);
            if (typeof min === "number" && t < min) return false;
            if (typeof max === "number" && t > max) return false;
            return true;
        }

        function onToolTipUpdated(rec, e) {
            if (state.destroyed || state.busy || !e || !e.entries || !e.entries[0]) return;
            var x = e.entries[0].xValue;
            if (x === undefined || x === null) return;
            state.busy = true;
            try {
                for (var i = 0; i < state.recs.length; i++) {
                    var other = state.recs[i];
                    if (other === rec || !other.chart.toolTip) continue;
                    var target = (opts.snap === "exact") ? x : nearestX(other, x);
                    if (target === undefined || !inViewport(other.chart, target)) {
                        other.chart.toolTip.hide();
                    } else {
                        other.chart.toolTip.showAtX(target);
                    }
                }
            } finally {
                state.busy = false;
            }
        }

        function onToolTipHidden(rec) {
            if (state.destroyed || state.busy) return;
            state.busy = true;
            try {
                for (var i = 0; i < state.recs.length; i++) {
                    var other = state.recs[i];
                    if (other !== rec && other.chart.toolTip) other.chart.toolTip.hide();
                }
            } finally {
                state.busy = false;
            }
        }

        /* ----- crosshair ----- */

        function crosshairOf(rec) {
            var axis = rec.chart.axisX && rec.chart.axisX[0];
            return (rec.crosshairOk && axis && axis.crosshair) ? axis.crosshair : null;
        }

        function onCrosshairUpdated(rec, e) {
            if (state.destroyed || state.busy || !e || e.value === undefined || e.value === null) return;
            state.busy = true;
            try {
                for (var i = 0; i < state.recs.length; i++) {
                    var other = state.recs[i];
                    if (other === rec) continue;
                    var ch = crosshairOf(other);
                    if (!ch) continue;
                    if (inViewport(other.chart, e.value)) ch.showAt(e.value); else ch.hide();
                }
            } finally {
                state.busy = false;
            }
        }

        function onCrosshairHidden(rec) {
            if (state.destroyed || state.busy) return;
            state.busy = true;
            try {
                for (var i = 0; i < state.recs.length; i++) {
                    var other = state.recs[i];
                    if (other === rec) continue;
                    var ch = crosshairOf(other);
                    if (ch) ch.hide();
                }
            } finally {
                state.busy = false;
            }
        }

        /* ----- plot area alignment ----- */

        function round(v) { return Math.round(v); }

        // Margin added to an axis moves the plot area edge by exactly that amount, so
        // "natural" edge = measured edge - what we added. Every chart then gets padded
        // up to the widest natural edge.
        function alignNow() {
            if (!opts.alignPlotAreas) return;
            var rendered = [], left = [], right = [], changed = [], i, r;
            for (i = 0; i < state.recs.length; i++) {
                r = state.recs[i];
                if (!isRendered(r.chart)) continue;
                rendered.push(r);
                if (r.chart.axisY && r.chart.axisY.length) left.push(r);
                if (r.chart.axisY2 && r.chart.axisY2.length) right.push(r);
            }
            if (rendered.length < 2) return;

            // Left edge: charts with a primary Y axis
            var targetL = -Infinity;
            if (left.length > 1) {
                for (i = 0; i < left.length; i++) {
                    r = left[i];
                    if (r.baseMarginY === null) {
                        var ayo = axisOptions(r.chart, "axisY", true);
                        r.origMarginY = ayo.margin;
                        r.baseMarginY = (typeof ayo.margin === "number") ? ayo.margin : r.chart.axisY[0].margin;
                        if (typeof r.baseMarginY !== "number") r.baseMarginY = 0;
                    }
                    r.naturalL = r.chart.plotArea.x1 - r.extraL;
                    if (r.naturalL > targetL) targetL = r.naturalL;
                }
                for (i = 0; i < left.length; i++) {
                    r = left[i];
                    var extraL = round(targetL - r.naturalL);
                    if (extraL !== r.extraL) {
                        axisOptions(r.chart, "axisY", true).margin = r.baseMarginY + extraL;
                        r.extraL = extraL;
                        if (indexOf(changed, r) < 0) changed.push(r);
                    }
                }
            }

            // Right edge: only charts that use a secondary Y axis can be padded on that side
            var targetR = -Infinity;
            if (right.length > 1) {
                for (i = 0; i < right.length; i++) {
                    r = right[i];
                    if (r.baseMarginY2 === null) {
                        var ay2o = axisOptions(r.chart, "axisY2", true);
                        r.origMarginY2 = ay2o.margin;
                        r.baseMarginY2 = (typeof ay2o.margin === "number") ? ay2o.margin : r.chart.axisY2[0].margin;
                        if (typeof r.baseMarginY2 !== "number") r.baseMarginY2 = 0;
                    }
                    r.naturalR = r.chart.width - r.chart.plotArea.x2 - r.extraR;
                    if (r.naturalR > targetR) targetR = r.naturalR;
                }
                for (i = 0; i < right.length; i++) {
                    r = right[i];
                    var extraR = round(targetR - r.naturalR);
                    if (extraR !== r.extraR) {
                        axisOptions(r.chart, "axisY2", true).margin = r.baseMarginY2 + extraR;
                        r.extraR = extraR;
                        if (indexOf(changed, r) < 0) changed.push(r);
                    }
                }
            }

            for (i = 0; i < changed.length; i++) changed[i].chart.render();
        }

        function onWindowResize() {
            if (state.resizeTimer) clearTimeout(state.resizeTimer);
            state.resizeTimer = setTimeout(function () { state.resizeTimer = null; schedule(); }, 150);
        }

        /* ----- public controller ----- */

        var api = {
            version: VERSION,

            // Adds charts to the group. Safe to call with charts that are already rendered.
            add: function () {
                var added = [];
                var list = Array.prototype.slice.call(arguments);
                if (list.length === 1 && isArray(list[0])) list = list[0];
                for (var i = 0; i < list.length; i++) {
                    var rec = install(list[i]);
                    if (rec) added.push(rec);
                }
                for (var j = 0; j < added.length; j++) added[j].chart.render();
                if (added.length) schedule();
                return api;
            },

            // Removes a chart from the group and restores its original options.
            remove: function (chart) {
                var rec = findRec(chart);
                if (!rec) return api;
                state.recs.splice(indexOf(state.recs, rec), 1);
                uninstall(rec);
                chart.render();
                schedule();
                return api;
            },

            // Resets zoom and pan on every chart.
            reset: function () {
                state.busy = true;
                try {
                    for (var i = 0; i < state.recs.length; i++) {
                        var rec = state.recs[i];
                        setViewport(axisOptions(rec.chart, "axisX", true), null, null);
                        if (opts.axisY === "shared") setViewport(axisOptions(rec.chart, "axisY", true), null, null);
                        if (indexOf(state.dirty, rec) < 0) state.dirty.push(rec);
                    }
                } finally {
                    state.busy = false;
                }
                flush();
                return api;
            },

            // Recomputes plot area alignment. Call it after changing a chart's layout yourself.
            align: function () {
                var was = state.internal;
                state.internal = true;
                try { alignNow(); } finally { state.internal = was; }
                return api;
            },

            // Drops cached lookup data. Call it after replacing dataPoints arrays in place.
            refresh: function () {
                for (var i = 0; i < state.recs.length; i++) state.recs[i].cache = [];
                return api;
            },

            charts: function () {
                var out = [];
                for (var i = 0; i < state.recs.length; i++) out.push(state.recs[i].chart);
                return out;
            },

            // Unlinks every chart and puts back the options that were set before syncing.
            destroy: function () {
                if (state.destroyed) return;
                state.destroyed = true;
                if (state.resizeTimer) clearTimeout(state.resizeTimer);
                if (root && root.removeEventListener) root.removeEventListener("resize", onWindowResize);
                var recs = state.recs;
                state.recs = [];
                state.dirty = [];
                for (var i = 0; i < recs.length; i++) {
                    uninstall(recs[i]);
                    recs[i].chart.render();
                }
            }
        };

        if (root && root.addEventListener) root.addEventListener("resize", onWindowResize);
        api.add(charts || []);
        return api;
    }

    syncCharts.version = VERSION;
    syncCharts.defaults = DEFAULTS;

    // Attach to the CanvasJS global when it is already loaded (script tag usage).
    // With bundlers: import CanvasJS from "@canvasjs/charts"; syncCharts.install(CanvasJS);
    syncCharts.install = function (CanvasJS) {
        if (CanvasJS) CanvasJS.syncCharts = syncCharts;
        return syncCharts;
    };
    if (root && root.CanvasJS) syncCharts.install(root.CanvasJS);

    return syncCharts;
});
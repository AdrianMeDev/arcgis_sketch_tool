import { Injectable, NgZone } from '@angular/core';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import Point from '@arcgis/core/geometry/Point';
import Polyline from '@arcgis/core/geometry/Polyline';
import Polygon from '@arcgis/core/geometry/Polygon';
import SimpleFillSymbol from '@arcgis/core/symbols/SimpleFillSymbol';
import SimpleLineSymbol from '@arcgis/core/symbols/SimpleLineSymbol';
import SimpleMarkerSymbol from '@arcgis/core/symbols/SimpleMarkerSymbol';
import TextSymbol from '@arcgis/core/symbols/TextSymbol';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import type { DrawSettings, GeometryTool } from '../models/draw-settings';
import { MeasurementService } from './measurement.service';
import { Subject } from 'rxjs';
import { SelectionMeasurement } from '../models/selection-measurements';

@Injectable({ providedIn: 'root' })
export class SketchService {
  private view!: MapView;
  private drawLayer!: GraphicsLayer;
  private labelLayer!: GraphicsLayer;
  private textLayer!: GraphicsLayer;
  public svm!: SketchViewModel;
  private textClickHandler: IHandle | null = null;
  private tempLabels: Graphic[] = [];
  // Selection tool state: when set, create events act as selection geometry
  private selectionMode: 'rectangle' | null = null;
  private isEditing = false;
  private reflowTimer: any = null;

  // Temporary merged layer for joint editing across layers
  private selectionLayer?: GraphicsLayer;
  private selectionMap = new Map<Graphic, Graphic>(); // clone -> source

  // Measurements stream for selection/update
  private measurementsSubject = new Subject<SelectionMeasurement[]>();
  public readonly measurements$ = this.measurementsSubject.asObservable();

  // Persisted labels per sketched graphic
  private labelIndex = new Map<string, Graphic[]>();

  public getGraphicId(graphic: Graphic): string {
    let id = (graphic as any).__sid as string | undefined;
    if (!id) {
      id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      (graphic as any).__sid = id;
    }
    return id;
  }

  // Expose all graphics for the table component
  private allGraphicsSubject = new Subject<Graphic[]>();
  public readonly allGraphics$ = this.allGraphicsSubject.asObservable();

  // Expose selected graphic IDs for the table component
  private selectedGraphicIdsSubject = new Subject<string[]>();
  public readonly selectedGraphicIds$ = this.selectedGraphicIdsSubject.asObservable();

  private removePersistedLabelsFor(graphic: Graphic): void {
    const id = (graphic as any).__sid as string | undefined;
    if (!id) return;
    const arr = this.labelIndex.get(id);
    if (arr?.length) {
      arr.forEach((g) => this.labelLayer.remove(g));
    }
    this.labelIndex.delete(id);
  }

  constructor(private zone: NgZone, private measure: MeasurementService) {}

  initialize(
    view: MapView,
    drawLayer: GraphicsLayer,
    labelLayer: GraphicsLayer,
    textLayer: GraphicsLayer
  ): void {
    this.view = view;
    this.drawLayer = drawLayer;
    this.labelLayer = labelLayer;
    this.textLayer = textLayer;

    this.svm = new SketchViewModel({
      view: this.view,
      layer: this.drawLayer,
      defaultCreateOptions: { mode: 'click' },
      updateOnGraphicClick: true,
      polygonSymbol: new SimpleFillSymbol({
        color: [0, 120, 255, 0.2],
        outline: new SimpleLineSymbol({ color: [0, 120, 255, 1], width: 2 }),
      }),
      polylineSymbol: new SimpleLineSymbol({
        color: [0, 120, 255, 1],
        width: 2,
      }),
      pointSymbol: new SimpleMarkerSymbol({ color: [0, 120, 255, 1], size: 8 }),
    });

    // Recompute screen-offset labels after navigation/zoom
    this.view.watch('stationary', (v: boolean) => {
      if (v) this.reflowAllLabelsDebounced();
    });
    this.view.watch('scale', () => this.reflowAllLabelsDebounced());

    // Enable click-to-edit for text graphics by routing them through selectionLayer
    this.view.on('click', async (e) => {
      // Do not intercept when placing text or drawing a selection
      if (this.textClickHandler || this.selectionMode) return;

      try {
        const hit = await this.view.hitTest(e, {
          include: [this.textLayer],
        } as any);
        const first: any = hit?.results?.find(
          (r: any) => r.graphic && r.graphic.layer === this.textLayer
        );
        if (first?.graphic) {
          const src: Graphic = first.graphic as Graphic;

          // Prepare temp selection layer and clone
          this.prepareSelectionLayer(true);
          const clone = this.cloneGraphic(src);
          this.selectionLayer!.add(clone);
          this.selectionMap.set(clone, src);

          // Switch SVM to selection layer and start update on the clone
          (this.svm as any).layer = this.selectionLayer!;
          this.svm.update([clone] as any);
          this.publishMeasurementsFromGraphics([clone]);
        }
      } catch {
        // ignore
      }
    });

    // Dynamic labeling during draw and finalize on complete
    this.svm.on('create', (evt) => {
      const settings = this.currentSettings;
      const geom = evt.graphic?.geometry as
        | Point
        | Polyline
        | Polygon
        | undefined;

      if (!settings) {
        // No settings to guide labeling/symbols
        return;
      }

      // Selection mode: treat created geometry as a selection window and select graphics across layers
      if (this.selectionMode) {
        if ((evt as any).state === 'active') {
          // Ignore temp label updates while drawing selection geometry
          return;
        }
        if ((evt as any).state === 'complete' && geom) {
          try {
            // Remove the selection graphic from the draw layer (do not persist)
            if (evt.graphic) {
              this.drawLayer.remove(evt.graphic as Graphic);
            }
            const selected: Graphic[] = [];

            // Select from draw layer (user graphics)
            (this.drawLayer.graphics as unknown as Graphic[]).forEach((g) => {
              if (
                g.geometry &&
                geometryEngine.intersects(g.geometry as any, geom as any)
              ) {
                selected.push(g);
              }
            });

            // Select from text layer (free text points)
            (this.textLayer.graphics as unknown as Graphic[]).forEach((g) => {
              if (
                g.geometry &&
                geometryEngine.intersects(g.geometry as any, geom as any)
              ) {
                selected.push(g);
              }
            });

            if (selected.length) {
              // Build a temporary selection layer with clones of all selected graphics
              this.prepareSelectionLayer(true);
              selected.forEach((src) => {
                const clone = this.cloneGraphic(src);
                this.selectionLayer!.add(clone);
                this.selectionMap.set(clone, src);
              });

              // Switch SVM to selection layer and enter update mode
              (this.svm as any).layer = this.selectionLayer!;
              const toEdit = (this.selectionLayer!.graphics as any).toArray
                ? (this.selectionLayer!.graphics as any).toArray()
                : Array.from(this.selectionLayer!.graphics as any);
              this.svm.update(toEdit);
              this.publishMeasurementsFromGraphics(toEdit as Graphic[]);

              // Get IDs of original graphics from the clones
              const originalSelectedIds = toEdit
                .map((clone: Graphic) => this.selectionMap.get(clone))
                .filter((src: Graphic | undefined): src is Graphic => src !== undefined)
                .map((src: Graphic) => this.getGraphicId(src));

              this.setSelectedGraphicIds(originalSelectedIds);
            }
          } finally {
            // Reset selection mode
            this.selectionMode = null;
            // Clear any temp labels
            this.clearTempLabels();
          }
        }
        if ((evt as any).state === 'cancel') {
          this.selectionMode = null;
          this.clearTempLabels();
          this.setSelectedGraphicIds([]);
        }
        return;
      }

      if ((evt as any).state === 'active' && geom) {
        this.isEditing = true;
        // During draw: update temporary measurement labels if enabled
        this.clearTempLabels();
        if (settings.labels.showDuringDraw) {
          const labels = this.makeLabelsForGeometry(geom, settings);
          this.tempLabels = labels;
          labels.forEach((g) => this.labelLayer.add(g));
        }
      }

      if ((evt as any).state === 'complete' && geom) {
        this.isEditing = false;
        // Finalize: remove any temp labels and persist fresh labels indexed by graphic
        this.clearTempLabels();

        const g = evt.graphic as Graphic;
        try {
          (g as any).attributes = {
            ...(g as any).attributes,
            tool: settings.tool,
          };
        } catch {}
        const gid = this.getGraphicId(g);
        this.removePersistedLabelsFor(g);

        const persisted: Graphic[] = [];
        const labels = this.makeLabelsForGeometry(geom, settings);
        labels.forEach((lg) => {
          this.labelLayer.add(lg);
          persisted.push(lg);
        });

        if (settings.labels.showTitle) {
          const titleG = this.placeTitleLabel(geom as any, settings);
          if (titleG !== null) persisted.push(titleG);
        }

        this.labelIndex.set(gid, persisted);
      }

      if ((evt as any).state === 'cancel') {
        this.isEditing = false;
        this.clearTempLabels();
      }
    });

    // Recompute labels while updating existing graphics and on commit
    this.svm.on('update', (evt) => {
      const settings = this.currentSettings;
      if (!settings) return;

      if ((evt as any).state === 'active') {
        this.isEditing = true;
        // Live-updating labels for all selected graphics
        this.clearTempLabels();
        if (settings.labels.showDuringDraw) {
          (evt.graphics ?? []).forEach((g) => {
            const geom = g.geometry as Point | Polyline | Polygon | undefined;
            if (!geom) return;
            const labels = this.makeLabelsForGeometry(geom, settings);
            labels.forEach((lg) => {
              this.labelLayer.add(lg);
              this.tempLabels.push(lg);
            });
          });
        }
        this.publishMeasurementsFromGraphics(
          (evt.graphics ?? []) as unknown as Graphic[]
        );
        // Publish selected graphic IDs
        const selectedIds = (evt.graphics ?? []).map((g: Graphic) => this.getGraphicId(g));
        this.setSelectedGraphicIds(selectedIds);
      }

      if ((evt as any).state === 'complete') {
        this.isEditing = false;
        // If editing via selectionLayer, copy geometry back to sources and teardown selection
        if (
          this.selectionLayer &&
          (this.svm as any).layer === this.selectionLayer
        ) {
          try {
            this.publishMeasurementsFromGraphics(
              (evt.graphics ?? []) as unknown as Graphic[]
            );
            (evt.graphics ?? []).forEach((g) => {
              const src = this.selectionMap.get(g as Graphic);
              if (!src) return;
              const newGeom = (g.geometry as any)?.clone
                ? (g.geometry as any).clone()
                : g.geometry;
              (src as any).geometry = newGeom;
            });
          } finally {
            this.endSelectionEdit();
          }
          return;
        }

        // Persist refreshed labels per graphic (normal edit path)
        this.clearTempLabels();

        (evt.graphics ?? []).forEach((g) => {
          const geom = g.geometry as Point | Polyline | Polygon | undefined;
          if (!geom) return;

          const gid = this.getGraphicId(g as Graphic);
          this.removePersistedLabelsFor(g as Graphic);

          const persisted: Graphic[] = [];
          const labels = this.makeLabelsForGeometry(geom, settings);
          labels.forEach((lg) => {
            this.labelLayer.add(lg);
            persisted.push(lg);
          });

          if (settings.labels.showTitle) {
            const titleG = this.placeTitleLabel(geom as any, settings);
            if (titleG !== null) persisted.push(titleG);
          }

          this.labelIndex.set(gid, persisted);
        });
        // Clear selected graphic IDs on complete
        this.setSelectedGraphicIds([]);
      }

      if ((evt as any).state === 'cancel') {
        this.isEditing = false;
        this.clearTempLabels();
        // Clear selected graphic IDs on cancel
        this.setSelectedGraphicIds([]);
      }
    });
    this.publishAllGraphics();
  }

  private currentSettings: DrawSettings | null = null;

  // Update settings at runtime (while drawing). Also refresh default symbols.
  updateSettings(settings: DrawSettings): void {
    this.currentSettings = settings;
    if (this.svm) {
      this.applyDefaultSymbols(settings);
      this.reflowAllLabelsDebounced();
    }
  }

  startDraw(settings: DrawSettings): void {
    this.currentSettings = settings;

    // End any selection edit and restore default layer
    this.endSelectionEdit(false);
    this.publishAllGraphics();

    // Clear any previous one-off text handler
    this.textClickHandler?.remove();
    this.textClickHandler = null;

    // Apply dynamic symbols to SketchViewModel
    this.applyDefaultSymbols(settings);
    (this.svm as any).layer = this.drawLayer;

    // Start the correct tool
    switch (settings.tool as GeometryTool) {
      case 'point':
        this.svm.create('point');
        break;
      case 'polyline':
        this.svm.create('polyline');
        break;
      case 'polygon':
        this.svm.create('polygon');
        break;
      case 'rectangle':
        this.svm.create('rectangle');
        break;
      case 'circle':
        this.svm.create('circle');
        break;
      case 'text':
        // Implement manual text placement on next click
        this.enableTextPlacement(settings);
        break;
    }
  }

  clearAll(): void {
    this.drawLayer.removeAll();
    this.labelLayer.removeAll();
    this.textLayer.removeAll();
    this.publishAllGraphics();
  }

  // Start a selection tool that selects any graphics intersecting the drawn shape
  startSelection(mode: 'rectangle'): void {
    // ensure no lingering text click handler
    this.textClickHandler?.remove();
    this.textClickHandler = null;
    this.selectionMode = mode;
    this.clearTempLabels();
    if (mode === 'rectangle') {
      this.svm.create('rectangle');
    }
  }

  // --- Helpers ---

  private enableTextPlacement(settings: DrawSettings): void {
    this.textClickHandler = this.view.on('click', (e) => {
      this.zone.runOutsideAngular(() => {
        const p = new Point({
          x: e.mapPoint.x,
          y: e.mapPoint.y,
          spatialReference: this.view.spatialReference,
        });

        const textSymbol = new TextSymbol({
          text: settings.text.content,
          color: this.hexToRgbArray(settings.text.color, 1),
          haloColor: this.hexToRgbArray(settings.text.haloColor, 1),
          haloSize: settings.text.haloSize,
          font: {
            family: settings.text.fontFamily,
            size: settings.text.fontSize,
          } as any,
        });

        const g = new Graphic({
          geometry: p,
          symbol: textSymbol,
          attributes: { tool: 'text', title: settings.text.content },
        });
        this.textLayer.add(g);
        this.publishAllGraphics();
      });

      // single-use
      this.textClickHandler?.remove();
      this.textClickHandler = null;
    });
  }

  private applyDefaultSymbols(settings: DrawSettings): void {
    const outline = new SimpleLineSymbol({
      color: this.hexToRgbArray(settings.outlineColor, 1),
      width: settings.outlineWidth,
    });

    this.svm.pointSymbol = new SimpleMarkerSymbol({
      color: this.hexToRgbArray(settings.fillColor, 1),
      size: 8,
      outline,
    });

    this.svm.polylineSymbol = outline;

    this.svm.polygonSymbol = new SimpleFillSymbol({
      color: this.hexToRgbArray(settings.fillColor, settings.fillOpacity),
      outline,
    });
  }

  private clearTempLabels(): void {
    if (!this.tempLabels.length) return;
    this.tempLabels.forEach((g) => this.labelLayer.remove(g));
    this.tempLabels = [];
  }

  // Offset a point by screen pixels to avoid label overlap
  private offsetPoint(p: Point, dxPx: number, dyPx: number): Point {
    try {
      const scr = this.view?.toScreen(p);
      if (!scr) return p;
      const mapped = this.view.toMap({
        x: scr.x + dxPx,
        y: scr.y + dyPx,
      } as any);
      return (mapped as Point) ?? p;
    } catch {
      return p;
    }
  }

  // Debounced reflow to keep labels aligned with current zoom/scale
  private reflowAllLabelsDebounced(): void {
    if (this.isEditing) return;
    if (this.reflowTimer) {
      clearTimeout(this.reflowTimer);
      this.reflowTimer = null;
    }
    this.reflowTimer = setTimeout(() => this.reflowAllLabels(), 80);
  }

  // Rebuild persisted labels for all graphics using current settings and view scale
  private reflowAllLabels(): void {
    const settings = this.currentSettings;
    if (!settings || !this.view || !this.drawLayer || !this.labelLayer) return;

    // Remove existing persisted labels while preserving any temporary in-flight labels
    if (
      this.labelIndex.size === 0 &&
      (this.labelLayer.graphics.length ?? 0) > 0
    ) {
      // No index to remove by; clear all labels and rebuild cleanly
      this.labelLayer.removeAll();
    } else {
      this.labelIndex.forEach((arr) =>
        arr.forEach((g) => this.labelLayer.remove(g))
      );
    }
    this.labelIndex.clear();

    // Recreate labels per graphic
    (this.drawLayer.graphics as unknown as Graphic[]).forEach((g) => {
      const geom = g.geometry as Point | Polyline | Polygon | undefined;
      if (!geom) return;

      const gid = this.getGraphicId(g);
      const persisted: Graphic[] = [];

      const labels = this.makeLabelsForGeometry(geom, settings);
      labels.forEach((lg) => {
        this.labelLayer.add(lg);
        persisted.push(lg);
      });

      // Title label handled via center logic for lines/polygons, separate for points
      if (geom instanceof Point && settings.labels.showTitle) {
        const tg = this.placeTitleLabel(geom, settings);
        if (tg) persisted.push(tg);
      }

      this.labelIndex.set(gid, persisted);
    });
  }

  // Create or clear the temporary selection layer
  private prepareSelectionLayer(clear = true): void {
    if (!this.selectionLayer) {
      this.selectionLayer = new GraphicsLayer({ id: 'selection-layer' });
      (this.view.map as any).add(this.selectionLayer);
      // Bring to top
      try {
        (this.view.map as any).reorder(
          this.selectionLayer,
          (this.view.map as any).layers.length - 1
        );
      } catch {
        // ignore
      }
    }
    if (clear) {
      this.selectionLayer.removeAll();
      this.selectionMap.clear();
    }
  }

  private endSelectionEdit(clearLayer = true): void {
    // Restore SVM layer and clear selection artifacts
    if (this.selectionLayer && clearLayer) {
      this.selectionLayer.removeAll();
    }
    this.selectionMap.clear();
    // Clear selection measurements in UI
    this.measurementsSubject.next([]);
    (this.svm as any).layer = this.drawLayer;
    this.selectedGraphicIdsSubject.next([]);
  }

  public setSelectedGraphicIds(ids: string[]): void {
    this.selectedGraphicIdsSubject.next(ids);
  }

  private publishAllGraphics(): void {
    const allGraphics: Graphic[] = [];
    (this.drawLayer.graphics as unknown as Graphic[]).forEach(g => allGraphics.push(g));
    (this.textLayer.graphics as unknown as Graphic[]).forEach(g => allGraphics.push(g));
    this.allGraphicsSubject.next(allGraphics);
  }

  public selectGraphics(graphicIds: string[]): void {
    this.clearSelection(); // Clear any existing selection first

    const graphicsToSelect: Graphic[] = [];
    graphicIds.forEach(graphicId => {
      const graphic = [...(this.drawLayer.graphics as unknown as Graphic[]), ...(this.textLayer.graphics as unknown as Graphic[])]
        .find(g => this.getGraphicId(g) === graphicId);
      if (graphic) {
        graphicsToSelect.push(graphic);
      }
    });

    if (graphicsToSelect.length > 0) {
      this.prepareSelectionLayer(true);
      const clones: Graphic[] = [];
      graphicsToSelect.forEach(src => {
        const clone = this.cloneGraphic(src);
        this.selectionLayer!.add(clone);
        this.selectionMap.set(clone, src);
        clones.push(clone);
      });

      (this.svm as any).layer = this.selectionLayer!;
      this.svm.update(clones as any);
      this.publishMeasurementsFromGraphics(clones);
      this.setSelectedGraphicIds(graphicIds);
    }
  }

  public clearSelection(): void {
    this.svm.cancel();
    this.endSelectionEdit();
  }

  private cloneGraphic(src: Graphic): Graphic {
    const geom = (src.geometry as any)?.clone
      ? (src.geometry as any).clone()
      : src.geometry;
    const sym = (src.symbol as any)?.clone
      ? (src.symbol as any).clone()
      : (src.symbol as any);
    const attrs = src.attributes ? { ...(src.attributes as any) } : undefined;
    return new Graphic({
      geometry: geom as any,
      symbol: sym as any,
      attributes: attrs as any,
    });
  }

  private publishMeasurementsFromGraphics(graphics: Graphic[]): void {
    const settings = this.currentSettings;
    if (!settings) {
      this.measurementsSubject.next([]);
      return;
    }
    const rows = this.buildMeasurementsForGraphics(graphics, settings);
    this.measurementsSubject.next(rows);
  }

  private buildMeasurementsForGraphics(
    graphics: Graphic[],
    settings: DrawSettings
  ): SelectionMeasurement[] {
    const out: SelectionMeasurement[] = [];
    graphics.forEach((g) => {
      const src = this.selectionMap.get(g as Graphic) ?? (g as Graphic);
      const geom = g.geometry as Point | Polyline | Polygon | undefined;
      if (!geom) return;

      if (geom instanceof Polyline) {
        const id = this.getGraphicId(src);
        const tool = (src as any).attributes?.tool as string as any;
        const total = this.measure.geodesicLength(geom);
        const segs = this.measure.segmentLengths(geom);
        out.push({
          id,
          geometryType: 'polyline',
          tool,
          rows: [
            { label: 'Total length', value: this.measure.formatLength(total) },
            { label: 'Segments', value: String(segs.length) },
          ],
        });
      } else if (geom instanceof Polygon) {
        const id = this.getGraphicId(src);
        const tool = (src as any).attributes?.tool as string as any;
        const area = this.measure.geodesicArea(geom);
        const per = this.measure.geodesicPerimeter(geom);
        const rows: { label: string; value: string }[] = [
          { label: 'Area', value: this.measure.formatArea(area) },
          { label: 'Perimeter', value: this.measure.formatLength(per) },
        ];
        if (tool === 'circle') {
          const r = this.measure.radiusFromPolygon(geom);
          rows.push({ label: 'Radius', value: this.measure.formatLength(r) });
        }
        out.push({
          id,
          geometryType: 'polygon',
          tool,
          rows,
        });
      } else {
        // Points/text: no numeric measurements
      }
    });
    return out;
  }

  private makeLabelsForGeometry(
    geom: Polygon | Polyline | Point,
    settings: DrawSettings
  ): Graphic[] {
    const labels: Graphic[] = [];

    const addText = (p: Point, text: string, angle: number = 0) => {
      const symbol = new TextSymbol({
        text,
        color: this.hexToRgbArray(settings.text.color, 1),
        haloColor: this.hexToRgbArray(settings.text.haloColor, 1),
        haloSize: settings.text.haloSize,
        horizontalAlignment: 'center' as any,
        angle: angle, // Set the angle here
        font: {
          family: settings.text.fontFamily,
          size: settings.text.fontSize,
        } as any,
      });
      labels.push(new Graphic({ geometry: p, symbol }));
    };

    if (geom instanceof Polyline) {
      // Segment lengths
      if (settings.labels.showSegmentLengths) {
        const segments = this.measure.getSegments(geom);
        const lens = this.measure.segmentLengths(geom);
        const labelOffsetPx = 10; // Offset distance in pixels

        for (let i = 0; i < Math.min(segments.length, lens.length); i++) {
          const segment = segments[i];
          const midpoint = this.measure.getSegmentMidpoint(segment, geom.spatialReference);
          let angle = this.measure.getSegmentAngle(segment); // Angle in degrees

          // Normalize angle for text readability (e.g., -90 to 90 degrees)
          if (angle > 90) {
            angle -= 180;
          } else if (angle < -90) {
            angle += 180;
          }

          // Calculate offset in screen coordinates
          const angleRad = (angle + 90) * (Math.PI / 180); // Perpendicular angle
          const dxPx = labelOffsetPx * Math.cos(angleRad);
          const dyPx = labelOffsetPx * Math.sin(angleRad);

          const offsetMidpoint = this.offsetPoint(midpoint, dxPx, dyPx);
          addText(offsetMidpoint, this.measure.formatLength(lens[i]), angle);
        }
      }
      // Center labels for polylines: title on top, then total length; uniform spacing
      if (settings.labels.showTitle || settings.labels.showTotals) {
        const center =
          (this.measure.centroidLabelPoint(geom as any) as Point) ||
          (geom as any).extent?.center;
        if (center) {
          const lines: string[] = [];
          if (settings.labels.showTitle) {
            const title = settings.text.content || 'Feature';
            lines.push(title);
          }
          if (settings.labels.showTotals) {
            const total = this.measure.geodesicLength(geom);
            lines.push(`L = ${this.measure.formatLength(total)}`);
          }
          if (lines.length) {
            const lineHeight = Math.round(
              (settings.text?.fontSize ?? 12) * 1.2
            );
            for (let i = 0; i < lines.length; i++) {
              const dy = (i - (lines.length - 1)) * lineHeight; // title at top, then downwards
              addText(this.offsetPoint(center as Point, 0, dy), lines[i]);
            }
          }
        }
      }
    } else if (geom instanceof Polygon) {
      // Segment lengths
      if (settings.labels.showSegmentLengths) {
        const segments = this.measure.getSegments(geom);
        const lens = this.measure.segmentLengths(geom);
        const labelOffsetPx = 10; // Offset distance in pixels

        for (let i = 0; i < Math.min(segments.length, lens.length); i++) {
          const segment = segments[i];
          const midpoint = this.measure.getSegmentMidpoint(segment, geom.spatialReference);
          let angle = this.measure.getSegmentAngle(segment); // Angle in degrees

          // Normalize angle for text readability (e.g., -90 to 90 degrees)
          if (angle > 90) {
            angle -= 180;
          } else if (angle < -90) {
            angle += 180;
          }

          // Calculate offset in screen coordinates
          const angleRad = (angle + 90) * (Math.PI / 180); // Perpendicular angle
          const dxPx = labelOffsetPx * Math.cos(angleRad);
          const dyPx = labelOffsetPx * Math.sin(angleRad);

          const offsetMidpoint = this.offsetPoint(midpoint, dxPx, dyPx);
          addText(offsetMidpoint, this.measure.formatLength(lens[i]), angle);
        }
      }
      // Center labels for polygons: title on top, then A/P and optional R; uniform spacing
      {
        const center =
          this.measure.centroidLabelPoint(geom) || (geom as any).extent?.center;
        if (center) {
          const lines: string[] = [];
          if (settings.labels.showTitle) {
            const title = settings.text.content || 'Feature';
            lines.push(title);
          }
          if (settings.labels.showTotals) {
            const area = this.measure.geodesicArea(geom);
            const per = this.measure.geodesicPerimeter(geom);
            lines.push(`A = ${this.measure.formatArea(area)}`);
            lines.push(`P = ${this.measure.formatLength(per)}`);
          }
          if (settings.labels.showCircleRadius) {
            const r = this.measure.radiusFromPolygon(geom);
            lines.push(`R = ${this.measure.formatLength(r)}`);
          }

          if (lines.length) {
            const lineHeight = Math.round(
              (settings.text?.fontSize ?? 12) * 1.2
            );
            for (let i = 0; i < lines.length; i++) {
              const dy = (i - (lines.length - 1)) * lineHeight; // title on top, then downwards
              addText(this.offsetPoint(center as Point, 0, dy), lines[i]);
            }
          }
        }
      }
    } else if (geom instanceof Point) {
      // No measurements for point; title handled separately
    }

    return labels;
  }

  private placeTitleLabel(
    geom: Polygon | Polyline | Point,
    settings: DrawSettings
  ): Graphic | null {
    const basePt =
      geom instanceof Point
        ? geom
        : this.measure.centroidLabelPoint(geom as any) ??
          (geom as any).extent?.center ??
          null;

    if (!basePt) return null;

    // Title should be the top line: offset it above the measurement block by one standard line step
    const spacing = Math.round((settings.text?.fontSize ?? 12) * 1.0);
    let sep = 0;
    if (geom instanceof Polyline && settings.labels.showTotals) {
      // One line above the single length line at center
      sep = spacing;
    } else if (geom instanceof Polygon) {
      // Number of measurement lines in the center block
      const measurementLines =
        (settings.labels.showTotals ? 2 : 0) +
        (settings.labels.showCircleRadius ? 1 : 0);
      if (measurementLines > 0) {
        // Position title exactly one line above the top of the measurement block
        sep = Math.round(((measurementLines + 1) / 2) * spacing);
      }
    } // Point: 0 => sep stays 0

    const finalPt = sep
      ? this.offsetPoint(basePt as Point, 0, -sep)
      : (basePt as Point);

    const title = settings.text.content || 'Feature';
    const textSymbol = new TextSymbol({
      text: title,
      color: this.hexToRgbArray(settings.text.color, 1),
      haloColor: this.hexToRgbArray(settings.text.haloColor, 1),
      haloSize: settings.text.haloSize,
      horizontalAlignment: 'center' as any,
      font: {
        family: settings.text.fontFamily,
        size: settings.text.fontSize,
      } as any,
    });

    const g = new Graphic({ geometry: finalPt, symbol: textSymbol });
    this.labelLayer.add(g);
    return g;
  }

  private hexToRgbArray(hex: string, alpha = 1): number[] {
    const h = hex.replace('#', '');
    const bigint = parseInt(
      h.length === 3
        ? h
            .split('')
            .map((c) => c + c)
            .join('')
        : h,
      16
    );
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return [r, g, b, alpha];
  }
}

// ArcGIS IHandle type (event handlers)
interface IHandle {
  remove(): void;
}

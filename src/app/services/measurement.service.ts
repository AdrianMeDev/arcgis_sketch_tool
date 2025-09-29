import { Injectable } from '@angular/core';
import * as geometryEngine from '@arcgis/core/geometry/geometryEngine';
import type Geometry from '@arcgis/core/geometry/Geometry';
import Polyline from '@arcgis/core/geometry/Polyline';
import type Polygon from '@arcgis/core/geometry/Polygon';
import Point from '@arcgis/core/geometry/Point';
type LinearUnit =
  | 'meters'
  | 'kilometers'
  | 'feet'
  | 'yards'
  | 'miles'
  | 'nautical-miles';

type AreaUnit =
  | 'square-meters'
  | 'square-kilometers'
  | 'square-feet'
  | 'square-yards'
  | 'square-miles'
  | 'acres'
  | 'hectares';

@Injectable({ providedIn: 'root' })
export class MeasurementService {
  // Defaults: metric with 2 decimals
  private lengthUnit: LinearUnit = 'meters';
  private areaUnit: AreaUnit = 'square-meters';
  private decimals = 2;

  setUnits(opts: { length?: LinearUnit; area?: AreaUnit; decimals?: number }) {
    if (opts.length) this.lengthUnit = opts.length;
    if (opts.area) this.areaUnit = opts.area;
    if (typeof opts.decimals === 'number') this.decimals = opts.decimals;
  }

  // Length (Polyline)
  geodesicLength(geom: Polyline): number {
    return geometryEngine.geodesicLength(geom, this.lengthUnit) ?? 0;
  }

  // Perimeter (Polygon outer ring length)
  geodesicPerimeter(geom: Polygon): number {
    if (!geom) return 0;
    const polyline = new Polyline({
      paths: (geom as any).rings,
      spatialReference: (geom as any).spatialReference,
    });
    return this.geodesicLength(polyline);
  }

  // Area (Polygon) with planar fallback if geodesic unsupported
  geodesicArea(geom: Polygon): number {
    const v = geometryEngine.geodesicArea(geom, this.areaUnit);
    if (!isFinite(v) || v === 0) {
      return geometryEngine.planarArea(geom, this.areaUnit) ?? 0;
    }
    return v ?? 0;
  }

  // Circle radius helper: radius is distance from center to any vertex on ring[0]
  // For dynamic circles drawn by Sketch, VM provides center + edge handle, but for polygons approximate using centroid to first vertex.
  radiusFromPolygon(geom: Polygon): number {
    const center = geom?.centroid as Point;
    const ring0 = geom?.rings?.[0];
    if (!center || !ring0 || ring0.length === 0) return 0;
    const first = new Point({
      x: ring0[0][0],
      y: ring0[0][1],
      spatialReference: geom.spatialReference,
    });
    return geometryEngine.distance(center, first, this.lengthUnit) ?? 0;
  }

  // Formatting helpers (metric, with simple unit scaling)
  formatLength(val: number): string {
    if (this.lengthUnit === 'meters') {
      // Convert to km if large
      if (Math.abs(val) >= 1000)
        return `${(val / 1000).toFixed(this.decimals)} km`;
      return `${val.toFixed(this.decimals)} m`;
    }
    return `${val.toFixed(this.decimals)} ${this.lengthUnit}`;
  }

  formatArea(val: number): string {
    if (this.areaUnit === 'square-meters') {
      // Convert to km² if large
      if (Math.abs(val) >= 1_000_000)
        return `${(val / 1_000_000).toFixed(this.decimals)} km²`;
      return `${val.toFixed(this.decimals)} m²`;
    }
    return `${val.toFixed(this.decimals)} ${this.areaUnit}`;
  }

  // Segment midpoints for per-segment labels (returns Points)
  segmentMidpoints(geom: Polyline | Polygon): Point[] {
    const pts: Point[] = [];
    if (!geom) return pts;

    if ((geom as Polyline).paths) {
      const pl = geom as Polyline;
      const sr = pl.spatialReference;
      (pl.paths ?? []).forEach((path) => {
        for (let i = 0; i < path.length - 1; i++) {
          const [x1, y1] = path[i];
          const [x2, y2] = path[i + 1];
          pts.push(
            new Point({
              x: (x1 + x2) / 2,
              y: (y1 + y2) / 2,
              spatialReference: sr,
            })
          );
        }
      });
    } else {
      const pg = geom as Polygon;
      const sr = pg.spatialReference;
      (pg.rings ?? []).forEach((ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const [x1, y1] = ring[i];
          const [x2, y2] = ring[i + 1];
          pts.push(
            new Point({
              x: (x1 + x2) / 2,
              y: (y1 + y2) / 2,
              spatialReference: sr,
            })
          );
        }
      });
    }
    return pts;
  }

  // Segment lengths (geodesic) for polyline or polygon ring segments
  segmentLengths(geom: Polyline | Polygon): number[] {
    const result: number[] = [];
    if (!geom) return result;

    if ((geom as Polyline).paths) {
      const pl = geom as Polyline;
      (pl.paths ?? []).forEach((path) => {
        for (let i = 0; i < path.length - 1; i++) {
          const seg = {
            type: 'polyline',
            paths: [[path[i], path[i + 1]]],
            spatialReference: pl.spatialReference,
          } as unknown as Polyline;
          result.push(this.geodesicLength(seg));
        }
      });
    } else {
      const pg = geom as Polygon;
      (pg.rings ?? []).forEach((ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          const seg = {
            type: 'polyline',
            paths: [[ring[i], ring[i + 1]]],
            spatialReference: pg.spatialReference,
          } as unknown as Polyline;
          result.push(this.geodesicLength(seg));
        }
      });
    }
    return result;
  }

  centroidLabelPoint(geom: Geometry): Point | null {
    try {
      if ((geom as any).type === 'polygon') {
        const c = (geom as any).centroid as Point;
        return c ?? null;
      }
      const c = (geom as any).extent
        ? ((geom as any).extent.center as Point)
        : ((geom as any).centroid as Point);
      return c ?? null;
    } catch {
      return null;
    }
  }
  getSegments(geom: Polyline | Polygon): [number[], number[]][] {
    const segments: [number[], number[]][] = [];
    if (!geom) return segments;

    if ((geom as Polyline).paths) {
      const pl = geom as Polyline;
      (pl.paths ?? []).forEach((path) => {
        for (let i = 0; i < path.length - 1; i++) {
          segments.push([path[i], path[i + 1]]);
        }
      });
    } else {
      const pg = geom as Polygon;
      (pg.rings ?? []).forEach((ring) => {
        for (let i = 0; i < ring.length - 1; i++) {
          segments.push([ring[i], ring[i + 1]]);
        }
      });
    }
    return segments;
  }

  getSegmentMidpoint(segment: [number[], number[]], spatialReference: any): Point {
    const [[x1, y1], [x2, y2]] = segment;
    return new Point({
      x: (x1 + x2) / 2,
      y: (y1 + y2) / 2,
      spatialReference: spatialReference,
    });
  }

  getSegmentAngle(segment: [number[], number[]]): number {
    const [[x1, y1], [x2, y2]] = segment;
    const dx = x2 - x1;
    const dy = y2 - y1;
    return (Math.atan2(dy, dx) * 180) / Math.PI; // Angle in degrees
  }
}

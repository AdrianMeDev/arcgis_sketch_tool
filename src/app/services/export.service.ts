import { Injectable } from '@angular/core';
import Graphic from '@arcgis/core/Graphic';

type EsriJSON = ReturnType<Graphic['toJSON']>;

interface ExportPayloadV2 {
  version: 2;
  draw: EsriJSON[];
  labels: EsriJSON[];
  text: EsriJSON[];
}

@Injectable({ providedIn: 'root' })
export class ExportService {
  // Export the current draw, label and text graphics to a stable JSON payload
  exportEsriJson(
    draw: Iterable<Graphic> | Graphic[],
    labels: Iterable<Graphic> | Graphic[],
    text: Iterable<Graphic> | Graphic[]
  ): ExportPayloadV2 {
    const toArray = <T>(it: Iterable<T> | T[]): T[] =>
      Array.isArray(it) ? it : Array.from(it as Iterable<T>);

    const drawArr = toArray(draw).map((g) => g.toJSON());
    const labelsArr = toArray(labels).map((g) => g.toJSON());
    const textArr = toArray(text).map((g) => g.toJSON());

    return {
      version: 2,
      draw: drawArr,
      labels: labelsArr,
      text: textArr,
    };
  }

  // Import from a previously exported payload, reconstructing Graphics
  importEsriJson(payload: any): {
    draw: Graphic[];
    labels: Graphic[];
    text: Graphic[];
  } {
    if (!payload || typeof payload !== 'object') {
      return { draw: [], labels: [], text: [] };
    }

    const version = payload.version ?? 1;
    if (version === 1) {
      const draw = Array.isArray(payload.draw)
        ? payload.draw.map((j: any) => Graphic.fromJSON(j))
        : [];
      const labels = Array.isArray(payload.labels)
        ? payload.labels.map((j: any) => Graphic.fromJSON(j))
        : [];
      return { draw, labels, text: [] };
    }
    if (version !== 2) {
      throw new Error(`Unsupported export version: ${version}`);
    }

    const draw = Array.isArray(payload.draw)
      ? payload.draw.map((j: any) => Graphic.fromJSON(j))
      : [];
    const labels = Array.isArray(payload.labels)
      ? payload.labels.map((j: any) => Graphic.fromJSON(j))
      : [];
    const text = Array.isArray(payload.text)
      ? payload.text.map((j: any) => Graphic.fromJSON(j))
      : [];

    return { draw, labels, text };
  }
}

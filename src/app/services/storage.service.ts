import { Injectable } from '@angular/core';
import Graphic from '@arcgis/core/Graphic';
import { DrawSettings } from '../models/draw-settings';

type EsriJSON = ReturnType<Graphic['toJSON']>;

interface StoredGraphicsV1 {
  version: 1;
  draw: EsriJSON[];
  labels: EsriJSON[];
}

interface StoredGraphicsV2 {
  version: 2;
  draw: EsriJSON[];
  labels: EsriJSON[];
  text: EsriJSON[];
}

const SETTINGS_KEY = 'sketch.settings.v1';
const GRAPHICS_KEY_V1 = 'sketch.graphics.v1';
const GRAPHICS_KEY_V2 = 'sketch.graphics.v2';

@Injectable({ providedIn: 'root' })
export class StorageService {
  // Settings
  saveSettings(settings: DrawSettings): void {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch (e) {
      console.error('Failed to save settings', e);
    }
  }

  loadSettings(): DrawSettings | null {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return null;
      return JSON.parse(raw) as DrawSettings;
    } catch (e) {
      console.error('Failed to load settings', e);
      return null;
    }
  }

  // Graphics + Labels + Free Text (text)
  saveGraphics(draw: Graphic[], labels: Graphic[], text: Graphic[] = []): void {
    try {
      const payload: StoredGraphicsV2 = {
        version: 2,
        draw: draw.map((g) => g.toJSON()),
        labels: labels.map((g) => g.toJSON()),
        text: text.map((g) => g.toJSON()),
      };
      localStorage.setItem(GRAPHICS_KEY_V2, JSON.stringify(payload));
    } catch (e) {
      console.error('Failed to save graphics', e);
    }
  }

  loadGraphics(): { draw: Graphic[]; labels: Graphic[]; text: Graphic[] } | null {
    try {
      // Prefer V2; fallback to V1 for backward compatibility
      let raw = localStorage.getItem(GRAPHICS_KEY_V2);
      if (!raw) raw = localStorage.getItem(GRAPHICS_KEY_V1);
      if (!raw) return null;

      const parsed: any = JSON.parse(raw);

      if (!parsed || typeof parsed.version !== 'number') return null;

      if (parsed.version === 1) {
        const v1 = parsed as StoredGraphicsV1;
        const draw = (v1.draw ?? []).map((j) => Graphic.fromJSON(j));
        const labels = (v1.labels ?? []).map((j) => Graphic.fromJSON(j));
        return { draw, labels, text: [] };
      }

      if (parsed.version === 2) {
        const v2 = parsed as StoredGraphicsV2;
        const draw = (v2.draw ?? []).map((j) => Graphic.fromJSON(j));
        const labels = (v2.labels ?? []).map((j) => Graphic.fromJSON(j));
        const text = (v2.text ?? []).map((j) => Graphic.fromJSON(j));
        return { draw, labels, text };
      }

      return null;
    } catch (e) {
      console.error('Failed to load graphics', e);
      return null;
    }
  }

  clearAll(): void {
    try {
      localStorage.removeItem(SETTINGS_KEY);
      localStorage.removeItem(GRAPHICS_KEY_V1);
      localStorage.removeItem(GRAPHICS_KEY_V2);
    } catch (e) {
      console.error('Failed to clear storage', e);
    }
  }
}

import { Component, ViewChild, ElementRef } from '@angular/core';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatIconModule } from '@angular/material/icon';
import { SidebarComponent } from './sidebar/sidebar.component';
import { DrawSettings, GeometryTool } from './models/draw-settings';
import { MapComponent } from './map/map.component';
import { SketchService } from './services/sketch.service';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import { StorageService } from './services/storage.service';
import { ExportService } from './services/export.service';
import { SelectionMeasurement } from './models/selection-measurements';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    MatSidenavModule,
    MatToolbarModule,
    MatIconModule,
    SidebarComponent,
    MapComponent,
  ],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent {
  title = 'arcgis-sketch-pro';

  latestSettings?: DrawSettings;
  measurements: SelectionMeasurement[] = [];

  @ViewChild(SidebarComponent) sidebar?: SidebarComponent;
  @ViewChild('importInput') importInput?: ElementRef<HTMLInputElement>;

  private view?: MapView;
  private drawLayer?: GraphicsLayer;
  private labelLayer?: GraphicsLayer;
  private textLayer?: GraphicsLayer;

  constructor(
    private sketch: SketchService,
    private storage: StorageService,
    private exporter: ExportService
  ) {
    // Subscribe to selection measurements to show table independent of label toggles
    this.sketch.measurements$.subscribe((rows) => {
      this.measurements = rows ?? [];
    });
  }

  onMapReady(evt: {
    view: MapView;
    drawLayer: GraphicsLayer;
    labelLayer: GraphicsLayer;
    textLayer: GraphicsLayer;
  }): void {
    this.view = evt.view;
    this.drawLayer = evt.drawLayer;
    this.labelLayer = evt.labelLayer;
    this.textLayer = evt.textLayer;

    this.sketch.initialize(
      evt.view,
      evt.drawLayer,
      evt.labelLayer,
      evt.textLayer
    );

    // Restore persisted settings and graphics
    const savedSettings = this.storage.loadSettings();
    if (savedSettings && this.sidebar) {
      this.sidebar.setValue(savedSettings);
      this.latestSettings = savedSettings;
      this.sketch.updateSettings(savedSettings);
    }

    const saved = this.storage.loadGraphics();
    if (saved) {
      const { draw, labels, text } = saved as any;
      draw.forEach((g: Graphic) => evt.drawLayer.add(g));
      labels.forEach((g: Graphic) => evt.labelLayer.add(g));
      (text ?? []).forEach((g: Graphic) => evt.textLayer.add(g));
    }

    // Autosave whenever graphics change
    evt.drawLayer.graphics.on('change', () => this.saveAll());
    evt.labelLayer.graphics.on('change', () => this.saveAll());
    evt.textLayer.graphics.on('change', () => this.saveAll());
  }

  private saveAll(): void {
    if (!this.drawLayer || !this.labelLayer || !this.textLayer) return;
    const draw: Graphic[] = [
      ...(this.drawLayer.graphics as unknown as Graphic[]),
    ];
    const labels: Graphic[] = [
      ...(this.labelLayer.graphics as unknown as Graphic[]),
    ];
    const text: Graphic[] = [
      ...(this.textLayer.graphics as unknown as Graphic[]),
    ];
    this.storage.saveGraphics(draw, labels, text);
    if (this.latestSettings) {
      this.storage.saveSettings(this.latestSettings);
    }
  }

  onSettingsChange(s: DrawSettings): void {
    this.latestSettings = s;
    this.sketch.updateSettings(s);
    this.storage.saveSettings(s);
  }

  onStartDraw(tool: GeometryTool): void {
    if (!this.latestSettings) return;
    this.sketch.startDraw(this.latestSettings);
  }

  onClear(): void {
    this.sketch.clearAll();
    // Persist clear
    this.saveAll();
  }

  onExport(): void {
    if (!this.drawLayer || !this.labelLayer || !this.textLayer) return;
    const json = this.exporter.exportEsriJson(
      [...this.drawLayer.graphics],
      [...this.labelLayer.graphics],
      [...this.textLayer.graphics]
    );
    this.triggerDownload('sketch-export.json', JSON.stringify(json, null, 2));
  }

  onImport(): void {
    this.importInput?.nativeElement.click();
  }

  onFileSelected(evt: Event): void {
    const input = evt.target as HTMLInputElement;
    if (!input.files || input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result ?? '{}'));
        const result = this.exporter.importEsriJson(data);
        if (this.drawLayer && this.labelLayer && this.textLayer && result) {
          this.sketch.clearAll();
          result.draw.forEach((g: Graphic) => this.drawLayer!.add(g));
          result.labels.forEach((g: Graphic) => this.labelLayer!.add(g));
          (result.text ?? []).forEach((g: Graphic) => this.textLayer!.add(g));
          this.saveAll();
        }
      } catch (e) {
        console.error('Import failed', e);
      } finally {
        input.value = '';
      }
    };
    reader.readAsText(file);
  }

  onSelectByRect(): void {
    // Start selection mode in SketchService using a rectangle geometry.
    this.sketch.startSelection('rectangle');
  }

  onShowSketchChange(show: boolean): void {
    if (this.drawLayer) this.drawLayer.visible = show;
    if (this.labelLayer) this.labelLayer.visible = show;
  }

  onShowTextChange(show: boolean): void {
    if (this.textLayer) this.textLayer.visible = show;
  }

  private triggerDownload(filename: string, content: string): void {
    const blob = new Blob([content], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }
}

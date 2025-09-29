import {
  Component,
  OnInit,
  OnDestroy,
  ElementRef,
  ViewChild,
  NgZone,
  EventEmitter,
  Output,
} from '@angular/core';
import { CommonModule } from '@angular/common';

// ArcGIS JS API (ESM)
import EsriMap from '@arcgis/core/Map';
import MapView from '@arcgis/core/views/MapView';
import GraphicsLayer from '@arcgis/core/layers/GraphicsLayer';
import Graphic from '@arcgis/core/Graphic';
import SketchViewModel from '@arcgis/core/widgets/Sketch/SketchViewModel';
import { SketchService } from '../services/sketch.service';

export interface MapReadyEvent {
  view: MapView;
  drawLayer: GraphicsLayer;
  labelLayer: GraphicsLayer;
  textLayer: GraphicsLayer;
}

@Component({
  selector: 'app-map',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './map.component.html',
  styleUrls: ['./map.component.css'],
})
export class MapComponent implements OnInit, OnDestroy {
  @ViewChild('mapViewNode', { static: true })
  private mapViewEl!: ElementRef<HTMLDivElement>;

  @Output() ready = new EventEmitter<MapReadyEvent>();

  // Esri resources
  private map!: EsriMap;
  private view!: MapView;

  // Public layers to be used by services (sketch, labels, free text)
  drawLayer!: GraphicsLayer;
  labelLayer!: GraphicsLayer;
  textLayer!: GraphicsLayer;

  constructor(private zone: NgZone, private sketchService: SketchService) {}

  ngOnInit(): void {
    // Create layers
    this.drawLayer = new GraphicsLayer({ id: 'draw-layer' });
    this.labelLayer = new GraphicsLayer({ id: 'label-layer' });
    this.textLayer = new GraphicsLayer({ id: 'text-layer' });

    // Initialize map/view outside Angular zone for performance
    this.zone.runOutsideAngular(() => {
      this.map = new EsriMap({
        basemap: 'topo-vector', // arcgis-topographic
        // Order ensures text is on top of labels which are on top of drawings
        layers: [this.drawLayer, this.labelLayer, this.textLayer],
      });

      this.view = new MapView({
        container: this.mapViewEl.nativeElement,
        map: this.map,
        spatialReference: { wkid: 3857 }, // Web Mercator
        center: [13.404954, 52.520008], // Berlin approx (lon, lat)
        zoom: 12,
        constraints: {
          snapToZoom: false,
        },
        ui: {
          components: ['zoom', 'attribution'],
        },
      });

      this.view.when(() => {
        this.zone.run(() =>
          this.ready.emit({
            view: this.view,
            drawLayer: this.drawLayer,
            labelLayer: this.labelLayer,
            textLayer: this.textLayer,
          })
        );
      });
    });
  }

  ngOnDestroy(): void {
    // Properly destroy the MapView to avoid memory leaks
    if (this.view) {
      this.view.container = null as unknown as HTMLDivElement;
      this.view.destroy?.();
    }
  }


  // Expose view for consumers (e.g., services)
  get mapView(): MapView {
    return this.view;
  }
}

import { Component, OnInit, OnDestroy, Input, Output, EventEmitter, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SketchService } from '../services/sketch.service';
import { SelectionMeasurement } from '../models/selection-measurements';
import Graphic from '@arcgis/core/Graphic';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-sketch-table',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './sketch-table.component.html',
  styleUrls: ['./sketch-table.component.css'],
})
export class SketchTableComponent implements OnInit, OnDestroy {
  @Input() selectedGraphicIds: string[] = [];
  @Output() graphicSelected = new EventEmitter<string>();

  graphics: Graphic[] = [];
  measurements: { [id: string]: SelectionMeasurement } = {};
  private subscriptions: Subscription[] = [];

  constructor(private sketchService: SketchService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.subscriptions.push(
      this.sketchService.allGraphics$.subscribe((graphics) => {
        this.graphics = graphics;
      })
    );

    this.subscriptions.push(
      this.sketchService.measurements$.subscribe((measurements) => {
        this.measurements = measurements.reduce((acc: { [id: string]: SelectionMeasurement }, curr) => {
          acc[curr.id] = curr;
          return acc;
        }, {});
      })
    );

    this.subscriptions.push(
      this.sketchService.selectedGraphicIds$.subscribe((ids) => {
        console.log('SketchTableComponent: received selectedGraphicIds', ids);
        this.selectedGraphicIds = ids;
        this.cdr.detectChanges(); // Force change detection
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  getGraphicTitle(graphic: Graphic): string {
    if (graphic.attributes?.title) {
      return graphic.attributes.title;
    }
    if (graphic.attributes?.tool === 'text') {
      return graphic.symbol?.type === 'text' ? (graphic.symbol as any).text : 'Text';
    }
    return graphic.geometry?.type || 'Unknown';
  }

  getGraphicGeometryType(graphic: Graphic): string {
    return graphic.geometry?.type || 'Unknown';
  }

  getGraphicMeasurements(graphic: Graphic): SelectionMeasurement | undefined {
    return this.measurements[this.sketchService.getGraphicId(graphic)];
  }

  onRowClick(event: MouseEvent, graphic: Graphic): void {
    const graphicId = this.sketchService.getGraphicId(graphic);
    let newSelection: string[] = [];

    if (event.ctrlKey || event.metaKey) {
      // Toggle selection for multi-select
      if (this.selectedGraphicIds.includes(graphicId)) {
        newSelection = this.selectedGraphicIds.filter(id => id !== graphicId);
      } else {
        newSelection = [...this.selectedGraphicIds, graphicId];
      }
    } else {
      // Single select
      newSelection = [graphicId];
    }

    this.sketchService.selectGraphics(newSelection);
  }

  isSelected(graphic: Graphic): boolean {
    return this.selectedGraphicIds.includes(this.sketchService.getGraphicId(graphic));
  }
}
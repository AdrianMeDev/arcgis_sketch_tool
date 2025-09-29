import { Component, EventEmitter, Output, Input, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormBuilder, FormGroup } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatInputModule } from '@angular/material/input';
import { MatSliderModule } from '@angular/material/slider';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatButtonModule } from '@angular/material/button';
import { DrawSettings, GeometryTool } from '../models/draw-settings';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { SketchTableComponent } from '../sketch-table/sketch-table.component';
import { SketchService } from '../services/sketch.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatSelectModule,
    MatInputModule,
    MatSliderModule,
    MatButtonToggleModule,
    MatButtonModule,
    MatSlideToggleModule,
    SketchTableComponent,
  ],
  templateUrl: './sidebar.component.html',
  styleUrls: ['./sidebar.component.css'],
})
export class SidebarComponent implements OnInit, OnDestroy {
  @Output() settingsChange = new EventEmitter<DrawSettings>();
  @Output() startDraw = new EventEmitter<GeometryTool>();
  @Output() clearAll = new EventEmitter<void>();
  @Output() exportJson = new EventEmitter<void>();
  @Output() importJson = new EventEmitter<void>();
  @Output() showSketchChange = new EventEmitter<boolean>();
  @Output() showTextChange = new EventEmitter<boolean>();
  @Output() selectByRect = new EventEmitter<void>();

  @Input()
  measurements: import('../models/selection-measurements').SelectionMeasurement[] =
    [];

  selectedGraphicIds: string[] = [];
  private subscriptions: Subscription[] = [];

  form: FormGroup;

  tools: { value: GeometryTool; label: string }[] = [
    { value: 'point', label: 'Point' },
    { value: 'polyline', label: 'Polyline' },
    { value: 'polygon', label: 'Polygon' },
    { value: 'rectangle', label: 'Rectangle' },
    { value: 'circle', label: 'Circle' },
    { value: 'text', label: 'Text' },
  ];

  constructor(private fb: FormBuilder, private sketchService: SketchService) {
    this.form = this.fb.group({
      tool: 'polygon',
      fillColor: '#0078ff',
      fillOpacity: 0.2,
      outlineColor: '#0078ff',
      outlineWidth: 2,
      text: this.fb.group({
        content: 'Label',
        fontFamily: 'Noto Sans',
        fontSize: 12,
        color: '#1a1a1a',
        haloColor: '#ffffff',
        haloSize: 2,
      }),
      labels: this.fb.group({
        showDuringDraw: true,
        showSegmentLengths: true,
        showTotals: true,
        showCircleRadius: true,
        showTitle: true,
      }),
    });

    this.form.valueChanges.subscribe(() => {
      this.settingsChange.emit(this.value());
    });
  }

  ngOnInit(): void {
    this.subscriptions.push(
      this.sketchService.selectedGraphicIds$.subscribe((ids) => {
        this.selectedGraphicIds = ids;
      })
    );
  }

  ngOnDestroy(): void {
    this.subscriptions.forEach((sub) => sub.unsubscribe());
  }

  value(): DrawSettings {
    const v = this.form.value as any;
    return {
      tool: v.tool,
      fillColor: v.fillColor,
      fillOpacity: v.fillOpacity,
      outlineColor: v.outlineColor,
      outlineWidth: v.outlineWidth,
      text: {
        content: v.text.content,
        fontFamily: v.text.fontFamily,
        fontSize: v.text.fontSize,
        color: v.text.color,
        haloColor: v.text.haloColor,
        haloSize: v.text.haloSize,
      },
      labels: {
        showDuringDraw: v.labels.showDuringDraw,
        showSegmentLengths: v.labels.showSegmentLengths,
        showTotals: v.labels.showTotals,
        showCircleRadius: v.labels.showCircleRadius,
        showTitle: v.labels.showTitle,
      },
    };
  }

  // Allow parent to programmatically set/restore full settings
  setValue(v: DrawSettings): void {
    if (!v) {
      return;
    }
    this.form.patchValue(
      {
        tool: v.tool,
        fillColor: v.fillColor,
        fillOpacity: v.fillOpacity,
        outlineColor: v.outlineColor,
        outlineWidth: v.outlineWidth,
        text: {
          content: v.text.content,
          fontFamily: v.text.fontFamily,
          fontSize: v.text.fontSize,
          color: v.text.color,
          haloColor: v.text.haloColor,
          haloSize: v.text.haloSize,
        },
        labels: {
          showDuringDraw: v.labels.showDuringDraw,
          showSegmentLengths: v.labels.showSegmentLengths,
          showTotals: v.labels.showTotals,
          showCircleRadius: v.labels.showCircleRadius,
          showTitle: v.labels.showTitle,
        },
      },
      { emitEvent: true }
    );
  }

  onStartDraw(): void {
    this.startDraw.emit(this.form.get('tool')?.value);
  }

  onClear(): void {
    this.clearAll.emit();
    this.sketchService.clearSelection(); // Clear selection when clearing all graphics
  }

  onExport(): void {
    this.exportJson.emit();
  }

  onImport(): void {
    this.importJson.emit();
  }

  onSelectByRect(): void {
    this.selectByRect.emit();
  }

  onGraphicSelected(graphicId: string): void {
    // For now, single selection from table. Can be extended for multi-selection later.
    this.sketchService.selectGraphics([graphicId]);
  }
}

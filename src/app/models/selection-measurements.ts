export interface MeasurementRow {
  label: string;
  value: string;
}

export interface SelectionMeasurement {
  id: string;
  geometryType: 'point' | 'polyline' | 'polygon';
  tool?: 'point' | 'polyline' | 'polygon' | 'rectangle' | 'circle' | 'text';
  title?: string;
  rows: MeasurementRow[];
}

export type GeometryTool =
  | 'point'
  | 'polyline'
  | 'polygon'
  | 'rectangle'
  | 'circle'
  | 'text';

export interface DrawSettings {
  tool: GeometryTool;
  fillColor: string; // hex (e.g., #0078ff)
  fillOpacity: number; // 0..1
  outlineColor: string; // hex
  outlineWidth: number; // px
  text: {
    content: string;
    fontFamily: string;
    fontSize: number; // px
    color: string; // hex
    haloColor: string; // hex
    haloSize: number; // px
  };
  labels: {
    showDuringDraw: boolean;
    showSegmentLengths: boolean;
    showTotals: boolean;
    showCircleRadius: boolean;
    showTitle: boolean;
  };
}

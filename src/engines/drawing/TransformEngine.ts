// src/engines/drawing/TransformEngine.ts - PROCREATE-LEVEL TRANSFORM TOOLS
import { 
    Point, 
    Transform, 
    Bounds, 
    Layer,
    Selection,
  } from '../../types/drawing';
  import { EventBus } from '../core/EventBus';
  import { valkyrieEngine } from './ValkyrieEngine';
  import { layerManager } from './LayerManager';
  import { SkMatrix, SkPath, SkSurface } from '@shopify/react-native-skia';
  import { CompatSkia } from './SkiaCompatibility';
  
  /**
   * Professional Transform Engine
   * Implements Procreate-level transform capabilities
   */
  export class TransformEngine {
    private static instance: TransformEngine;
    private eventBus = EventBus.getInstance();
    
    // Transform state
    private activeTransform: ActiveTransform | null = null;
    private transformMatrix: SkMatrix | null = null;
    private originalContent: TransformContent | null = null;
    
    // Transform modes
    private mode: TransformMode = 'free';
    private interpolation: InterpolationMode = 'bilinear';
    private maintainAspectRatio = true;
    private snapEnabled = true;
    private snapThreshold = 5; // pixels
    
    // Handles
    private handles: TransformHandle[] = [];
    private activeHandle: TransformHandle | null = null;
    
    // Grid
    private showGrid = true;
    private gridDivisions = 3; // 3x3 grid
    
    // History
    private transformHistory: TransformHistoryEntry[] = [];
    private historyIndex = -1;
    
    // Performance
    private previewQuality = 0.5; // Preview at half resolution
    private finalQuality = 1.0;
    private isPreview = false;
  
    private constructor() {
      this.setupHandles();
    }
  
    public static getInstance(): TransformEngine {
      if (!TransformEngine.instance) {
        TransformEngine.instance = new TransformEngine();
      }
      return TransformEngine.instance;
    }
  
    // ===== PUBLIC API =====
  
    public startTransform(
      target: TransformTarget,
      bounds?: Bounds
    ): boolean {
      if (this.activeTransform) {
        this.cancelTransform();
      }
      
      console.log('🔄 Starting transform:', target.type);
      
      // Capture original content
      this.originalContent = this.captureContent(target, bounds);
      if (!this.originalContent) return false;
      
      // Initialize transform
      this.activeTransform = {
        target,
        bounds: bounds || this.calculateBounds(target),
        transform: {
          x: 0,
          y: 0,
          scale: 1,
          rotation: 0,
          skewX: 0,
          skewY: 0,
          anchorX: 0.5,
          anchorY: 0.5,
          flipX: false,
          flipY: false,
        },
        startTime: Date.now(),
      };
      
      // Initialize matrix
      this.updateTransformMatrix();
      
      // Update handles
      this.updateHandles();
      
      this.eventBus.emit('transform:started', { target });
      return true;
    }
  
    public updateTransform(transform: Partial<ExtendedTransform>): void {
      if (!this.activeTransform) return;
      
      // Update transform values
      Object.assign(this.activeTransform.transform, transform);
      
      // Maintain aspect ratio if enabled
      if (this.maintainAspectRatio && transform.scale !== undefined) {
        this.activeTransform.transform.scaleX = transform.scale;
        this.activeTransform.transform.scaleY = transform.scale;
      }
      
      // Apply snapping
      if (this.snapEnabled) {
        this.applySnapping();
      }
      
      // Update matrix
      this.updateTransformMatrix();
      
      // Update preview
      this.updatePreview();
      
      // Update handles
      this.updateHandles();
      
      this.eventBus.emit('transform:updated', { 
        transform: this.activeTransform.transform 
      });
    }
  
    public commitTransform(): void {
      if (!this.activeTransform || !this.originalContent) return;
      
      console.log('✅ Committing transform');
      
      // Apply final quality transform
      this.isPreview = false;
      const finalSurface = this.applyTransform(
        this.originalContent,
        this.activeTransform.transform,
        this.finalQuality
      );
      
      if (!finalSurface) {
        this.cancelTransform();
        return;
      }
      
      // Apply to target
      this.applyToTarget(finalSurface);
      
      // Record history
      this.recordHistory({
        target: this.activeTransform.target,
        transform: { ...this.activeTransform.transform },
        timestamp: Date.now(),
      });
      
      // Cleanup
      this.cleanup();
      
      this.eventBus.emit('transform:committed', { 
        target: this.activeTransform.target 
      });
    }
  
    public cancelTransform(): void {
      if (!this.activeTransform) return;
      
      console.log('❌ Cancelling transform');
      
      // Restore original
      if (this.originalContent) {
        this.restoreOriginal();
      }
      
      // Cleanup
      this.cleanup();
      
      this.eventBus.emit('transform:cancelled');
    }
  
    public setMode(mode: TransformMode): void {
      this.mode = mode;
      
      if (this.activeTransform) {
        // Reset certain values based on mode
        switch (mode) {
          case 'uniform':
            this.maintainAspectRatio = true;
            break;
          case 'distort':
            this.maintainAspectRatio = false;
            break;
          case 'perspective':
            // Enable perspective handles
            this.setupPerspectiveHandles();
            break;
          case 'warp':
            // Enable warp grid
            this.setupWarpGrid();
            break;
        }
        
        this.updateHandles();
      }
      
      this.eventBus.emit('transform:modeChanged', { mode });
    }
  
    public setInterpolation(mode: InterpolationMode): void {
      this.interpolation = mode;
      
      if (this.activeTransform) {
        this.updatePreview();
      }
    }
  
    public toggleAspectRatio(): void {
      this.maintainAspectRatio = !this.maintainAspectRatio;
      
      if (this.activeTransform && this.maintainAspectRatio) {
        // Equalize scale values
        const avgScale = (
          this.activeTransform.transform.scaleX + 
          this.activeTransform.transform.scaleY
        ) / 2;
        
        this.updateTransform({
          scaleX: avgScale,
          scaleY: avgScale,
        });
      }
    }
  
    public toggleSnapping(): void {
      this.snapEnabled = !this.snapEnabled;
      
      if (this.snapEnabled && this.activeTransform) {
        this.applySnapping();
        this.updatePreview();
      }
    }
  
    public flip(axis: 'horizontal' | 'vertical'): void {
      if (!this.activeTransform) return;
      
      if (axis === 'horizontal') {
        this.updateTransform({
          flipX: !this.activeTransform.transform.flipX,
        });
      } else {
        this.updateTransform({
          flipY: !this.activeTransform.transform.flipY,
        });
      }
    }
  
    public rotate(degrees: number): void {
      if (!this.activeTransform) return;
      
      const radians = degrees * Math.PI / 180;
      this.updateTransform({
        rotation: this.activeTransform.transform.rotation + radians,
      });
    }
  
    public reset(): void {
      if (!this.activeTransform) return;
      
      this.updateTransform({
        x: 0,
        y: 0,
        scale: 1,
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        skewX: 0,
        skewY: 0,
        flipX: false,
        flipY: false,
      });
    }
  
    // Handle interaction
    public handleTouchStart(point: Point): TransformHandle | null {
      if (!this.activeTransform) return null;
      
      // Check if touching a handle
      for (const handle of this.handles) {
        if (this.isPointInHandle(point, handle)) {
          this.activeHandle = handle;
          this.eventBus.emit('transform:handleSelected', { handle });
          return handle;
        }
      }
      
      // Check if touching inside bounds (for moving)
      if (this.isPointInBounds(point, this.activeTransform.bounds)) {
        this.activeHandle = {
          type: 'move',
          position: point,
          cursor: 'move',
        };
        return this.activeHandle;
      }
      
      return null;
    }
  
    public handleTouchMove(point: Point, startPoint: Point): void {
      if (!this.activeTransform || !this.activeHandle) return;
      
      const delta = {
        x: point.x - startPoint.x,
        y: point.y - startPoint.y,
      };
      
      switch (this.activeHandle.type) {
        case 'move':
          this.handleMove(delta);
          break;
          
        case 'scale':
          this.handleScale(point, this.activeHandle);
          break;
          
        case 'rotate':
          this.handleRotate(point, this.activeHandle);
          break;
          
        case 'corner':
          this.handleCorner(point, this.activeHandle);
          break;
          
        case 'perspective':
          this.handlePerspective(point, this.activeHandle);
          break;
          
        case 'warp':
          this.handleWarp(point, this.activeHandle);
          break;
      }
    }
  
    public handleTouchEnd(): void {
      this.activeHandle = null;
    }
  
    // Undo/Redo
    public undo(): boolean {
      if (this.historyIndex < 0) return false;
      
      const entry = this.transformHistory[this.historyIndex];
      this.applyHistoryEntry(entry, true);
      this.historyIndex--;
      
      return true;
    }
  
    public redo(): boolean {
      if (this.historyIndex >= this.transformHistory.length - 1) return false;
      
      this.historyIndex++;
      const entry = this.transformHistory[this.historyIndex];
      this.applyHistoryEntry(entry, false);
      
      return true;
    }
  
    // ===== PRIVATE METHODS =====
  
    private captureContent(
      target: TransformTarget,
      bounds?: Bounds
    ): TransformContent | null {
      switch (target.type) {
        case 'layer':
          return this.captureLayer(target.layerId!);
          
        case 'selection':
          return this.captureSelection(target.selection!, bounds);
          
        case 'all':
          return this.captureAllLayers();
      }
    }
  
    private captureLayer(layerId: string): TransformContent | null {
      const surface = valkyrieEngine.getLayerSurface(layerId);
      if (!surface) return null;
      
      const image = surface.makeImageSnapshot();
      const bounds = {
        x: 0,
        y: 0,
        width: surface.width(),
        height: surface.height(),
      };
      
      return { image, surface, bounds };
    }
  
    private captureSelection(
      selection: Selection,
      bounds?: Bounds
    ): TransformContent | null {
      // Create surface for selection
      const selectionBounds = bounds || selection.bounds;
      const surface = CompatSkia.Surface.Make(
        selectionBounds.width,
        selectionBounds.height
      );
      
      if (!surface) return null;
      
      // Copy selection content
      // This would use the selection path to mask the content
      
      const image = surface.makeImageSnapshot();
      return { image, surface, bounds: selectionBounds };
    }
  
    private captureAllLayers(): TransformContent | null {
      // Composite all layers
      const compositeSurface = valkyrieEngine.getMainSurface();
      if (!compositeSurface) return null;
      
      const image = compositeSurface.makeImageSnapshot();
      const bounds = {
        x: 0,
        y: 0,
        width: compositeSurface.width(),
        height: compositeSurface.height(),
      };
      
      return { image, surface: compositeSurface, bounds };
    }
  
    private calculateBounds(target: TransformTarget): Bounds {
      // Calculate bounding box for target
      switch (target.type) {
        case 'layer':
          const layer = layerManager.getLayer(target.layerId!);
          if (layer) {
            // Calculate from layer content
            return { x: 0, y: 0, width: 100, height: 100 }; // TODO
          }
          break;
          
        case 'selection':
          return target.selection!.bounds;
          
        case 'all':
          return {
            x: 0,
            y: 0,
            width: valkyrieEngine.getMainSurface()?.width() || 100,
            height: valkyrieEngine.getMainSurface()?.height() || 100,
          };
      }
      
      return { x: 0, y: 0, width: 100, height: 100 };
    }
  
    private updateTransformMatrix(): void {
      if (!this.activeTransform) return;
      
      const t = this.activeTransform.transform;
      const bounds = this.activeTransform.bounds;
      
      // Create transformation matrix
      const matrix = CompatSkia.Matrix();
      
      // Apply anchor point
      const anchorX = bounds.x + bounds.width * t.anchorX;
      const anchorY = bounds.y + bounds.height * t.anchorY;
      
      // Translate to anchor
      matrix.translate(anchorX, anchorY);
      
      // Apply transformations
      matrix.rotate(t.rotation * 180 / Math.PI);
      matrix.scale(
        t.scaleX * (t.flipX ? -1 : 1),
        t.scaleY * (t.flipY ? -1 : 1)
      );
      matrix.skew(t.skewX, t.skewY);
      
      // Translate back from anchor
      matrix.translate(-anchorX, -anchorY);
      
      // Apply position offset
      matrix.translate(t.x, t.y);
      
      this.transformMatrix = matrix;
    }
  
    private applyTransform(
      content: TransformContent,
      transform: ExtendedTransform,
      quality: number
    ): SkSurface | null {
      if (!this.transformMatrix) return null;
      
      // Calculate output size
      const outputWidth = Math.ceil(content.bounds.width * quality);
      const outputHeight = Math.ceil(content.bounds.height * quality);
      
      // Create output surface
      const surface = CompatSkia.Surface.Make(outputWidth, outputHeight);
      if (!surface) return null;
      
      const canvas = surface.getCanvas();
      
      // Apply quality scaling
      if (quality !== 1) {
        canvas.scale(quality, quality);
      }
      
      // Clear background
      canvas.clear(CompatSkia.Color('transparent'));
      
      // Apply transform matrix
      canvas.concat(this.transformMatrix);
      
      // Draw content with interpolation
      const paint = CompatSkia.Paint();
      paint.setAntiAlias(this.interpolation !== 'nearest');
      
      if (this.interpolation === 'nearest') {
        paint.setFilterQuality('low');
      } else if (this.interpolation === 'bilinear') {
        paint.setFilterQuality('medium');
      } else {
        paint.setFilterQuality('high');
      }
      
      canvas.drawImage(content.image, 0, 0, paint);
      
      return surface;
    }
  
    private updatePreview(): void {
      if (!this.activeTransform || !this.originalContent) return;
      
      this.isPreview = true;
      const previewSurface = this.applyTransform(
        this.originalContent,
        this.activeTransform.transform,
        this.previewQuality
      );
      
      if (previewSurface) {
        // Send preview to rendering
        this.eventBus.emit('transform:preview', {
          surface: previewSurface,
          bounds: this.activeTransform.bounds,
        });
      }
    }
  
    private applySnapping(): void {
      if (!this.activeTransform) return;
      
      const t = this.activeTransform.transform;
      
      // Snap rotation to 45-degree increments
      const rotationDeg = t.rotation * 180 / Math.PI;
      const snappedRotation = Math.round(rotationDeg / 45) * 45;
      if (Math.abs(rotationDeg - snappedRotation) < this.snapThreshold) {
        t.rotation = snappedRotation * Math.PI / 180;
      }
      
      // Snap scale to common values
      const scaleSnaps = [0.25, 0.5, 1, 1.5, 2, 3, 4];
      for (const snap of scaleSnaps) {
        if (Math.abs(t.scaleX - snap) < 0.05) t.scaleX = snap;
        if (Math.abs(t.scaleY - snap) < 0.05) t.scaleY = snap;
      }
      
      // Snap position to grid
      const gridSize = 10;
      t.x = Math.round(t.x / gridSize) * gridSize;
      t.y = Math.round(t.y / gridSize) * gridSize;
    }
  
    private setupHandles(): void {
      // Standard transform handles
      this.handles = [
        // Corners
        { type: 'corner', position: 'top-left', cursor: 'nwse-resize' },
        { type: 'corner', position: 'top-right', cursor: 'nesw-resize' },
        { type: 'corner', position: 'bottom-left', cursor: 'nesw-resize' },
        { type: 'corner', position: 'bottom-right', cursor: 'nwse-resize' },
        
        // Edges
        { type: 'scale', position: 'top', cursor: 'ns-resize' },
        { type: 'scale', position: 'right', cursor: 'ew-resize' },
        { type: 'scale', position: 'bottom', cursor: 'ns-resize' },
        { type: 'scale', position: 'left', cursor: 'ew-resize' },
        
        // Rotation handle
        { type: 'rotate', position: 'rotation', cursor: 'rotate' },
      ];
    }
  
    private setupPerspectiveHandles(): void {
      // Add perspective corner handles
      this.handles = [
        { type: 'perspective', position: 'top-left', cursor: 'crosshair' },
        { type: 'perspective', position: 'top-right', cursor: 'crosshair' },
        { type: 'perspective', position: 'bottom-left', cursor: 'crosshair' },
        { type: 'perspective', position: 'bottom-right', cursor: 'crosshair' },
      ];
    }
  
    private setupWarpGrid(): void {
      // Create warp grid handles
      const divisions = 4;
      this.handles = [];
      
      for (let i = 0; i <= divisions; i++) {
        for (let j = 0; j <= divisions; j++) {
          this.handles.push({
            type: 'warp',
            position: { x: i / divisions, y: j / divisions },
            cursor: 'move',
          });
        }
      }
    }
  
    private updateHandles(): void {
      if (!this.activeTransform) return;
      
      const bounds = this.getTransformedBounds();
      
      // Update handle positions based on transformed bounds
      for (const handle of this.handles) {
        switch (handle.type) {
          case 'corner':
          case 'scale':
            this.updateStandardHandle(handle, bounds);
            break;
            
          case 'rotate':
            this.updateRotationHandle(handle, bounds);
            break;
            
          case 'perspective':
            this.updatePerspectiveHandle(handle, bounds);
            break;
            
          case 'warp':
            this.updateWarpHandle(handle, bounds);
            break;
        }
      }
    }
  
    private getTransformedBounds(): Bounds {
      if (!this.activeTransform || !this.transformMatrix) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      
      const bounds = this.activeTransform.bounds;
      const corners = [
        { x: bounds.x, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y },
        { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
        { x: bounds.x, y: bounds.y + bounds.height },
      ];
      
      // Transform corners
      const transformed = corners.map(corner => {
        const point = this.transformMatrix!.mapPoint(corner.x, corner.y);
        return { x: point[0], y: point[1] };
      });
      
      // Calculate bounding box
      const xs = transformed.map(p => p.x);
      const ys = transformed.map(p => p.y);
      
      return {
        x: Math.min(...xs),
        y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
      };
    }
  
    private updateStandardHandle(handle: TransformHandle, bounds: Bounds): void {
      // Update corner/edge handle positions
      switch (handle.position) {
        case 'top-left':
          handle.x = bounds.x;
          handle.y = bounds.y;
          break;
        case 'top-right':
          handle.x = bounds.x + bounds.width;
          handle.y = bounds.y;
          break;
        case 'bottom-left':
          handle.x = bounds.x;
          handle.y = bounds.y + bounds.height;
          break;
        case 'bottom-right':
          handle.x = bounds.x + bounds.width;
          handle.y = bounds.y + bounds.height;
          break;
        case 'top':
          handle.x = bounds.x + bounds.width / 2;
          handle.y = bounds.y;
          break;
        case 'right':
          handle.x = bounds.x + bounds.width;
          handle.y = bounds.y + bounds.height / 2;
          break;
        case 'bottom':
          handle.x = bounds.x + bounds.width / 2;
          handle.y = bounds.y + bounds.height;
          break;
        case 'left':
          handle.x = bounds.x;
          handle.y = bounds.y + bounds.height / 2;
          break;
      }
    }
  
    private updateRotationHandle(handle: TransformHandle, bounds: Bounds): void {
      // Position rotation handle above top edge
      handle.x = bounds.x + bounds.width / 2;
      handle.y = bounds.y - 40;
    }
  
    private updatePerspectiveHandle(handle: TransformHandle, bounds: Bounds): void {
      // Update perspective corner positions
      // These would be based on the perspective transform
    }
  
    private updateWarpHandle(handle: TransformHandle, bounds: Bounds): void {
      // Update warp grid positions
      if (typeof handle.position === 'object') {
        handle.x = bounds.x + bounds.width * handle.position.x;
        handle.y = bounds.y + bounds.height * handle.position.y;
      }
    }
  
    private isPointInHandle(point: Point, handle: TransformHandle): boolean {
      if (!handle.x || !handle.y) return false;
      
      const handleSize = 20;
      return (
        point.x >= handle.x - handleSize / 2 &&
        point.x <= handle.x + handleSize / 2 &&
        point.y >= handle.y - handleSize / 2 &&
        point.y <= handle.y + handleSize / 2
      );
    }
  
    private isPointInBounds(point: Point, bounds: Bounds): boolean {
      return (
        point.x >= bounds.x &&
        point.x <= bounds.x + bounds.width &&
        point.y >= bounds.y &&
        point.y <= bounds.y + bounds.height
      );
    }
  
    private handleMove(delta: { x: number; y: number }): void {
      if (!this.activeTransform) return;
      
      this.updateTransform({
        x: this.activeTransform.transform.x + delta.x,
        y: this.activeTransform.transform.y + delta.y,
      });
    }
  
    private handleScale(point: Point, handle: TransformHandle): void {
      if (!this.activeTransform) return;
      
      // Calculate scale based on handle position
      // This is simplified - full implementation would consider
      // the specific edge/corner being dragged
      const bounds = this.activeTransform.bounds;
      const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      
      const originalDist = Math.sqrt(
        Math.pow(handle.x! - center.x, 2) +
        Math.pow(handle.y! - center.y, 2)
      );
      
      const currentDist = Math.sqrt(
        Math.pow(point.x - center.x, 2) +
        Math.pow(point.y - center.y, 2)
      );
      
      const scale = currentDist / originalDist;
      
      this.updateTransform({ scale });
    }
  
    private handleRotate(point: Point, handle: TransformHandle): void {
      if (!this.activeTransform) return;
      
      const bounds = this.getTransformedBounds();
      const center = {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
      };
      
      const angle = Math.atan2(
        point.y - center.y,
        point.x - center.x
      );
      
      this.updateTransform({ rotation: angle });
    }
  
    private handleCorner(point: Point, handle: TransformHandle): void {
      // Handle free transform from corner
      // This would update scale and potentially rotation
    }
  
    private handlePerspective(point: Point, handle: TransformHandle): void {
      // Handle perspective transform
      // This would update a perspective matrix
    }
  
    private handleWarp(point: Point, handle: TransformHandle): void {
      // Handle warp mesh deformation
      // This would update a mesh of control points
    }
  
    private applyToTarget(surface: SkSurface): void {
      if (!this.activeTransform) return;
      
      switch (this.activeTransform.target.type) {
        case 'layer':
          // Replace layer content
          const layerId = this.activeTransform.target.layerId!;
          const layerSurface = valkyrieEngine.getLayerSurface(layerId);
          if (layerSurface) {
            const canvas = layerSurface.getCanvas();
            canvas.clear(CompatSkia.Color('transparent'));
            canvas.drawImage(surface.makeImageSnapshot(), 0, 0);
          }
          break;
          
        case 'selection':
          // Apply to selection area
          break;
          
        case 'all':
          // Replace all content
          break;
      }
    }
  
    private restoreOriginal(): void {
      if (!this.originalContent || !this.activeTransform) return;
      
      // Restore original content to target
      this.applyToTarget(this.originalContent.surface);
    }
  
    private recordHistory(entry: TransformHistoryEntry): void {
      // Remove entries after current index
      if (this.historyIndex < this.transformHistory.length - 1) {
        this.transformHistory.splice(this.historyIndex + 1);
      }
      
      // Add new entry
      this.transformHistory.push(entry);
      this.historyIndex++;
      
      // Limit history size
      const maxHistory = 50;
      if (this.transformHistory.length > maxHistory) {
        this.transformHistory.shift();
        this.historyIndex--;
      }
    }
  
    private applyHistoryEntry(entry: TransformHistoryEntry, isUndo: boolean): void {
      // Apply or reverse transform from history
      if (isUndo) {
        // Restore to state before transform
      } else {
        // Apply transform again
      }
    }
  
    private cleanup(): void {
      this.activeTransform = null;
      this.transformMatrix = null;
      this.originalContent = null;
      this.activeHandle = null;
      this.isPreview = false;
    }
  }
  
  // ===== TYPES =====
  
  export type TransformMode = 'free' | 'uniform' | 'distort' | 'perspective' | 'warp';
  export type InterpolationMode = 'nearest' | 'bilinear' | 'bicubic';
  
  interface TransformTarget {
    type: 'layer' | 'selection' | 'all';
    layerId?: string;
    selection?: Selection;
  }
  
  interface ActiveTransform {
    target: TransformTarget;
    bounds: Bounds;
    transform: ExtendedTransform;
    startTime: number;
  }
  
  interface ExtendedTransform extends Transform {
    scaleX: number;
    scaleY: number;
    skewX: number;
    skewY: number;
    anchorX: number; // 0-1
    anchorY: number; // 0-1
  }
  
  interface TransformContent {
    image: any; // SkImage
    surface: SkSurface;
    bounds: Bounds;
  }
  
  interface TransformHandle {
    type: 'move' | 'scale' | 'rotate' | 'corner' | 'perspective' | 'warp';
    position: string | { x: number; y: number };
    cursor: string;
    x?: number;
    y?: number;
  }
  
  interface TransformHistoryEntry {
    target: TransformTarget;
    transform: ExtendedTransform;
    timestamp: number;
  }
  
  // Export singleton
  export const transformEngine = TransformEngine.getInstance();
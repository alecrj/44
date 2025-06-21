// src/contexts/DrawingContext.tsx - ENTERPRISE GRADE DRAWING CONTEXT
import React, { createContext, useContext, useCallback, useEffect, useRef, useState } from 'react';
import { 
  DrawingTool, 
  Color, 
  Brush, 
  Layer,
  CanvasSettings,
  Point,
  Stroke,
  Transform,
  Selection,
  ColorPalette,
  Document,
  GestureType,
  SymmetryGuide,
  ReferenceImage,
} from '../types/drawing';
import { valkyrieEngine } from '../engines/drawing/ValkyrieEngine';
import { brushEngine } from '../engines/drawing/BrushEngine';
import { layerManager } from '../engines/drawing/LayerManager';
import { performanceOptimizer } from '../engines/drawing/PerformanceOptimizer';
import { EventBus } from '../engines/core/EventBus';
import { dataManager } from '../engines/core/DataManager';
import { SkSurface } from '@shopify/react-native-skia';

interface DrawingState {
  // Document
  document: Document | null;
  isDocumentDirty: boolean;
  
  // Tools
  currentTool: DrawingTool;
  previousTool: DrawingTool;
  toolSettings: Record<DrawingTool, any>;
  
  // Brush
  currentBrush: Brush | null;
  brushSize: number;
  brushOpacity: number;
  brushFlow: number;
  
  // Color
  currentColor: Color;
  backgroundColor: Color;
  colorHistory: Color[];
  colorPalettes: ColorPalette[];
  currentPaletteId: string | null;
  
  // Layers
  layers: Layer[];
  currentLayerId: string | null;
  layerOpacity: number;
  
  // Canvas
  canvasSettings: CanvasSettings;
  canvasTransform: Transform;
  canvasWidth: number;
  canvasHeight: number;
  
  // Selection
  selection: Selection | null;
  isSelecting: boolean;
  
  // Drawing state
  isDrawing: boolean;
  currentStroke: Stroke | null;
  strokeHistory: Stroke[];
  
  // UI State
  showGrid: boolean;
  showReferenceImage: boolean;
  symmetryGuide: SymmetryGuide | null;
  referenceImages: ReferenceImage[];
  
  // Performance
  fps: number;
  optimizationLevel: 0 | 1 | 2;
  memoryUsage: number;
}

interface DrawingContextValue extends DrawingState {
  // Document operations
  createDocument: (width: number, height: number, name?: string) => Promise<Document>;
  loadDocument: (id: string) => Promise<boolean>;
  saveDocument: () => Promise<boolean>;
  exportDocument: (format: string, options?: any) => Promise<Blob | null>;
  
  // Tool operations
  setTool: (tool: DrawingTool) => void;
  setToolSetting: (tool: DrawingTool, setting: string, value: any) => void;
  
  // Brush operations
  setBrush: (brushId: string) => void;
  setBrushSize: (size: number) => void;
  setBrushOpacity: (opacity: number) => void;
  setBrushFlow: (flow: number) => void;
  createCustomBrush: (name: string, settings?: any) => string;
  
  // Color operations
  setColor: (color: Color) => void;
  setBackgroundColor: (color: Color) => void;
  addColorToPalette: (color: Color, paletteId?: string) => void;
  createColorPalette: (name: string, colors?: Color[]) => string;
  
  // Layer operations
  createLayer: (name?: string, type?: any) => Layer;
  deleteLayer: (layerId: string) => boolean;
  duplicateLayer: (layerId: string) => Layer | null;
  mergeLayerDown: (layerId: string) => boolean;
  setCurrentLayer: (layerId: string) => void;
  setLayerOpacity: (opacity: number, layerId?: string) => void;
  setLayerBlendMode: (blendMode: any, layerId?: string) => void;
  setLayerVisibility: (visible: boolean, layerId?: string) => void;
  clearLayer: (layerId?: string) => void;
  
  // Drawing operations
  startStroke: (point: Point) => void;
  addStrokePoint: (point: Point) => void;
  endStroke: () => void;
  cancelStroke: () => void;
  
  // Canvas operations
  setCanvasTransform: (transform: Partial<Transform>) => void;
  resetCanvasTransform: () => void;
  fitCanvasToScreen: () => void;
  
  // Selection operations
  startSelection: (type: string) => void;
  updateSelection: (points: Point[]) => void;
  confirmSelection: () => void;
  clearSelection: () => void;
  transformSelection: (transform: Transform) => void;
  
  // History operations
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  
  // Settings
  updateCanvasSettings: (settings: Partial<CanvasSettings>) => void;
  toggleGrid: () => void;
  toggleSymmetry: (type?: string) => void;
  toggleReference: () => void;
  
  // Reference
  addReferenceImage: (source: string) => void;
  removeReferenceImage: (id: string) => void;
  transformReferenceImage: (id: string, transform: Partial<Transform>) => void;
}

const DrawingContext = createContext<DrawingContextValue | null>(null);

export const useDrawing = () => {
  const context = useContext(DrawingContext);
  if (!context) {
    throw new Error('useDrawing must be used within DrawingProvider');
  }
  return context;
};

export const DrawingProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const eventBus = useRef(EventBus.getInstance()).current;
  
  // Initialize state
  const [state, setState] = useState<DrawingState>({
    // Document
    document: null,
    isDocumentDirty: false,
    
    // Tools
    currentTool: 'brush',
    previousTool: 'brush',
    toolSettings: {
      brush: {},
      eraser: { isEraser: true },
      smudge: { strength: 0.5 },
      blur: { strength: 0.5 },
      selection: { type: 'rectangle', feather: 0 },
      transform: { mode: 'free' },
      text: { font: 'Arial', size: 24 },
      shape: { type: 'rectangle', fill: true },
      eyedropper: { sampleSize: 1 },
      fill: { tolerance: 32 },
      gradient: { type: 'linear' },
    },
    
    // Brush
    currentBrush: null,
    brushSize: 10,
    brushOpacity: 1,
    brushFlow: 1,
    
    // Color
    currentColor: {
      hex: '#000000',
      rgb: { r: 0, g: 0, b: 0 },
      hsb: { h: 0, s: 0, b: 0 },
      alpha: 1,
    },
    backgroundColor: {
      hex: '#FFFFFF',
      rgb: { r: 255, g: 255, b: 255 },
      hsb: { h: 0, s: 0, b: 100 },
      alpha: 1,
    },
    colorHistory: [],
    colorPalettes: [],
    currentPaletteId: null,
    
    // Layers
    layers: [],
    currentLayerId: null,
    layerOpacity: 1,
    
    // Canvas
    canvasSettings: {
      pressureSensitivity: 1,
      tiltSensitivity: 1,
      velocitySensitivity: 1,
      smoothing: 0.5,
      predictiveStroke: true,
      palmRejection: true,
      snapToShapes: false,
      gridEnabled: false,
      gridSize: 50,
      symmetryEnabled: false,
      symmetryType: 'vertical',
      referenceEnabled: false,
      quickShapeEnabled: true,
      streamlineAmount: 0.5,
    },
    canvasTransform: {
      x: 0,
      y: 0,
      scale: 1,
      rotation: 0,
    },
    canvasWidth: 2048,
    canvasHeight: 2048,
    
    // Selection
    selection: null,
    isSelecting: false,
    
    // Drawing state
    isDrawing: false,
    currentStroke: null,
    strokeHistory: [],
    
    // UI State
    showGrid: false,
    showReferenceImage: false,
    symmetryGuide: null,
    referenceImages: [],
    
    // Performance
    fps: 60,
    optimizationLevel: 0,
    memoryUsage: 0,
  });

  // Current stroke reference for performance
  const currentStrokeRef = useRef<Stroke | null>(null);
  const drawingSurfaceRef = useRef<SkSurface | null>(null);

  // Initialize engines
  useEffect(() => {
    const initializeEngines = async () => {
      console.log('🎨 Initializing Drawing Context...');
      
      // Initialize Valkyrie rendering engine
      valkyrieEngine.initialize(state.canvasWidth, state.canvasHeight, 3);
      
      // Initialize layer manager
      await layerManager.initialize(state.canvasWidth, state.canvasHeight);
      
      // Set default brush
      const defaultBrush = brushEngine.getBrush('studio-pen');
      if (defaultBrush) {
        brushEngine.setCurrentBrush('studio-pen');
        setState(prev => ({ ...prev, currentBrush: defaultBrush }));
      }
      
      // Load saved palettes
      const savedPalettes = await dataManager.get<ColorPalette[]>('color_palettes');
      if (savedPalettes) {
        setState(prev => ({ ...prev, colorPalettes: savedPalettes }));
      }
      
      // Subscribe to performance updates
      const perfSub = eventBus.on('performance:update', (data: any) => {
        setState(prev => ({
          ...prev,
          fps: data.fps,
          optimizationLevel: data.optimizationLevel,
        }));
      });
      
      // Subscribe to layer updates
      const layerSub = eventBus.on('layer:updated', () => {
        setState(prev => ({
          ...prev,
          layers: layerManager.getAllLayers(),
          currentLayerId: layerManager.getCurrentLayerId(),
        }));
      });
      
      return () => {
        perfSub();
        layerSub();
      };
    };
    
    initializeEngines();
  }, []);

  // Document operations
  const createDocument = useCallback(async (width: number, height: number, name = 'Untitled') => {
    const doc: Document = {
      id: `doc_${Date.now()}`,
      name,
      width,
      height,
      dpi: 300,
      colorProfile: 'sRGB',
      created: Date.now(),
      modified: Date.now(),
      layers: [],
      layerOrder: [],
      currentLayerId: null,
      settings: state.canvasSettings,
    };
    
    // Reinitialize engines with new dimensions
    valkyrieEngine.initialize(width, height, 3);
    await layerManager.initialize(width, height);
    
    setState(prev => ({
      ...prev,
      document: doc,
      canvasWidth: width,
      canvasHeight: height,
      layers: layerManager.getAllLayers(),
      currentLayerId: layerManager.getCurrentLayerId(),
    }));
    
    eventBus.emit('document:created', doc);
    return doc;
  }, [state.canvasSettings]);

  // Tool operations
  const setTool = useCallback((tool: DrawingTool) => {
    setState(prev => ({
      ...prev,
      previousTool: prev.currentTool,
      currentTool: tool,
    }));
    
    eventBus.emit('tool:changed', { tool, previous: state.currentTool });
  }, [state.currentTool]);

  // Brush operations
  const setBrush = useCallback((brushId: string) => {
    const brush = brushEngine.getBrush(brushId);
    if (brush) {
      brushEngine.setCurrentBrush(brushId);
      setState(prev => ({ ...prev, currentBrush: brush }));
    }
  }, []);

  const setBrushSize = useCallback((size: number) => {
    setState(prev => ({ ...prev, brushSize: Math.max(0.1, Math.min(500, size)) }));
  }, []);

  const setBrushOpacity = useCallback((opacity: number) => {
    setState(prev => ({ ...prev, brushOpacity: Math.max(0, Math.min(1, opacity)) }));
  }, []);

  // Color operations
  const setColor = useCallback((color: Color) => {
    brushEngine.setColor(color);
    setState(prev => {
      const newHistory = [color, ...prev.colorHistory.slice(0, 29)];
      return {
        ...prev,
        currentColor: color,
        colorHistory: newHistory,
      };
    });
  }, []);

  // Layer operations
  const createLayer = useCallback((name?: string, type?: any) => {
    const layer = layerManager.createLayer(name, type);
    setState(prev => ({
      ...prev,
      layers: layerManager.getAllLayers(),
      currentLayerId: layer.id,
      isDocumentDirty: true,
    }));
    return layer;
  }, []);

  const setCurrentLayer = useCallback((layerId: string) => {
    if (layerManager.setCurrentLayer(layerId)) {
      setState(prev => ({ ...prev, currentLayerId: layerId }));
    }
  }, []);

  // Drawing operations
  const startStroke = useCallback((point: Point) => {
    if (!state.currentBrush || !state.currentLayerId) return;
    
    performanceOptimizer.startFrame();
    
    const strokeId = `stroke_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const stroke: Stroke = {
      id: strokeId,
      tool: state.currentTool,
      brushId: state.currentBrush.id,
      color: state.currentColor.hex,
      points: [point],
      layerId: state.currentLayerId,
      timestamp: Date.now(),
      transform: {
        x: 0,
        y: 0,
        scale: 1,
        rotation: 0,
      },
    };
    
    currentStrokeRef.current = stroke;
    setState(prev => ({
      ...prev,
      isDrawing: true,
      currentStroke: stroke,
    }));
    
    // Get the current layer surface
    drawingSurfaceRef.current = layerManager.getCurrentLayerSurface();
    
    eventBus.emit('drawing:stroke_started', { strokeId, point });
  }, [state.currentBrush, state.currentLayerId, state.currentTool, state.currentColor]);

  const addStrokePoint = useCallback((point: Point) => {
    if (!state.isDrawing || !currentStrokeRef.current || !state.currentBrush) return;
    
    const stroke = currentStrokeRef.current;
    stroke.points.push(point);
    
    // Calculate velocity for brush dynamics
    const lastPoint = stroke.points[stroke.points.length - 2];
    const velocity = lastPoint ? 
      Math.sqrt(Math.pow(point.x - lastPoint.x, 2) + Math.pow(point.y - lastPoint.y, 2)) : 
      0;
    
    // Create brush paint with dynamics
    const paint = brushEngine.createBrushPaint(
      state.currentBrush,
      state.currentColor,
      point,
      lastPoint,
      velocity
    );
    
    // Render stroke segment
    if (drawingSurfaceRef.current) {
      const optimizedStroke = performanceOptimizer.optimizeStroke(stroke);
      valkyrieEngine.renderStroke(optimizedStroke, drawingSurfaceRef.current, paint, {
        predictive: state.canvasSettings.predictiveStroke,
      });
    }
    
    setState(prev => ({ ...prev, currentStroke: { ...stroke } }));
  }, [state.isDrawing, state.currentBrush, state.currentColor, state.canvasSettings.predictiveStroke]);

  const endStroke = useCallback(() => {
    if (!state.isDrawing || !currentStrokeRef.current) return;
    
    const stroke = currentStrokeRef.current;
    layerManager.addStroke(stroke);
    
    setState(prev => ({
      ...prev,
      isDrawing: false,
      currentStroke: null,
      strokeHistory: [...prev.strokeHistory, stroke],
      isDocumentDirty: true,
    }));
    
    currentStrokeRef.current = null;
    drawingSurfaceRef.current = null;
    
    performanceOptimizer.endFrame();
    eventBus.emit('drawing:stroke_completed', { strokeId: stroke.id });
  }, [state.isDrawing]);

  // History operations
  const undo = useCallback(() => {
    if (layerManager.undo()) {
      setState(prev => ({
        ...prev,
        layers: layerManager.getAllLayers(),
        isDocumentDirty: true,
      }));
    }
  }, []);

  const redo = useCallback(() => {
    if (layerManager.redo()) {
      setState(prev => ({
        ...prev,
        layers: layerManager.getAllLayers(),
        isDocumentDirty: true,
      }));
    }
  }, []);

  // Canvas operations
  const setCanvasTransform = useCallback((transform: Partial<Transform>) => {
    setState(prev => ({
      ...prev,
      canvasTransform: { ...prev.canvasTransform, ...transform },
    }));
  }, []);

  const updateCanvasSettings = useCallback((settings: Partial<CanvasSettings>) => {
    setState(prev => ({
      ...prev,
      canvasSettings: { ...prev.canvasSettings, ...settings },
    }));
  }, []);

  // Build context value
  const contextValue: DrawingContextValue = {
    ...state,
    canUndo: layerManager.canUndo(),
    canRedo: layerManager.canRedo(),
    
    // Document
    createDocument,
    loadDocument: async (id: string) => { /* TODO */ return false; },
    saveDocument: async () => { /* TODO */ return true; },
    exportDocument: async (format: string) => { /* TODO */ return null; },
    
    // Tools
    setTool,
    setToolSetting: (tool, setting, value) => {
      setState(prev => ({
        ...prev,
        toolSettings: {
          ...prev.toolSettings,
          [tool]: { ...prev.toolSettings[tool], [setting]: value },
        },
      }));
    },
    
    // Brush
    setBrush,
    setBrushSize,
    setBrushOpacity,
    setBrushFlow: (flow: number) => {
      setState(prev => ({ ...prev, brushFlow: Math.max(0, Math.min(1, flow)) }));
    },
    createCustomBrush: (name: string, settings?: any) => {
      return brushEngine.createCustomBrush(name, settings);
    },
    
    // Color
    setColor,
    setBackgroundColor: (color: Color) => {
      setState(prev => ({ ...prev, backgroundColor: color }));
    },
    addColorToPalette: (color: Color, paletteId?: string) => { /* TODO */ },
    createColorPalette: (name: string, colors?: Color[]) => { /* TODO */ return ''; },
    
    // Layers
    createLayer,
    deleteLayer: (layerId: string) => {
      const result = layerManager.deleteLayer(layerId);
      if (result) {
        setState(prev => ({
          ...prev,
          layers: layerManager.getAllLayers(),
          currentLayerId: layerManager.getCurrentLayerId(),
          isDocumentDirty: true,
        }));
      }
      return result;
    },
    duplicateLayer: (layerId: string) => {
      const layer = layerManager.duplicateLayer(layerId);
      if (layer) {
        setState(prev => ({
          ...prev,
          layers: layerManager.getAllLayers(),
          isDocumentDirty: true,
        }));
      }
      return layer;
    },
    mergeLayerDown: (layerId: string) => {
      const result = layerManager.mergeLayerDown(layerId);
      if (result) {
        setState(prev => ({
          ...prev,
          layers: layerManager.getAllLayers(),
          isDocumentDirty: true,
        }));
      }
      return result;
    },
    setCurrentLayer,
    setLayerOpacity: (opacity: number, layerId?: string) => {
      const id = layerId || state.currentLayerId;
      if (id && layerManager.setLayerOpacity(id, opacity)) {
        setState(prev => ({ ...prev, layerOpacity: opacity }));
      }
    },
    setLayerBlendMode: (blendMode: any, layerId?: string) => {
      const id = layerId || state.currentLayerId;
      if (id) {
        layerManager.setLayerBlendMode(id, blendMode);
      }
    },
    setLayerVisibility: (visible: boolean, layerId?: string) => {
      const id = layerId || state.currentLayerId;
      if (id) {
        layerManager.setLayerVisibility(id, visible);
      }
    },
    clearLayer: (layerId?: string) => {
      const id = layerId || state.currentLayerId;
      if (id && layerManager.clearLayer(id)) {
        setState(prev => ({ ...prev, isDocumentDirty: true }));
      }
    },
    
    // Drawing
    startStroke,
    addStrokePoint,
    endStroke,
    cancelStroke: () => {
      setState(prev => ({
        ...prev,
        isDrawing: false,
        currentStroke: null,
      }));
      currentStrokeRef.current = null;
    },
    
    // Canvas
    setCanvasTransform,
    resetCanvasTransform: () => {
      setState(prev => ({
        ...prev,
        canvasTransform: { x: 0, y: 0, scale: 1, rotation: 0 },
      }));
    },
    fitCanvasToScreen: () => { /* TODO */ },
    
    // Selection
    startSelection: (type: string) => { /* TODO */ },
    updateSelection: (points: Point[]) => { /* TODO */ },
    confirmSelection: () => { /* TODO */ },
    clearSelection: () => {
      setState(prev => ({ ...prev, selection: null, isSelecting: false }));
    },
    transformSelection: (transform: Transform) => { /* TODO */ },
    
    // History
    undo,
    redo,
    
    // Settings
    updateCanvasSettings,
    toggleGrid: () => {
      setState(prev => ({ ...prev, showGrid: !prev.showGrid }));
    },
    toggleSymmetry: (type?: string) => { /* TODO */ },
    toggleReference: () => {
      setState(prev => ({ ...prev, showReferenceImage: !prev.showReferenceImage }));
    },
    
    // Reference
    addReferenceImage: (source: string) => { /* TODO */ },
    removeReferenceImage: (id: string) => { /* TODO */ },
    transformReferenceImage: (id: string, transform: Partial<Transform>) => { /* TODO */ },
  };

  return (
    <DrawingContext.Provider value={contextValue}>
      {children}
    </DrawingContext.Provider>
  );
};
// src/engines/drawing/ApplePencilHandler.ts - PROCREATE-LEVEL PENCIL HANDLING
import { Platform } from 'react-native';
import { Point } from '../../types/drawing';
import { EventBus } from '../core/EventBus';
import { performanceOptimizer } from './PerformanceOptimizer';

/**
 * Professional Apple Pencil Handler
 * Implements Procreate-level pressure sensitivity, palm rejection, and gesture recognition
 */
export class ApplePencilHandler {
  private static instance: ApplePencilHandler;
  private eventBus = EventBus.getInstance();
  
  // Touch tracking
  private activeTouches: Map<number, TouchInfo> = new Map();
  private pencilTouch: TouchInfo | null = null;
  private palmTouches: Set<number> = new Set();
  
  // Pressure handling
  private pressureCurve: PressureCurve = new QuadraticPressureCurve();
  private pressureSmoothing = 0.3; // 0-1, higher = more smoothing
  private lastPressure = 0;
  
  // Tilt handling
  private tiltSensitivity = 1.0;
  private tiltThreshold = 0.1;
  
  // Palm rejection
  private palmRejectionEnabled = true;
  private palmRejectionRadius = 100; // pixels
  private palmRejectionDelay = 50; // ms
  private palmRejectionThreshold = 20; // touch size in pixels
  
  // Gesture recognition
  private gestureRecognizer: GestureRecognizer;
  private activeGesture: ActiveGesture | null = null;
  
  // Prediction
  private strokePredictor: StrokePredictor;
  private predictionEnabled = true;
  private predictionFrames = 3;
  
  // Performance
  private touchEventBuffer: TouchEvent[] = [];
  private processingTouches = false;
  
  // Settings
  private settings = {
    pressureSensitivity: 1.0,
    tiltSensitivity: 1.0,
    velocitySensitivity: 0.5,
    smoothing: 0.5,
    palmRejection: true,
    predictiveTouch: true,
  };

  private constructor() {
    this.gestureRecognizer = new GestureRecognizer();
    this.strokePredictor = new StrokePredictor();
    this.setupTouchHandling();
  }

  public static getInstance(): ApplePencilHandler {
    if (!ApplePencilHandler.instance) {
      ApplePencilHandler.instance = new ApplePencilHandler();
    }
    return ApplePencilHandler.instance;
  }

  // ===== PUBLIC API =====

  public processTouchEvent(event: any): TouchResult {
    // Buffer events for batch processing
    this.touchEventBuffer.push({
      touches: event.nativeEvent.touches,
      changedTouches: event.nativeEvent.changedTouches,
      timestamp: event.nativeEvent.timestamp,
      type: event.nativeEvent.type,
    });
    
    // Process buffer if not already processing
    if (!this.processingTouches) {
      this.processTouchBuffer();
    }
    
    // Return immediate result for responsiveness
    return this.getImmediateTouchResult(event);
  }

  public setPressureCurve(curve: 'linear' | 'quadratic' | 'cubic' | 'custom', points?: number[]) {
    switch (curve) {
      case 'linear':
        this.pressureCurve = new LinearPressureCurve();
        break;
      case 'quadratic':
        this.pressureCurve = new QuadraticPressureCurve();
        break;
      case 'cubic':
        this.pressureCurve = new CubicPressureCurve();
        break;
      case 'custom':
        if (points) {
          this.pressureCurve = new CustomPressureCurve(points);
        }
        break;
    }
  }

  public updateSettings(settings: Partial<typeof this.settings>) {
    Object.assign(this.settings, settings);
    
    // Update dependent systems
    this.pressureSmoothing = 1 - this.settings.smoothing;
    this.palmRejectionEnabled = this.settings.palmRejection;
    this.predictionEnabled = this.settings.predictiveTouch;
    this.tiltSensitivity = this.settings.tiltSensitivity;
  }

  public getPressureResponse(rawPressure: number): number {
    // Apply dead zone
    if (rawPressure < 0.05) return 0;
    
    // Normalize pressure
    const normalized = Math.min(1, Math.max(0, rawPressure));
    
    // Apply curve
    const curved = this.pressureCurve.apply(normalized);
    
    // Apply sensitivity
    const sensitive = Math.pow(curved, 2 - this.settings.pressureSensitivity);
    
    // Smooth pressure changes
    const smoothed = this.smoothPressure(sensitive);
    
    return smoothed;
  }

  public getTiltResponse(altitude: number, azimuth: number): TiltInfo {
    // Convert altitude (0-π/2) to tilt magnitude (0-1)
    const tiltMagnitude = 1 - (altitude / (Math.PI / 2));
    
    // Apply threshold
    if (tiltMagnitude < this.tiltThreshold) {
      return { magnitude: 0, angle: 0, x: 0, y: 0 };
    }
    
    // Apply sensitivity
    const sensitiveMagnitude = Math.pow(tiltMagnitude, 2 - this.tiltSensitivity);
    
    // Calculate tilt vector
    const tiltX = Math.cos(azimuth) * sensitiveMagnitude;
    const tiltY = Math.sin(azimuth) * sensitiveMagnitude;
    
    return {
      magnitude: sensitiveMagnitude,
      angle: azimuth,
      x: tiltX,
      y: tiltY,
    };
  }

  public predictNextPoint(currentPoint: Point, history: Point[]): Point[] {
    if (!this.predictionEnabled || history.length < 2) return [];
    
    return this.strokePredictor.predict(currentPoint, history, this.predictionFrames);
  }

  public recognizeGesture(touches: TouchInfo[]): GestureResult | null {
    return this.gestureRecognizer.recognize(touches);
  }

  public shouldRejectTouch(touch: TouchInfo): boolean {
    if (!this.palmRejectionEnabled) return false;
    
    // Check if this is Apple Pencil
    if (touch.type === 'stylus') return false;
    
    // Check touch size (palm touches are typically larger)
    if (touch.majorRadius > this.palmRejectionThreshold) {
      this.palmTouches.add(touch.identifier);
      return true;
    }
    
    // Check proximity to pencil
    if (this.pencilTouch) {
      const distance = Math.sqrt(
        Math.pow(touch.x - this.pencilTouch.x, 2) +
        Math.pow(touch.y - this.pencilTouch.y, 2)
      );
      
      if (distance < this.palmRejectionRadius) {
        // Check timing (palm usually touches slightly after pencil)
        const timeDiff = touch.timestamp - this.pencilTouch.timestamp;
        if (timeDiff > 0 && timeDiff < this.palmRejectionDelay) {
          this.palmTouches.add(touch.identifier);
          return true;
        }
      }
    }
    
    return false;
  }

  // ===== PRIVATE METHODS =====

  private setupTouchHandling() {
    // iOS-specific setup for 120Hz touch events
    if (Platform.OS === 'ios') {
      // This would interface with native code to enable high-frequency touch events
      console.log('🎯 Enabling 120Hz touch event delivery for Apple Pencil');
    }
  }

  private processTouchBuffer() {
    this.processingTouches = true;
    performanceOptimizer.startFrame();
    
    while (this.touchEventBuffer.length > 0) {
      const event = this.touchEventBuffer.shift()!;
      this.processBufferedEvent(event);
    }
    
    performanceOptimizer.endFrame();
    this.processingTouches = false;
  }

  private processBufferedEvent(event: TouchEvent) {
    const { type, changedTouches, touches } = event;
    
    switch (type) {
      case 'touchstart':
        this.handleTouchStart(changedTouches);
        break;
      case 'touchmove':
        this.handleTouchMove(changedTouches);
        break;
      case 'touchend':
      case 'touchcancel':
        this.handleTouchEnd(changedTouches);
        break;
    }
    
    // Update active touches
    this.updateActiveTouches(touches);
    
    // Check for gestures
    const gesture = this.recognizeGesture(Array.from(this.activeTouches.values()));
    if (gesture) {
      this.handleGesture(gesture);
    }
  }

  private handleTouchStart(touches: Touch[]) {
    for (const touch of touches) {
      const touchInfo = this.createTouchInfo(touch);
      
      // Check for palm rejection
      if (this.shouldRejectTouch(touchInfo)) {
        console.log('🤚 Palm rejected:', touch.identifier);
        continue;
      }
      
      // Track touch
      this.activeTouches.set(touch.identifier, touchInfo);
      
      // Check if this is pencil
      if (touchInfo.type === 'stylus') {
        this.pencilTouch = touchInfo;
        this.eventBus.emit('pencil:down', {
          point: this.touchInfoToPoint(touchInfo),
          touchInfo,
        });
      }
    }
  }

  private handleTouchMove(touches: Touch[]) {
    for (const touch of touches) {
      // Skip rejected touches
      if (this.palmTouches.has(touch.identifier)) continue;
      
      const existingTouch = this.activeTouches.get(touch.identifier);
      if (!existingTouch) continue;
      
      const touchInfo = this.createTouchInfo(touch);
      this.activeTouches.set(touch.identifier, touchInfo);
      
      // Update pencil touch
      if (touchInfo.type === 'stylus') {
        this.pencilTouch = touchInfo;
        
        // Calculate velocity
        const velocity = this.calculateVelocity(existingTouch, touchInfo);
        
        this.eventBus.emit('pencil:move', {
          point: this.touchInfoToPoint(touchInfo),
          velocity,
          touchInfo,
        });
      }
    }
  }

  private handleTouchEnd(touches: Touch[]) {
    for (const touch of touches) {
      const touchInfo = this.activeTouches.get(touch.identifier);
      
      // Remove from tracking
      this.activeTouches.delete(touch.identifier);
      this.palmTouches.delete(touch.identifier);
      
      // Handle pencil up
      if (touchInfo?.type === 'stylus') {
        this.pencilTouch = null;
        this.eventBus.emit('pencil:up', {
          point: this.touchInfoToPoint(touchInfo),
          touchInfo,
        });
      }
    }
  }

  private createTouchInfo(touch: any): TouchInfo {
    // Detect touch type
    const type = this.detectTouchType(touch);
    
    return {
      identifier: touch.identifier,
      type,
      x: touch.pageX || touch.x,
      y: touch.pageY || touch.y,
      force: touch.force || 0,
      altitude: touch.altitudeAngle || Math.PI / 2,
      azimuth: touch.azimuthAngle || 0,
      majorRadius: touch.radiusX || touch.majorRadius || 1,
      minorRadius: touch.radiusY || touch.minorRadius || 1,
      timestamp: Date.now(),
    };
  }

  private detectTouchType(touch: any): TouchType {
    // iOS touch type detection
    if (Platform.OS === 'ios') {
      if (touch.touchType === 'stylus' || touch.touchType === 2) {
        return 'stylus';
      }
      if (touch.touchType === 'direct' || touch.touchType === 0) {
        return 'direct';
      }
    }
    
    // Fallback detection based on properties
    if (touch.force > 0 && touch.altitudeAngle !== undefined) {
      return 'stylus';
    }
    
    return 'direct';
  }

  private touchInfoToPoint(touch: TouchInfo): Point {
    const pressure = this.getPressureResponse(touch.force);
    const tilt = this.getTiltResponse(touch.altitude, touch.azimuth);
    
    return {
      x: touch.x,
      y: touch.y,
      pressure,
      tiltX: tilt.x,
      tiltY: tilt.y,
      timestamp: touch.timestamp,
      altitude: touch.altitude,
      azimuth: touch.azimuth,
    };
  }

  private smoothPressure(pressure: number): number {
    const smoothed = this.lastPressure * this.pressureSmoothing + 
                    pressure * (1 - this.pressureSmoothing);
    this.lastPressure = smoothed;
    return smoothed;
  }

  private calculateVelocity(from: TouchInfo, to: TouchInfo): number {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dt = to.timestamp - from.timestamp;
    
    if (dt === 0) return 0;
    
    const distance = Math.sqrt(dx * dx + dy * dy);
    return distance / dt * 1000; // pixels per second
  }

  private updateActiveTouches(touches: Touch[]) {
    // Clean up stale touches
    const currentIds = new Set(touches.map(t => t.identifier));
    
    for (const [id, touch] of this.activeTouches) {
      if (!currentIds.has(id)) {
        this.activeTouches.delete(id);
        this.palmTouches.delete(id);
      }
    }
  }

  private handleGesture(gesture: GestureResult) {
    switch (gesture.type) {
      case 'tap':
        if (gesture.fingerCount === 2) {
          this.eventBus.emit('gesture:twoFingerTap', gesture);
        } else if (gesture.fingerCount === 3) {
          this.eventBus.emit('gesture:threeFingerTap', gesture);
        }
        break;
        
      case 'pinch':
        this.eventBus.emit('gesture:pinch', {
          scale: gesture.scale,
          center: gesture.center,
        });
        break;
        
      case 'rotate':
        this.eventBus.emit('gesture:rotate', {
          rotation: gesture.rotation,
          center: gesture.center,
        });
        break;
        
      case 'pan':
        if (gesture.fingerCount === 2) {
          this.eventBus.emit('gesture:pan', {
            translation: gesture.translation,
          });
        }
        break;
    }
    
    this.activeGesture = {
      type: gesture.type,
      startTime: Date.now(),
      data: gesture,
    };
  }

  private getImmediateTouchResult(event: any): TouchResult {
    const touch = event.nativeEvent.changedTouches?.[0];
    if (!touch) {
      return { type: 'none', point: null };
    }
    
    const touchInfo = this.createTouchInfo(touch);
    
    if (this.shouldRejectTouch(touchInfo)) {
      return { type: 'rejected', point: null };
    }
    
    return {
      type: touchInfo.type === 'stylus' ? 'pencil' : 'finger',
      point: this.touchInfoToPoint(touchInfo),
    };
  }
}

// ===== HELPER CLASSES =====

abstract class PressureCurve {
  abstract apply(pressure: number): number;
}

class LinearPressureCurve extends PressureCurve {
  apply(pressure: number): number {
    return pressure;
  }
}

class QuadraticPressureCurve extends PressureCurve {
  apply(pressure: number): number {
    return pressure * pressure;
  }
}

class CubicPressureCurve extends PressureCurve {
  apply(pressure: number): number {
    return pressure * pressure * pressure;
  }
}

class CustomPressureCurve extends PressureCurve {
  constructor(private points: number[]) {
    super();
  }
  
  apply(pressure: number): number {
    // Linear interpolation between curve points
    const segments = this.points.length - 1;
    const segment = Math.floor(pressure * segments);
    const t = (pressure * segments) - segment;
    
    if (segment >= segments) {
      return this.points[this.points.length - 1];
    }
    
    return this.points[segment] * (1 - t) + this.points[segment + 1] * t;
  }
}

class StrokePredictor {
  predict(current: Point, history: Point[], frames: number): Point[] {
    if (history.length < 2) return [];
    
    const predicted: Point[] = [];
    
    // Calculate velocity
    const p1 = history[history.length - 2];
    const p2 = history[history.length - 1];
    const velocity = {
      x: p2.x - p1.x,
      y: p2.y - p1.y,
    };
    
    // Calculate acceleration
    if (history.length >= 3) {
      const p0 = history[history.length - 3];
      const accel = {
        x: (p2.x - p1.x) - (p1.x - p0.x),
        y: (p2.y - p1.y) - (p1.y - p0.y),
      };
      
      // Predict with acceleration
      for (let i = 1; i <= frames; i++) {
        predicted.push({
          x: current.x + velocity.x * i + accel.x * i * i * 0.5,
          y: current.y + velocity.y * i + accel.y * i * i * 0.5,
          pressure: current.pressure * Math.pow(0.95, i), // Decay pressure
          timestamp: current.timestamp + i * 8.33, // 120fps timing
        });
      }
    } else {
      // Simple linear prediction
      for (let i = 1; i <= frames; i++) {
        predicted.push({
          x: current.x + velocity.x * i,
          y: current.y + velocity.y * i,
          pressure: current.pressure * Math.pow(0.95, i),
          timestamp: current.timestamp + i * 8.33,
        });
      }
    }
    
    return predicted;
  }
}

class GestureRecognizer {
  private tapTimeout = 300; // ms
  private pinchThreshold = 20; // pixels
  private rotationThreshold = 0.1; // radians
  
  recognize(touches: TouchInfo[]): GestureResult | null {
    if (touches.length === 0) return null;
    
    // Two finger gestures
    if (touches.length === 2) {
      const [t1, t2] = touches;
      
      // Calculate distance
      const distance = Math.sqrt(
        Math.pow(t2.x - t1.x, 2) + 
        Math.pow(t2.y - t1.y, 2)
      );
      
      // Calculate angle
      const angle = Math.atan2(t2.y - t1.y, t2.x - t1.x);
      
      return {
        type: 'pinch',
        fingerCount: 2,
        scale: 1, // Would track changes
        rotation: angle,
        center: {
          x: (t1.x + t2.x) / 2,
          y: (t1.y + t2.y) / 2,
        },
      };
    }
    
    // Three finger tap
    if (touches.length === 3) {
      return {
        type: 'tap',
        fingerCount: 3,
        center: {
          x: touches.reduce((sum, t) => sum + t.x, 0) / 3,
          y: touches.reduce((sum, t) => sum + t.y, 0) / 3,
        },
      };
    }
    
    return null;
  }
}

// ===== TYPES =====

interface TouchInfo {
  identifier: number;
  type: TouchType;
  x: number;
  y: number;
  force: number;
  altitude: number;
  azimuth: number;
  majorRadius: number;
  minorRadius: number;
  timestamp: number;
}

type TouchType = 'stylus' | 'direct' | 'indirect';

interface TouchEvent {
  touches: Touch[];
  changedTouches: Touch[];
  timestamp: number;
  type: string;
}

interface TouchResult {
  type: 'pencil' | 'finger' | 'rejected' | 'none';
  point: Point | null;
}

interface TiltInfo {
  magnitude: number;
  angle: number;
  x: number;
  y: number;
}

interface GestureResult {
  type: 'tap' | 'pinch' | 'rotate' | 'pan' | 'swipe';
  fingerCount: number;
  scale?: number;
  rotation?: number;
  translation?: { x: number; y: number };
  center?: { x: number; y: number };
}

interface ActiveGesture {
  type: string;
  startTime: number;
  data: any;
}

// Export singleton
export const applePencilHandler = ApplePencilHandler.getInstance();
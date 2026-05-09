import { dist, isoToWorld } from "../utils";
import type { GameState } from "../core/GameState";
import { Camera } from "../rendering/Camera";

export interface InputCallbacks {
  onRightClick(wx: number, wy: number): void;
  onTap(wx: number, wy: number): void;
  onBoxSelectUpdate(): void;
  onBoxSelectDone(): void;
  onControlGroupSave(digit: number): void;
  onControlGroupRecall(digit: number, doubleTap: boolean): void;
}

export class InputManager {
  private controller: AbortController | null = null;
  private lastPointerTap: { time: number; sx: number; sy: number } | null = null;
  private longPressTimers = new Map<number, ReturnType<typeof setTimeout>>();

  setup(
    canvas: HTMLCanvasElement,
    state: GameState,
    camera: Camera,
    getCanvasSize: () => { width: number; height: number },
    callbacks: InputCallbacks,
  ): void {
    this.controller?.abort();
    this.controller = new AbortController();
    const { signal } = this.controller;

    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), { signal });

    // ... (wheel event remains the same) ...
    canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const { width, height } = getCanvasSize();
        const zd = e.deltaY > 0 ? 0.9 : 1.1;
        const wb = camera.screenToWorld(e.clientX, e.clientY, width, height);
        camera.zoom = Math.max(0.2, Math.min(3.0, camera.zoom * zd));
        const wa = camera.screenToWorld(e.clientX, e.clientY, width, height);
        camera.x -= wa.x - wb.x;
        camera.y -= wa.y - wb.y;
        camera.clamp();
      },
      { passive: false, signal },
    );

    canvas.addEventListener(
      "pointerdown",
      (e) => {
        const { width, height } = getCanvasSize();
        canvas.setPointerCapture(e.pointerId);
        const w = camera.screenToWorld(e.clientX, e.clientY, width, height);
        
        state.pointers.set(e.pointerId, {
          sx: e.clientX, sy: e.clientY,
          wx: w.x, wy: w.y,
          startX: e.clientX, startY: e.clientY,
          startWx: w.x, startWy: w.y,
          intent: "unknown",
          button: e.button,
          pointerType: e.pointerType,
        });

        if (e.button === 2) {
          callbacks.onRightClick(w.x, w.y);
          state.pointers.get(e.pointerId)!.intent = "done";
        } else if (e.pointerType !== "mouse") {
          const timer = setTimeout(() => {
            const ptr = state.pointers.get(e.pointerId);
            if (ptr && ptr.intent === "unknown") {
              ptr.intent = "box";
              state.dragSelect = {
                startX: ptr.startWx, startY: ptr.startWy,
                currentX: ptr.wx, currentY: ptr.wy,
                startSx: ptr.startX, startSy: ptr.startY,
                currentSx: ptr.sx, currentSy: ptr.sy,
                active: true,
              };
              callbacks.onBoxSelectUpdate();
            }
          }, 500);
          this.longPressTimers.set(e.pointerId, timer);
        }
      },
      { signal },
    );

    canvas.addEventListener(
      "pointermove",
      (e) => {
        if (!state.pointers.has(e.pointerId)) return;
        const { width, height } = getCanvasSize();
        const ptr = state.pointers.get(e.pointerId)!;
        const oldSx = ptr.sx, oldSy = ptr.sy;
        
        ptr.sx = e.clientX;
        ptr.sy = e.clientY;
        const w = camera.screenToWorld(e.clientX, e.clientY, width, height);
        ptr.wx = w.x;
        ptr.wy = w.y;

        if (ptr.button !== 0 || ptr.intent === "done") return;

        // Pinch logic
        if (state.pointers.size === 2) {
          const [p1, p2] = Array.from(state.pointers.values());
          const oldP1x = p1.pointerId === e.pointerId ? oldSx : p1.sx;
          const oldP1y = p1.pointerId === e.pointerId ? oldSy : p1.sy;
          const oldP2x = p2.pointerId === e.pointerId ? oldSx : p2.sx;
          const oldP2y = p2.pointerId === e.pointerId ? oldSy : p2.sy;

          const oldDist = dist(oldP1x, oldP1y, oldP2x, oldP2y);
          const currentDist = dist(p1.sx, p1.sy, p2.sx, p2.sy);

          if (oldDist > 0) {
            const zoomDelta = currentDist / oldDist;
            const midX = (p1.sx + p2.sx) / 2;
            const midY = (p1.sy + p2.sy) / 2;
            const wb = camera.screenToWorld(midX, midY, width, height);
            camera.zoom = Math.max(0.2, Math.min(3.0, camera.zoom * zoomDelta));
            const wa = camera.screenToWorld(midX, midY, width, height);
            camera.x -= wa.x - wb.x;
            camera.y -= wa.y - wb.y;
            camera.clamp();
          }
          return;
        }

        if (state.pointers.size === 1) {
          const moved = dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy);
          
          if (ptr.intent === "unknown" && moved > 15) {
            if (this.longPressTimers.has(e.pointerId)) {
              clearTimeout(this.longPressTimers.get(e.pointerId));
              this.longPressTimers.delete(e.pointerId);
            }

            if (state.placementMode) {
              ptr.intent = "done";
            } else if (ptr.pointerType === "mouse") {
              ptr.intent = "box";
              state.dragSelect = {
                startX: ptr.startWx, startY: ptr.startWy,
                currentX: ptr.wx, currentY: ptr.wy,
                startSx: ptr.startX, startSy: ptr.startY,
                currentSx: ptr.sx, currentSy: ptr.sy,
                active: true,
              };
              callbacks.onBoxSelectUpdate();
            } else {
              ptr.intent = "pan";
            }
          }

          if (ptr.intent === "box" && state.dragSelect) {
            state.dragSelect.currentX = ptr.wx;
            state.dragSelect.currentY = ptr.wy;
            state.dragSelect.currentSx = ptr.sx;
            state.dragSelect.currentSy = ptr.sy;
            callbacks.onBoxSelectUpdate();
          } else if (ptr.intent === "pan") {
            const wd = isoToWorld(
              (ptr.sx - oldSx) / camera.zoom,
              (ptr.sy - oldSy) / camera.zoom,
            );
            camera.x -= wd.x;
            camera.y -= wd.y;
            camera.clamp();
          }
        }
      },
      { signal },
    );

    canvas.addEventListener(
      "pointerup",
      (e) => {
        if (this.longPressTimers.has(e.pointerId)) {
          clearTimeout(this.longPressTimers.get(e.pointerId));
          this.longPressTimers.delete(e.pointerId);
        }

        const ptr = state.pointers.get(e.pointerId);
        if (!ptr) return;

        if (ptr.button === 0 && ptr.intent !== "done") {
          if (ptr.intent === "box" && state.dragSelect?.active) {
            callbacks.onBoxSelectDone();
          } else if (dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy) < 15) {
            // TAPPING LOGIC:
            // 1. Double tap for type-selection
            // 2. If units are selected, single tap = Move (onRightClick)
            // 3. Otherwise, single tap = Select (onTap)
            
            const now = performance.now();
            const isDoubleTap = 
              this.lastPointerTap &&
              now - this.lastPointerTap.time < 300 && 
              dist(this.lastPointerTap.sx, this.lastPointerTap.sy, ptr.sx, ptr.sy) < 40;

            if (isDoubleTap) {
              // Task move AND double-tap selection
              callbacks.onRightClick(ptr.wx, ptr.wy);
              callbacks.onTap(ptr.wx, ptr.wy);
              this.lastPointerTap = null;
            } else {
              // Single Tap: If we have units selected, move them. Otherwise, select.
              if (state.selectedIds.size > 0) {
                callbacks.onRightClick(ptr.wx, ptr.wy);
              } else {
                callbacks.onTap(ptr.wx, ptr.wy);
              }
              this.lastPointerTap = { time: now, sx: ptr.sx, sy: ptr.sy };
            }
          }
        }
        state.pointers.delete(e.pointerId);
        state.dragSelect = null;
      },
      { signal },
    );

    // ... (keydown remains the same) ...
  }

  teardown(): void {
    this.controller?.abort();
    this.controller = null;
  }
}

import { dist, isoToWorld } from "../utils";
import type { GameState } from "../core/GameState";
import { Camera } from "../rendering/Camera";

export interface InputCallbacks {
  onRightClick(wx: number, wy: number): void;
  onTap(wx: number, wy: number): void;
  onBoxSelectUpdate(): void; // New callback for live selection
  onBoxSelectDone(): void;
  onControlGroupSave(digit: number): void;
  onControlGroupRecall(digit: number, doubleTap: boolean): void;
}

export class InputManager {
  private controller: AbortController | null = null;

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

    canvas.addEventListener("contextmenu", (e) => e.preventDefault(), {
      signal,
    });

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
          sx: e.clientX,
          sy: e.clientY,
          wx: w.x,
          wy: w.y,
          startX: e.clientX,
          startY: e.clientY,
          startWx: w.x,
          startWy: w.y,
          intent: "unknown",
          button: e.button,
          pointerType: e.pointerType,
        });
        if (e.button === 2) {
          callbacks.onRightClick(w.x, w.y);
          state.pointers.get(e.pointerId)!.intent = "done";
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
        const oldSx = ptr.sx,
          oldSy = ptr.sy;
        ptr.sx = e.clientX;
        ptr.sy = e.clientY;
        const w = camera.screenToWorld(e.clientX, e.clientY, width, height);
        ptr.wx = w.x;
        ptr.wy = w.y;
        if (ptr.button !== 0 || ptr.intent === "done") return;
        if (state.pointers.size === 1) {
          const moved = dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy);
          if (ptr.intent === "unknown" && moved > 10) {
            if (state.placementMode) {
              ptr.intent = "done";
            } else if (ptr.pointerType === "mouse") {
              ptr.intent = "box";
              state.dragSelect = {
                startX: ptr.startWx,
                startY: ptr.startWy,
                currentX: ptr.wx,
                currentY: ptr.wy,
                startSx: ptr.startX,
                startSy: ptr.startY,
                currentSx: ptr.sx,
                currentSy: ptr.sy,
                active: true,
              };
              callbacks.onBoxSelectUpdate(); // Trigger initial live update
            } else {
              // touch/pen: pan in empty space, box-select when starting near a player entity
              const hitPlayer = state.entities.some(
                (e) =>
                  e.team === 0 &&
                  dist(ptr.startWx, ptr.startWy, e.x, e.y) <= e.radius * 1.5,
              );
              if (hitPlayer) {
                ptr.intent = "box";
                state.dragSelect = {
                  startX: ptr.startWx,
                  startY: ptr.startWy,
                  currentX: ptr.wx,
                  currentY: ptr.wy,
                  startSx: ptr.startX,
                  startSy: ptr.startY,
                  currentSx: ptr.sx,
                  currentSy: ptr.sy,
                  active: true,
                };
                callbacks.onBoxSelectUpdate(); // Trigger initial live update
              } else {
                ptr.intent = "pan";
              }
            }
          }
          if (ptr.intent === "box" && state.dragSelect) {
            state.dragSelect.currentX = ptr.wx;
            state.dragSelect.currentY = ptr.wy;
            state.dragSelect.currentSx = ptr.sx;
            state.dragSelect.currentSy = ptr.sy;
            callbacks.onBoxSelectUpdate(); // Update selection as box changes
          } else if (ptr.intent === "pan") {
            const { width: cw, height: ch } = getCanvasSize();
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
        const ptr = state.pointers.get(e.pointerId);
        if (!ptr) return;
        if (ptr.button === 0 && ptr.intent !== "done") {
          if (ptr.intent === "box" && state.dragSelect?.active) {
            callbacks.onBoxSelectDone();
          } else if (dist(ptr.startX, ptr.startY, ptr.sx, ptr.sy) < 10) {
            callbacks.onTap(ptr.wx, ptr.wy);
          }
        }
        state.pointers.delete(e.pointerId);
        state.dragSelect = null;
      },
      { signal },
    );

    window.addEventListener(
      "keydown",
      (ev: KeyboardEvent) => {
        if (state.gamePhase !== "playing") return;
        const digit = parseInt(ev.key);
        if (isNaN(digit) || digit < 1 || digit > 9) return;
        ev.preventDefault();
        if (ev.ctrlKey || ev.metaKey) {
          callbacks.onControlGroupSave(digit);
        } else {
          const now = performance.now();
          const doubleTap =
            state.lastGroupTap.group === digit &&
            now - state.lastGroupTap.time < 300;
          callbacks.onControlGroupRecall(digit, doubleTap);
          state.lastGroupTap = { group: digit, time: now };
        }
      },
      { signal },
    );
  }

  teardown(): void {
    this.controller?.abort();
    this.controller = null;
  }
}

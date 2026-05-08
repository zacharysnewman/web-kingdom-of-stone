import { dist, worldToIso } from "../utils";
import type { Entity } from "../entity";
import type { DragSelect } from "../types";
import { Container } from "pixi.js";

export class SelectionManager {
  /**
   * Updates the selectedIds to match exactly what is within the drag box.
   * Only includes player-owned (team 0) units.
   */
  // SelectionManager.ts
  // SelectionManager.ts
  performBoxSelect(
    dragSelect: DragSelect,
    entities: Entity[],
    selectedIds: Set<number>,
    worldContainer: Container, // We need this to get the unit's screen position
  ): void {
    const { startSx, startSy, currentSx, currentSy } = dragSelect;

    // Define the screen-space bounds
    const minX = Math.min(startSx, currentSx);
    const maxX = Math.max(startSx, currentSx);
    const minY = Math.min(startSy, currentSy);
    const maxY = Math.max(startSy, currentSy);

    selectedIds.clear();

    for (const e of entities) {
      if (e.team === 0 && e.type === "unit") {
        // Get the unit's actual position on the screen
        // This accounts for isometric projection, camera pan, and zoom
        const screenPos = worldContainer.toGlobal(worldToIso(e.x, e.y));

        if (
          screenPos.x >= minX &&
          screenPos.x <= maxX &&
          screenPos.y >= minY &&
          screenPos.y <= maxY
        ) {
          selectedIds.add(e.id);
        }
      }
    }
  }

  getEntityAt(wx: number, wy: number, entities: Entity[]): Entity | null {
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (dist(wx, wy, e.x, e.y) <= e.radius * 1.5) return e;
    }
    return null;
  }

  selectAllUnits(entities: Entity[], selectedIds: Set<number>): void {
    selectedIds.clear();
    entities.forEach((e) => {
      if (e.team === 0 && (e.subType === "soldier" || e.subType === "archer"))
        selectedIds.add(e.id);
    });
  }
}

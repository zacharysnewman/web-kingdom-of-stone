import { dist } from '../utils';
import type { Entity } from '../entity';
import type { DragSelect } from '../types';

export class SelectionManager {
    performBoxSelect(
        dragSelect: DragSelect,
        entities: Entity[],
        selectedIds: Set<number>,
    ): void {
        const { startX, startY, currentX, currentY } = dragSelect;
        const minX = Math.min(startX, currentX), maxX = Math.max(startX, currentX);
        const minY = Math.min(startY, currentY), maxY = Math.max(startY, currentY);
        const inBox = (e: Entity) => e.x >= minX && e.x <= maxX && e.y >= minY && e.y <= maxY;
        const units = entities.filter(e => e.team === 0 && e.type === 'unit' && inBox(e));
        selectedIds.clear();
        (units.length > 0 ? units : entities.filter(e => e.team === 0 && inBox(e)))
            .forEach(e => selectedIds.add(e.id));
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
        entities.forEach(e => {
            if (e.team === 0 && (e.subType === 'soldier' || e.subType === 'archer'))
                selectedIds.add(e.id);
        });
    }
}

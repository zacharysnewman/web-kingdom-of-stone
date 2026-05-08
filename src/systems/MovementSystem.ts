import { CONSTANTS, STATS } from '../constants';
import { dist, angle } from '../utils';
import type { Entity } from '../entity';
import type { Pathfinding } from '../map/Pathfinding';
import type { IGameAdapter } from '../core/IGameAdapter';

function isAdjacentToBuilding(unit: Entity, building: Entity): boolean {
    return dist(unit.x, unit.y, building.x, building.y) <= unit.radius + building.radius + 8;
}

function pushOutOfRect(entity: Entity, left: number, top: number, right: number, bottom: number): void {
    const r = entity.radius;
    const nearX = Math.max(left, Math.min(right, entity.x));
    const nearY = Math.max(top,  Math.min(bottom, entity.y));
    const dx = entity.x - nearX, dy = entity.y - nearY;
    const d = Math.hypot(dx, dy);
    if (d < r) {
        if (d > 0) {
            const push = r - d;
            entity.x += (dx / d) * push;
            entity.y += (dy / d) * push;
        } else {
            const dists = [entity.x - left, right - entity.x, entity.y - top, bottom - entity.y];
            const min = Math.min(...dists);
            if      (dists[0] === min) entity.x = left  - r;
            else if (dists[1] === min) entity.x = right + r;
            else if (dists[2] === min) entity.y = top   - r;
            else                       entity.y = bottom + r;
        }
    }
}

function resolveWorldCollisions(entity: Entity, stoneGrid: boolean[][], mapCellSize: number, entities: Entity[]): void {
    if (stoneGrid.length) {
        const C = mapCellSize, r = entity.radius;
        const cols = stoneGrid[0].length, rows = stoneGrid.length;
        const minCx = Math.max(0, Math.floor((entity.x - r) / C));
        const maxCx = Math.min(cols - 1, Math.floor((entity.x + r) / C));
        const minCy = Math.max(0, Math.floor((entity.y - r) / C));
        const maxCy = Math.min(rows - 1, Math.floor((entity.y + r) / C));
        for (let cy = minCy; cy <= maxCy; cy++)
            for (let cx = minCx; cx <= maxCx; cx++)
                if (stoneGrid[cy][cx])
                    pushOutOfRect(entity, cx * C, cy * C, (cx + 1) * C, (cy + 1) * C);
    }
    for (const other of entities) {
        if (other === entity || other.isDead) continue;
        if (other.type !== 'building' && other.type !== 'resource') continue;
        const r2 = other.radius;
        pushOutOfRect(entity, other.x - r2, other.y - r2, other.x + r2, other.y + r2);
    }
}

export function updateMovement(
    entities: Entity[],
    dt: number,
    pathfinding: Pathfinding,
    stoneGrid: boolean[][] | null,
    mapCellSize: number,
    adapter: IGameAdapter,
): void {
    // ── Steering pass ──────────────────────────────────────────────────────────
    for (const e of entities) {
        if (e.type !== 'unit') continue;
        if ((e.state === 'idle' || e.state === 'moving') && e.subType !== 'builder') {
            if (e.stance === 'aggressive') {
                let nearest: Entity | null = null, best = 220;
                for (const o of entities) {
                    if (o.team !== e.team && o.team !== -1 && !o.isDead) {
                        const score = dist(e.x, e.y, o.x, o.y) + (o.type === 'building' ? 100 : 0);
                        if (score < best) { best = score; nearest = o; }
                    }
                }
                if (nearest) { e.target = nearest; e.state = 'moving_to_attack'; e.waypoints = null; }
            } else {
                const strikeRange = (STATS[e.subType].range ?? 0) + e.radius + 30;
                let nearest: Entity | null = null, best = strikeRange;
                for (const o of entities) {
                    if (o.team !== e.team && o.team !== -1 && !o.isDead) {
                        const d = dist(e.x, e.y, o.x, o.y);
                        if (d < best) { best = d; nearest = o; }
                    }
                }
                if (nearest) { e.target = nearest; e.state = 'attacking'; }
            }
        }

        const stats = STATS[e.subType];
        let tvx = 0, tvy = 0;
        if (e.state.startsWith('moving')) {
            const destX = e.state === 'moving' ? e.targetX : (e.target?.x ?? e.targetX);
            const destY = e.state === 'moving' ? e.targetY : (e.target?.y ?? e.targetY);
            if (destX != null && destY != null) {
                if (e.waypoints == null)
                    e.waypoints = pathfinding.computePath(e, destX, destY);

                if (e.state === 'moving_to_attack' && e.target && !e.target.isDead && e.waypoints.length > 0) {
                    e.pathTimer = (e.pathTimer ?? 1.5) - dt;
                    if (e.pathTimer <= 0) {
                        e.waypoints = pathfinding.computePath(e, destX, destY);
                        e.pathTimer = 1.5;
                    }
                }

                if (e.waypoints.length === 0) {
                    const d0     = dist(e.x, e.y, destX, destY);
                    const isRng0 = (stats.range ?? 0) > 50;
                    const stop0  = e.state === 'moving_to_attack'
                        ? (isRng0 ? (stats.range ?? 0) + (e.target?.radius ?? 0) : e.radius + (e.target?.radius ?? 0) + 5)
                        : (e.state === 'moving_to_mine' || e.state === 'moving_to_base')
                        ? e.radius + (e.target?.radius ?? 0) + 8
                        : 5;
                    const adj0 = (e.state === 'moving_to_build' || e.state === 'moving_to_base') && e.target && isAdjacentToBuilding(e, e.target);
                    if (d0 <= stop0 || adj0) {
                        if (e.state === 'moving_to_base' && e.target) {
                            adapter.addGold(e.team, e.carryGold);
                            if (e.team === adapter.TEAM_PLAYER && e.carryGold > 0)
                                adapter.createFloatingText(`+${Math.floor(e.carryGold)}`, e.x, e.y - 20, '#fbbf24');
                            e.carryGold = 0;
                        }
                        e.state = e.state === 'moving_to_attack' ? 'attacking'
                                : e.state === 'moving_to_build'  ? 'building'
                                : e.state === 'moving_to_mine'   ? 'mining'
                                : 'idle';
                    } else if ((e.state === 'moving_to_build' || e.state === 'moving_to_mine' || e.state === 'moving_to_base') && e.target && !e.target.isDead) {
                        const a = angle(e.x, e.y, e.target.x, e.target.y);
                        tvx = Math.cos(a) * (stats.speed ?? 0);
                        tvy = Math.sin(a) * (stats.speed ?? 0);
                    } else if (e.state === 'moving_to_attack' && e.target && !e.target.isDead && d0 <= CONSTANTS.NAV_CELL * 3) {
                        const a = angle(e.x, e.y, destX, destY);
                        tvx = Math.cos(a) * (stats.speed ?? 0);
                        tvy = Math.sin(a) * (stats.speed ?? 0);
                    } else {
                        e.pathTimer = (e.pathTimer ?? 1.0) - dt;
                        if (e.pathTimer <= 0) { e.waypoints = null; e.pathTimer = 1.0; }
                    }
                } else {
                    while (e.waypoints.length > 1 &&
                           dist(e.x, e.y, e.waypoints[0].x, e.waypoints[0].y) < CONSTANTS.NAV_CELL)
                        e.waypoints.shift();
                    const finalApproach = (e.state === 'moving_to_build' || e.state === 'moving_to_base') && e.target && e.waypoints.length === 1;
                    const immX = finalApproach ? e.target!.x : e.waypoints[0].x;
                    const immY = finalApproach ? e.target!.y : e.waypoints[0].y;
                    const d    = dist(e.x, e.y, destX, destY);
                    const isRanged = (stats.range ?? 0) > 50;
                    const stop = e.state === 'moving_to_attack'
                        ? (isRanged ? (stats.range ?? 0) + (e.target?.radius ?? 0) : e.radius + (e.target?.radius ?? 0) + 5)
                        : (e.state === 'moving_to_mine' || e.state === 'moving_to_base')
                        ? e.radius + (e.target?.radius ?? 0) + 8
                        : 5;
                    const atTarget = d <= stop ||
                        ((e.state === 'moving_to_build' || e.state === 'moving_to_base') && e.target && isAdjacentToBuilding(e, e.target));
                    if (atTarget) {
                        if (e.state === 'moving_to_base' && e.target) {
                            adapter.addGold(e.team, e.carryGold);
                            if (e.team === adapter.TEAM_PLAYER && e.carryGold > 0)
                                adapter.createFloatingText(`+${Math.floor(e.carryGold)}`, e.x, e.y - 20, '#fbbf24');
                            e.carryGold = 0;
                        }
                        e.state = e.state === 'moving_to_attack' ? 'attacking'
                                : e.state === 'moving_to_build'  ? 'building'
                                : e.state === 'moving_to_mine'   ? 'mining'
                                : 'idle';
                        e.waypoints = [];
                    } else {
                        const a = angle(e.x, e.y, immX, immY);
                        tvx = Math.cos(a) * (stats.speed ?? 0);
                        tvy = Math.sin(a) * (stats.speed ?? 0);
                    }
                }
            } else {
                e.state = 'idle';
            }
        }

        let avx = 0, avy = 0;
        for (const o of entities) {
            if (o === e || o === e.target) continue;
            const d = dist(e.x, e.y, o.x, o.y);
            const safe = (e.radius + o.radius) * CONSTANTS.AVOIDANCE_RADIUS_MULT;
            if (d < safe) {
                const str = (1 - d / safe) * CONSTANTS.AVOIDANCE_FORCE;
                const a = angle(o.x, o.y, e.x, e.y);
                avx += Math.cos(a) * str; avy += Math.sin(a) * str;
            }
        }
        e.velX = tvx + avx; e.velY = tvy + avy;
    }

    // ── Movement application ───────────────────────────────────────────────────
    for (const e of entities) {
        if (e.type !== 'unit') continue;
        const canMove = e.stance !== 'hold' || e.state === 'moving' || e.state === 'moving_to_build';
        if (canMove) { e.x += e.velX * dt; e.y += e.velY * dt; }
        if (stoneGrid?.length) resolveWorldCollisions(e, stoneGrid, mapCellSize, entities);
    }
}

export { isAdjacentToBuilding };

import { dist } from '../utils';
import type { Entity } from '../entity';
import type { DifficultyConfig } from '../constants';
import type { IGameAdapter } from '../core/IGameAdapter';

export function updateAI(
    team: number,
    entities: Entity[],
    gold: number[],
    diff: DifficultyConfig,
    adapter: IGameAdapter,
): void {
    const units    = entities.filter(e => e.team === team);
    const tc       = units.find(e => e.subType === 'town_center');
    if (!tc) return;

    const goldAmt  = gold[team];
    const builders = units.filter(e => e.subType === 'builder');
    const idleB    = builders.filter(e => e.state === 'idle');

    if (idleB.length > 0) {
        const mines = entities.filter(e => e.type === 'resource' && !e.isDead);
        if (mines.length > 0) {
            idleB.forEach(b => {
                const closest = mines.reduce((prev, curr) =>
                    dist(b.x, b.y, curr.x, curr.y) < dist(b.x, b.y, prev.x, prev.y) ? curr : prev);
                b.target = closest; b.state = 'moving_to_mine'; b.waypoints = null;
            });
        }
    }

    if (builders.length < 4) adapter.trainUnit(tc, 'builder');

    const bar = units.find(e => e.subType === 'barracks');
    if (!bar && goldAmt >= 150) {
        const b = builders.find(e => e.state !== 'moving_to_build');
        if (b) {
            gold[team] -= 150;
            const bld = adapter.addEntity(
                'building', 'barracks',
                Math.round((tc.x + (team % 2 === 0 ? 1 : -1) * 140) / 20) * 20,
                Math.round((tc.y + 140) / 20) * 20,
                team,
            );
            bld.isConstructing = true; bld.hp = 1;
            b.target = bld; b.state = 'moving_to_build'; b.waypoints = null;
        }
    }

    if (bar && !bar.isConstructing && bar.buildQueue.length < 3) adapter.trainUnit(bar, 'soldier');

    const army = units.filter(e => e.subType === 'soldier' && e.state === 'idle');
    if (army.length >= diff.armyThreshold) {
        const enemyTCs = entities.filter(e => e.subType === 'town_center' && e.team !== team);
        if (enemyTCs.length > 0) {
            const targetTC = enemyTCs.reduce((prev, curr) =>
                dist(tc.x, tc.y, curr.x, curr.y) < dist(tc.x, tc.y, prev.x, prev.y) ? curr : prev);
            army.forEach(u => { u.target = targetTC; u.state = 'moving_to_attack'; u.waypoints = null; });
        }
    }
}

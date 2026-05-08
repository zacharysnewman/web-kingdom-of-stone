import { STATS, CONSTANTS } from '../constants';
import { Audio } from '../audio';
import type { Entity } from '../entity';
import type { IGameAdapter } from '../core/IGameAdapter';

const CARRY_CAP      = 25;
const MINE_TICK_GOLD = 5;
const MINE_TICK_RATE = 0.5;

export function updateEconomy(
    entities: Entity[],
    gold: number[],
    population: number[],
    maxPop: number[],
    dt: number,
    techs: Set<string>,
    adapter: IGameAdapter,
): void {
    for (const e of entities) {
        if (e.type !== 'unit') continue;

        if (e.state === 'mining') {
            const mine = e.target;
            const carryCapacity = techs.has('mining_efficiency') ? CARRY_CAP * 2 : CARRY_CAP;
            if (!mine || mine.isDead || (mine.goldLeft ?? 0) <= 0 || e.carryGold >= carryCapacity) {
                const tc = entities.find(en => en.team === e.team && en.subType === 'town_center' && !en.isDead);
                if (tc && e.carryGold > 0) { e.target = tc; e.state = 'moving_to_base'; e.waypoints = null; }
                else { e.state = 'idle'; e.target = null; }
            } else if (e.timer <= 0) {
                const harvest = Math.min(MINE_TICK_GOLD, mine.goldLeft ?? 0, carryCapacity - e.carryGold);
                mine.goldLeft = (mine.goldLeft ?? 0) - harvest;
                mine.hp = mine.maxHp * ((mine.goldLeft ?? 0) / (mine.initialGold ?? 1));
                e.carryGold += harvest;
                if ((mine.goldLeft ?? 0) <= 0) { mine.goldLeft = 0; mine.hp = 0; mine.isDead = true; }
                e.timer = MINE_TICK_RATE;
            }
        }

        if (e.state === 'building') {
            if (!e.target || e.target.isDead || !e.target.isConstructing) {
                e.state = 'idle';
            } else if (e.timer <= 0) {
                e.target.hp += 60; e.timer = 0.5;
                if (e.target.hp >= e.target.maxHp) {
                    e.target.hp = e.target.maxHp;
                    e.target.isConstructing = false;
                    e.state = 'idle';
                    if (e.target.team === CONSTANTS.TEAM_PLAYER) Audio.build();
                    adapter.recomputeMaxPop(e.target.team);
                }
            }
        }
    }

    // Training queue: spawn units from completed buildings
    for (const e of entities) {
        if (e.type === 'building' && !e.isConstructing && e.buildQueue.length > 0 && e.timer <= 0) {
            if (population[e.team] < maxPop[e.team]) {
                const unit = e.buildQueue.shift()!;
                adapter.addEntity('unit', unit, e.x, e.y + e.radius + 20, e.team);
                if (e.buildQueue.length > 0)
                    e.timer = STATS[e.buildQueue[0]].buildTime ?? 10;
            }
        }
    }
}

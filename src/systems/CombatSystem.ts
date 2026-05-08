import { STATS } from '../constants';
import { dist } from '../utils';
import { Audio } from '../audio';
import { Projectile } from '../projectile';
import type { Entity } from '../entity';

export function updateCombat(
    entities: Entity[],
    projectiles: Projectile[],
    dt: number,
    techs: Set<string>,
    cameraX: number,
    cameraY: number,
    viewRadius: number,
): Projectile[] {
    // Update projectiles
    for (const p of projectiles) {
        const wasDead = p.isDead;
        p.update(dt);
        if (!wasDead && p.isDead && !p.target.isDead) {
            Audio.hit(Audio.spatialVol(p.x, p.y, cameraX, cameraY, viewRadius));
        }
    }

    // Town center attacks
    for (const e of entities) {
        if (e.subType === 'town_center' && !e.isConstructing && e.timer <= 0) {
            let nearest: Entity | null = null, best = STATS.town_center.range!;
            for (const o of entities) {
                if (o.team !== e.team && o.team !== -1 && !o.isDead) {
                    const d = dist(e.x, e.y, o.x, o.y);
                    if (d < best) { best = d; nearest = o; }
                }
            }
            if (nearest) {
                projectiles.push(new Projectile(e.x, e.y, nearest, STATS.town_center.damage!, e.team));
                e.timer = STATS.town_center.cooldown!;
            }
        }
    }

    // Unit attack state
    for (const e of entities) {
        if (e.type !== 'unit') continue;
        if (e.state !== 'attacking') continue;

        if (!e.target || e.target.isDead) { e.state = 'idle'; e.target = null; continue; }

        const tooFar = dist(e.x, e.y, e.target.x, e.target.y) >
            ((STATS[e.subType].range ?? 0) > 50
                ? (STATS[e.subType].range ?? 0) + e.target.radius + 30
                : e.radius + e.target.radius + 25);

        if (tooFar) {
            if (e.stance === 'aggressive') { e.state = 'moving_to_attack'; e.waypoints = null; }
            else { e.state = 'idle'; e.target = null; }
            continue;
        }

        if (e.timer <= 0) {
            const s = STATS[e.subType];
            const dmg = s.damage! + (e.subType === 'archer' && techs.has('archer_damage') ? 8 : 0);
            if ((s.range ?? 0) > 50) {
                projectiles.push(new Projectile(e.x, e.y, e.target, dmg, e.team));
            } else {
                e.target.damage(dmg, e.team);
                Audio.hit(Audio.spatialVol(e.x, e.y, cameraX, cameraY, viewRadius));
            }
            e.timer = s.cooldown!;
        }
    }

    return projectiles.filter(p => !p.isDead);
}

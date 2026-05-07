import { dist, angle } from './utils';
import type { Entity } from './entity';

export class Projectile {
    x: number;
    y: number;
    readonly target: Entity;
    readonly damage: number;
    readonly team: number;
    readonly speed = 400;
    isDead: boolean;

    constructor(x: number, y: number, target: Entity, damage: number, team: number) {
        this.x = x;
        this.y = y;
        this.target = target;
        this.damage = damage;
        this.team = team;
        this.isDead = false;
    }

    update(dt: number): void {
        if (!this.target || this.target.isDead) { this.isDead = true; return; }
        const d = dist(this.x, this.y, this.target.x, this.target.y);
        if (d < this.target.radius + 10) {
            this.target.damage(this.damage, this.team);
            this.isDead = true;
            return;
        }
        const a = angle(this.x, this.y, this.target.x, this.target.y);
        this.x += Math.cos(a) * this.speed * dt;
        this.y += Math.sin(a) * this.speed * dt;
    }

}

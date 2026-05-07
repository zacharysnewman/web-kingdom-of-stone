import { STATS, TEAM_COLORS, TEAM_UNIT_COLORS } from './constants';
import type { SubType } from './constants';
import type { EntityType, EntityState, IGameContext, Point } from './types';

export class Entity {
    readonly id: number;
    readonly type: EntityType;
    readonly subType: SubType;
    x: number;
    y: number;
    readonly team: number;
    hp: number;
    readonly maxHp: number;
    readonly radius: number;
    color: string;
    goldLeft?: number;
    readonly initialGold?: number;
    state: EntityState;
    target: Entity | null;
    targetX: number | null;
    targetY: number | null;
    timer: number;
    isDead: boolean;
    buildQueue: SubType[];
    isConstructing: boolean;
    velX: number;
    velY: number;
    waypoints: Point[] | null;
    pathTimer?: number;

    constructor(
        private readonly ctx: IGameContext,
        id: number,
        type: EntityType,
        subType: SubType,
        x: number,
        y: number,
        team: number
    ) {
        this.id = id;
        this.type = type;
        this.subType = subType;
        this.x = x;
        this.y = y;
        this.team = team;
        const s = STATS[subType];
        this.hp = s.hp;
        this.maxHp = s.hp;
        this.radius = s.radius;
        if (type === 'resource') {
            this.color = s.color ?? '#d97706';
            this.goldLeft = s.goldValue;
            this.initialGold = s.goldValue;
        } else {
            this.color = type === 'unit' ? TEAM_UNIT_COLORS[team] : TEAM_COLORS[team];
        }
        this.state = 'idle';
        this.target = null;
        this.targetX = null;
        this.targetY = null;
        this.timer = 0;
        this.isDead = false;
        this.buildQueue = [];
        this.isConstructing = false;
        this.velX = 0;
        this.velY = 0;
        this.waypoints = null;
    }

    damage(amount: number, attackerTeam: number): void {
        if (this.type === 'resource' && this.goldLeft !== undefined && this.goldLeft > 0) {
            const earned = Math.min(this.goldLeft, amount * ((this.initialGold ?? 0) / this.maxHp));
            this.goldLeft -= earned;
            this.ctx.addGold(attackerTeam, earned);
            if (attackerTeam === this.ctx.TEAM_PLAYER && earned >= 1)
                this.ctx.createFloatingText(`+${Math.floor(earned)}`, this.x, this.y - 20, '#fbbf24');
        }
        this.hp -= amount;
        if (this.hp <= 0) { this.hp = 0; this.isDead = true; }
    }
}

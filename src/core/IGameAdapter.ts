import type { Entity } from '../entity';
import type { SubType } from '../constants';
import type { IGameContext } from '../types';

export interface IGameAdapter extends IGameContext {
    addEntity(type: Entity['type'], subType: SubType, x: number, y: number, team: number): Entity;
    notify(msg: string, color?: string): void;
    recomputeMaxPop(team: number): void;
    rebuildNavGrid(): void;
    trainUnit(building: Entity, type: SubType): boolean;
}

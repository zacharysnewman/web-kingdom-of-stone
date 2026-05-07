declare module 'pathfinding' {
    export enum DiagonalMovement {
        Always = 1,
        Never = 2,
        OnlyWhenNoObstacles = 3,
        IfAtMostOneObstacle = 4,
    }

    export class Grid {
        constructor(width: number, height: number);
        setWalkableAt(x: number, y: number, walkable: boolean): void;
        isWalkableAt(x: number, y: number): boolean;
        clone(): Grid;
    }

    export class AStarFinder {
        constructor(options?: { diagonalMovement?: DiagonalMovement });
        findPath(startX: number, startY: number, endX: number, endY: number, grid: Grid): [number, number][];
    }
}

import * as PIXI from 'pixi.js';
import { CONSTANTS, STATS, TEAM_COLORS, UNIT_SPRITES } from '../constants';
import type { SubType } from '../constants';
import type { Entity } from '../entity';
import type { Projectile } from '../projectile';
import type { Effect, FloatingText, DragSelect } from '../types';
import { Camera } from './Camera';
import { FogManager, FOG_CELL, FOG_ALPHA } from '../map/FogManager';

function hexColor(css: string): number {
    return parseInt(css.replace('#', ''), 16);
}

export class Renderer {
    worldContainer!: PIXI.Container;
    entityLayer!: PIXI.Container;
    textLayer!: PIXI.Container;

    private gridGfx!: PIXI.Graphics;
    private stoneGfx!: PIXI.Graphics;
    private projectileGfx!: PIXI.Graphics;
    private effectGfx!: PIXI.Graphics;
    private fogGfx!: PIXI.Graphics;
    private ghostGfx!: PIXI.Graphics;
    private dragGfx!: PIXI.Graphics;

    private entityDisplays = new Map<number, PIXI.Container>();
    private textDisplays   = new Map<FloatingText, PIXI.Text>();

    buildSceneGraph(stage: PIXI.Container): void {
        this.worldContainer  = new PIXI.Container();
        this.gridGfx         = new PIXI.Graphics();
        this.stoneGfx        = new PIXI.Graphics();
        this.entityLayer     = new PIXI.Container();
        this.projectileGfx   = new PIXI.Graphics();
        this.effectGfx       = new PIXI.Graphics();
        this.textLayer       = new PIXI.Container();
        this.fogGfx          = new PIXI.Graphics();
        this.ghostGfx        = new PIXI.Graphics();
        this.dragGfx         = new PIXI.Graphics();

        this.worldContainer.addChild(
            this.gridGfx,
            this.stoneGfx,
            this.entityLayer,
            this.projectileGfx,
            this.effectGfx,
            this.textLayer,
            this.fogGfx,
            this.ghostGfx,
            this.dragGfx,
        );
        stage.addChild(this.worldContainer);
        this.drawGrid();
    }

    drawGrid(): void {
        const g  = this.gridGfx;
        g.clear();
        const MS = CONSTANTS.MAP_SIZE;

        for (let i = 0; i <= MS; i += 20) {
            g.moveTo(i, 0).lineTo(i, MS);
            g.moveTo(0, i).lineTo(MS, i);
        }
        g.stroke({ color: 0xffffff, alpha: 0.04, width: 1 });

        for (let i = 0; i <= MS; i += 200) {
            g.moveTo(i, 0).lineTo(i, MS);
            g.moveTo(0, i).lineTo(MS, i);
        }
        g.stroke({ color: 0xffffff, alpha: 0.12, width: 1 });

        g.rect(0, 0, MS, MS).stroke({ color: 0x334155, width: 5 });
    }

    drawStone(stoneGrid: boolean[][], mapCellSize: number): void {
        const g   = this.stoneGfx;
        const C   = mapCellSize;
        const pad = 3;
        g.clear();
        for (let cy = 0; cy < stoneGrid.length; cy++)
            for (let cx = 0; cx < stoneGrid[cy].length; cx++)
                if (stoneGrid[cy][cx])
                    g.roundRect(cx * C + pad, cy * C + pad, C - pad * 2, C - pad * 2, 5)
                     .fill({ color: 0x374151 })
                     .stroke({ color: 0x4b5563, width: 1.5 });
    }

    createEntityDisplay(e: Entity): void {
        const container = new PIXI.Container();
        container.label = `entity_${e.id}`;

        const ring = new PIXI.Graphics();
        ring.label = 'ring';
        ring.visible = false;

        const shape = new PIXI.Graphics();
        shape.label = 'shape';

        container.addChild(ring, shape);

        const spriteConfig = e.type === 'unit' ? UNIT_SPRITES[e.subType] : undefined;
        if (spriteConfig) {
            const baseTex = PIXI.Assets.get<PIXI.Texture>(spriteConfig.file);
            if (baseTex) {
                const frames = Array.from({ length: spriteConfig.frameCount }, (_, col) =>
                    new PIXI.Texture({
                        source: baseTex.source,
                        frame: new PIXI.Rectangle(
                            col * spriteConfig.frameW,
                            spriteConfig.row * spriteConfig.frameH,
                            spriteConfig.frameW,
                            spriteConfig.frameH,
                        ),
                    })
                );
                const anim = new PIXI.AnimatedSprite(frames);
                anim.label = 'sprite';
                anim.anchor.set(0.5, 0.5);
                anim.scale.set(spriteConfig.scale);
                anim.animationSpeed = 0.12;
                anim.play();
                container.addChild(anim);
            }
        }

        const hpBar = new PIXI.Graphics();
        hpBar.label = 'hp';
        hpBar.visible = false;
        container.addChild(hpBar);

        if (e.type === 'resource') {
            const label = new PIXI.Text({ text: '', style: { fill: '#ffffff', fontSize: 12, fontFamily: 'sans-serif', fontWeight: 'bold', align: 'center' } });
            label.label = 'goldLabel';
            label.anchor.set(0.5, 0.5);
            container.addChild(label);
        }

        this.entityLayer.addChild(container);
        this.entityDisplays.set(e.id, container);
    }

    removeEntityDisplay(id: number): void {
        const disp = this.entityDisplays.get(id);
        if (disp) { this.entityLayer.removeChild(disp); this.entityDisplays.delete(id); }
    }

    clearEntityDisplays(): void {
        this.entityLayer.removeChildren();
        this.entityDisplays.clear();
    }

    clearTextDisplays(): void {
        this.textLayer.removeChildren();
        this.textDisplays.clear();
    }

    clearStone(): void {
        this.stoneGfx.clear();
    }

    clearFog(): void {
        this.fogGfx.clear();
    }

    addFloatingText(ft: FloatingText): void {
        const t = new PIXI.Text({ text: ft.text, style: { fill: ft.color, fontSize: 16, fontFamily: 'sans-serif', fontWeight: 'bold' } });
        t.anchor.set(0.5, 1);
        t.position.set(ft.x, ft.y);
        this.textLayer.addChild(t);
        this.textDisplays.set(ft, t);
    }

    tickFloatingTexts(floatingTexts: FloatingText[]): void {
        for (const ft of floatingTexts) {
            const t = this.textDisplays.get(ft);
            if (t) { t.position.y = ft.y; t.alpha = ft.alpha; }
            if (ft.isDead) {
                if (t) { this.textLayer.removeChild(t); this.textDisplays.delete(ft); }
            }
        }
    }

    applyCamera(camera: Camera, canvasWidth: number, canvasHeight: number): void {
        camera.apply(this.worldContainer, canvasWidth, canvasHeight);
    }

    draw(
        entities: Entity[],
        projectiles: Projectile[],
        effects: Effect[],
        selectedIds: Set<number>,
        dragSelect: DragSelect | null,
        placementMode: SubType | null,
        mouseScreenX: number,
        mouseScreenY: number,
        camera: Camera,
        canvasWidth: number,
        canvasHeight: number,
        fogManager: FogManager,
        isBlocked: (wx: number, wy: number, type: SubType) => boolean,
    ): void {
        this.applyCamera(camera, canvasWidth, canvasHeight);
        this._drawEntities(entities, selectedIds);
        this._drawProjectiles(projectiles);
        this._drawEffects(effects);
        this._drawGhost(placementMode, mouseScreenX, mouseScreenY, camera, canvasWidth, canvasHeight, isBlocked);
        this._drawDragSelect(dragSelect);
        this._redrawFog(fogManager);
    }

    private _drawEntities(entities: Entity[], selectedIds: Set<number>): void {
        const sorted = [...entities].sort((a, b) => a.y - b.y);
        for (let i = 0; i < sorted.length; i++) {
            const disp = this.entityDisplays.get(sorted[i].id);
            if (disp) this.entityLayer.setChildIndex(disp, Math.min(i, this.entityLayer.children.length - 1));
        }

        for (const e of entities) {
            const container = this.entityDisplays.get(e.id);
            if (!container) continue;
            container.position.set(e.x, e.y);

            const shape  = container.getChildByLabel('shape')  as PIXI.Graphics;
            const ring   = container.getChildByLabel('ring')   as PIXI.Graphics;
            const hpBar  = container.getChildByLabel('hp')     as PIXI.Graphics;

            const color  = hexColor(e.color);
            const border = e.team === -1 ? 0xfbbf24 : hexColor(TEAM_COLORS[e.team] ?? '#ffffff');
            const r      = e.radius;

            shape.clear();
            shape.alpha = e.isConstructing ? 0.5 : 1;
            const sc = UNIT_SPRITES[e.subType];
            const footY = sc ? sc.frameH * sc.scale * 0.38 : r * 0.35;

            if (e.type === 'building' || e.type === 'resource') {
                shape.roundRect(-r, -r, r * 2, r * 2, 8)
                     .fill({ color })
                     .stroke({ color: border, width: 3 });
            } else if (sc) {
                const fw = sc.frameW * sc.scale * 0.3;
                shape.ellipse(0, footY, fw, fw * 0.4).fill({ color: border, alpha: 0.5 });
            } else {
                shape.circle(0, 0, r)
                     .fill({ color })
                     .stroke({ color: border, width: 3 });
            }

            if (e.type === 'resource') {
                const lbl = container.getChildByLabel('goldLabel') as PIXI.Text | undefined;
                if (lbl) lbl.text = `${Math.floor(e.goldLeft ?? 0)}G`;
            }

            const selected = selectedIds.has(e.id);
            ring.visible = selected;
            if (selected) {
                const ringR = sc ? sc.frameW * sc.scale * 0.5 : r * 1.3;
                const ringY = sc ? footY : r * 0.3;
                ring.clear();
                ring.ellipse(0, ringY, ringR, ringR * 0.35)
                    .stroke({ color: 0x4ade80, width: 3 });
            }

            const showHp = e.hp < e.maxHp || selected || e.isConstructing;
            hpBar.visible = showHp;
            if (showHp) {
                const w      = sc ? sc.frameW * sc.scale : r * 2;
                const hpBarY = sc ? -(sc.frameH * sc.scale / 2) - 6 : -r - 12;
                const barColor = e.isConstructing ? 0xfbbf24
                               : e.type === 'resource' ? 0xfbbf24
                               : hexColor(TEAM_COLORS[e.team] ?? '#ffffff');
                hpBar.clear();
                hpBar.rect(-w / 2, hpBarY, w, 4).fill({ color: 0x000000, alpha: 0.5 });
                hpBar.rect(-w / 2, hpBarY, w * (e.hp / e.maxHp), 4).fill({ color: barColor });
            }
        }
    }

    private _drawProjectiles(projectiles: Projectile[]): void {
        const g = this.projectileGfx;
        g.clear();
        for (const p of projectiles)
            g.circle(p.x, p.y, 4).fill({ color: hexColor(TEAM_COLORS[p.team] ?? '#ffffff') });
    }

    private _drawEffects(effects: Effect[]): void {
        const g = this.effectGfx;
        g.clear();
        for (const ef of effects)
            g.circle(ef.x, ef.y, ef.radius)
             .stroke({ color: hexColor(ef.color), alpha: ef.alpha, width: 2 });
    }

    private _drawGhost(
        placementMode: SubType | null,
        mouseScreenX: number,
        mouseScreenY: number,
        camera: Camera,
        canvasWidth: number,
        canvasHeight: number,
        isBlocked: (wx: number, wy: number, type: SubType) => boolean,
    ): void {
        const g = this.ghostGfx;
        g.clear();
        if (!placementMode) return;
        const wp = camera.screenToWorld(mouseScreenX, mouseScreenY, canvasWidth, canvasHeight);
        const gx = Math.round(wp.x / 20) * 20, gy = Math.round(wp.y / 20) * 20;
        const r  = STATS[placementMode].radius;
        const blocked = isBlocked(gx, gy, placementMode);
        const color   = blocked ? 0xef4444 : 0x4ade80;
        g.roundRect(gx - r, gy - r, r * 2, r * 2, 8)
         .fill({ color, alpha: 0.4 })
         .stroke({ color, width: 2 });
    }

    private _drawDragSelect(dragSelect: DragSelect | null): void {
        const g = this.dragGfx;
        g.clear();
        if (!dragSelect?.active) return;
        const { startX: bx, startY: by, currentX, currentY } = dragSelect;
        g.rect(bx, by, currentX - bx, currentY - by)
         .fill({ color: 0x3b82f6, alpha: 0.15 })
         .stroke({ color: 0x60a5fa, width: 1 });
    }

    private _redrawFog(fog: FogManager): void {
        if (!fog.fogDirty) return;
        fog.fogDirty = false;
        const g = this.fogGfx;
        g.clear();
        for (let cy = 0; cy < fog.fogRows; cy++)
            for (let cx = 0; cx < fog.fogCols; cx++)
                if (!fog.fogGrid[cy][cx])
                    g.rect(cx * FOG_CELL, cy * FOG_CELL, FOG_CELL, FOG_CELL)
                     .fill({ color: 0x000000, alpha: FOG_ALPHA });
    }
}

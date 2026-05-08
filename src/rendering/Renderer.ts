import * as PIXI from "pixi.js";
import { CONSTANTS, ISO, STATS, TEAM_COLORS, UNIT_SPRITES } from "../constants";
import type { SubType } from "../constants";
import type { Entity } from "../entity";
import type { Projectile } from "../projectile";
import type { Effect, FloatingText, DragSelect } from "../types";
import { Camera } from "./Camera";
import { FogManager, FOG_CELL, FOG_ALPHA } from "../map/FogManager";
import { worldToIso } from "../utils";

function hexColor(css: string): number {
  return parseInt(css.replace("#", ""), 16);
}

export class Renderer {
  worldContainer!: PIXI.Container;
  entityLayer!: PIXI.Container;
  textLayer!: PIXI.Container;

  private tileContainer!: PIXI.Container;
  private projectileGfx!: PIXI.Graphics;
  private effectGfx!: PIXI.Graphics;
  private fogGfx!: PIXI.Graphics;
  private ghostGfx!: PIXI.Graphics;
  private dragGfx!: PIXI.Graphics;

  private entityDisplays = new Map<number, PIXI.Container>();
  private textDisplays = new Map<FloatingText, PIXI.Text>();

  buildSceneGraph(stage: PIXI.Container): void {
    this.worldContainer = new PIXI.Container();
    this.tileContainer = new PIXI.Container();
    this.entityLayer = new PIXI.Container();
    this.projectileGfx = new PIXI.Graphics();
    this.effectGfx = new PIXI.Graphics();
    this.textLayer = new PIXI.Container();
    this.fogGfx = new PIXI.Graphics();
    this.ghostGfx = new PIXI.Graphics();
    this.dragGfx = new PIXI.Graphics();

    this.worldContainer.addChild(
      this.tileContainer,
      this.entityLayer,
      this.projectileGfx,
      this.effectGfx,
      this.textLayer,
      this.fogGfx,
      this.ghostGfx,
      this.dragGfx,
    );
    stage.addChild(this.worldContainer);
  }

  buildTileLayer(stoneGrid: boolean[][], mapCellSize: number): void {
    this.tileContainer.removeChildren();

    const MAP_TILES = Math.round(CONSTANTS.MAP_SIZE / ISO.CELL); // 75

    // Render in diagonal order (depth = col + row, ascending) for correct painter's order
    for (let depth = 0; depth <= (MAP_TILES - 1) * 2; depth++) {
      const colStart = Math.max(0, depth - (MAP_TILES - 1));
      const colEnd = Math.min(depth, MAP_TILES - 1);
      for (let col = colStart; col <= colEnd; col++) {
        const row = depth - col;
        if (row < 0 || row >= MAP_TILES) continue;

        const wx = col * ISO.CELL;
        const wy = row * ISO.CELL;

        const stoneCx = Math.floor(wx / mapCellSize);
        const stoneCy = Math.floor(wy / mapCellSize);
        const isStone = stoneGrid[stoneCy]?.[stoneCx] ?? false;

        const variant = (col * 5 + row * 11) % 4;
        const tileIndex = isStone ? 40 + variant : 16 + variant;
        const tileUrl = `tiles/tile_${String(tileIndex).padStart(3, "0")}.png`;
        const tex = PIXI.Assets.get<PIXI.Texture>(tileUrl);
        if (!tex) continue;

        const sprite = new PIXI.Sprite(tex);
        sprite.anchor.set(0.5, 0);
        const iso = worldToIso(wx, wy);
        sprite.position.set(iso.x, iso.y + (isStone ? -10 : 0));
        this.tileContainer.addChild(sprite);
      }
    }
  }

  clearTileLayer(): void {
    this.tileContainer.removeChildren();
  }

  createEntityDisplay(e: Entity): void {
    const container = new PIXI.Container();
    container.label = `entity_${e.id}`;

    const ring = new PIXI.Graphics();
    ring.label = "ring";
    ring.visible = false;

    const shape = new PIXI.Graphics();
    shape.label = "shape";

    container.addChild(ring, shape);

    const spriteConfig =
      e.type === "unit" ? UNIT_SPRITES[e.subType] : undefined;
    if (spriteConfig) {
      const baseTex = PIXI.Assets.get<PIXI.Texture>(spriteConfig.file);
      if (baseTex) {
        const frames = Array.from(
          { length: spriteConfig.frameCount },
          (_, col) =>
            new PIXI.Texture({
              source: baseTex.source,
              frame: new PIXI.Rectangle(
                col * spriteConfig.frameW,
                spriteConfig.row * spriteConfig.frameH,
                spriteConfig.frameW,
                spriteConfig.frameH,
              ),
            }),
        );
        const anim = new PIXI.AnimatedSprite(frames);
        anim.label = "sprite";
        anim.anchor.set(0.5, 1);
        anim.scale.set(spriteConfig.scale);
        anim.animationSpeed = 0.12;
        anim.play();
        container.addChild(anim);
      }
    }

    const hpBar = new PIXI.Graphics();
    hpBar.label = "hp";
    hpBar.visible = false;
    container.addChild(hpBar);

    if (e.type === "resource") {
      const label = new PIXI.Text({
        text: "",
        style: {
          fill: "#ffffff",
          fontSize: 12,
          fontFamily: "sans-serif",
          fontWeight: "bold",
          align: "center",
        },
      });
      label.label = "goldLabel";
      label.anchor.set(0.5, 0.5);
      container.addChild(label);
    }

    this.entityLayer.addChild(container);
    this.entityDisplays.set(e.id, container);
  }

  removeEntityDisplay(id: number): void {
    const disp = this.entityDisplays.get(id);
    if (disp) {
      this.entityLayer.removeChild(disp);
      this.entityDisplays.delete(id);
    }
  }

  clearEntityDisplays(): void {
    this.entityLayer.removeChildren();
    this.entityDisplays.clear();
  }

  clearTextDisplays(): void {
    this.textLayer.removeChildren();
    this.textDisplays.clear();
  }

  clearFog(): void {
    this.fogGfx.clear();
  }

  addFloatingText(ft: FloatingText): void {
    const t = new PIXI.Text({
      text: ft.text,
      style: {
        fill: ft.color,
        fontSize: 16,
        fontFamily: "sans-serif",
        fontWeight: "bold",
      },
    });
    t.anchor.set(0.5, 1);
    t.position.set(ft.x, ft.y);
    this.textLayer.addChild(t);
    this.textDisplays.set(ft, t);
  }

  tickFloatingTexts(floatingTexts: FloatingText[]): void {
    for (const ft of floatingTexts) {
      const t = this.textDisplays.get(ft);
      if (t) {
        t.position.y = ft.y;
        t.alpha = ft.alpha;
      }
      if (ft.isDead) {
        if (t) {
          this.textLayer.removeChild(t);
          this.textDisplays.delete(ft);
        }
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
    this._drawGhost(
      placementMode,
      mouseScreenX,
      mouseScreenY,
      camera,
      canvasWidth,
      canvasHeight,
      isBlocked,
    );
    this._drawDragSelect(dragSelect);
    this._redrawFog(fogManager);
  }

  private _drawEntities(entities: Entity[], selectedIds: Set<number>): void {
    // Sort by iso depth (x + y in world space = proportional to iso y)
    const sorted = [...entities].sort((a, b) => a.x + a.y - (b.x + b.y));
    for (let i = 0; i < sorted.length; i++) {
      const disp = this.entityDisplays.get(sorted[i].id);
      if (disp)
        this.entityLayer.setChildIndex(
          disp,
          Math.min(i, this.entityLayer.children.length - 1),
        );
    }

    for (const e of entities) {
      const container = this.entityDisplays.get(e.id);
      if (!container) continue;

      const iso = worldToIso(e.x, e.y);
      container.position.set(iso.x, iso.y);

      const shape = container.getChildByLabel("shape") as PIXI.Graphics;
      const ring = container.getChildByLabel("ring") as PIXI.Graphics;
      const hpBar = container.getChildByLabel("hp") as PIXI.Graphics;

      const color = hexColor(e.color);
      const border =
        e.team === -1 ? 0xfbbf24 : hexColor(TEAM_COLORS[e.team] ?? "#ffffff");
      const r = e.radius;

      shape.clear();
      shape.alpha = e.isConstructing ? 0.5 : 1;
      const sc = UNIT_SPRITES[e.subType];
      const footY = sc ? sc.frameH * sc.scale * 0.38 : r * 0.35;

      if (e.type === "building" || e.type === "resource") {
        // Iso diamond projected from world square footprint
        const dx = r * 2 * ISO.SX;
        const dy = r * 2 * ISO.SY;
        shape
          .poly([0, -dy, dx, 0, 0, dy, -dx, 0])
          .fill({ color })
          .stroke({ color: border, width: 3 });
      } else if (sc) {
        const fw = sc.frameW * sc.scale * 0.3;
        // Team drop shadow ellipse under unit feet
        shape.ellipse(0, 0, fw, fw * 0.4).fill({ color: border, alpha: 0.5 });
      } else {
        shape
          .circle(0, 0, r)
          .fill({ color })
          .stroke({ color: border, width: 3 });
      }

      if (e.type === "resource") {
        const lbl = container.getChildByLabel("goldLabel") as
          | PIXI.Text
          | undefined;
        if (lbl) lbl.text = `${Math.floor(e.goldLeft ?? 0)}G`;
      }

      const selected = selectedIds.has(e.id);
      ring.visible = selected;
      if (selected) {
        const ringR = sc ? sc.frameW * sc.scale * 0.5 : r * 1.3;
        const ringY = 0;
        ring.clear();
        ring
          .ellipse(0, ringY, ringR, ringR * 0.35)
          .stroke({ color: 0x4ade80, width: 3 });
      }

      const showHp = e.hp < e.maxHp || selected || e.isConstructing;
      hpBar.visible = showHp;
      if (showHp) {
        const w = sc ? sc.frameW * sc.scale : r * 2 * ISO.SX * 2;
        const hpBarY = sc
          ? -((sc.frameH * sc.scale) / 2) - 6
          : -r * 2 * ISO.SY - 8;
        const barColor = e.isConstructing
          ? 0xfbbf24
          : e.type === "resource"
            ? 0xfbbf24
            : hexColor(TEAM_COLORS[e.team] ?? "#ffffff");
        hpBar.clear();
        hpBar.rect(-w / 2, hpBarY, w, 4).fill({ color: 0x000000, alpha: 0.5 });
        hpBar
          .rect(-w / 2, hpBarY, w * (e.hp / e.maxHp), 4)
          .fill({ color: barColor });
      }
    }
  }

  private _drawProjectiles(projectiles: Projectile[]): void {
    const g = this.projectileGfx;
    g.clear();
    for (const p of projectiles) {
      const iso = worldToIso(p.x, p.y);
      g.circle(iso.x, iso.y, 4).fill({
        color: hexColor(TEAM_COLORS[p.team] ?? "#ffffff"),
      });
    }
  }

  private _drawEffects(effects: Effect[]): void {
    const g = this.effectGfx;
    g.clear();
    for (const ef of effects) {
      const iso = worldToIso(ef.x, ef.y);
      g.ellipse(iso.x, iso.y, ef.radius * ISO.SX, ef.radius * ISO.SY).stroke({
        color: hexColor(ef.color),
        alpha: ef.alpha,
        width: 2,
      });
    }
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
    const wp = camera.screenToWorld(
      mouseScreenX,
      mouseScreenY,
      canvasWidth,
      canvasHeight,
    );
    const gx = Math.round(wp.x / 20) * 20,
      gy = Math.round(wp.y / 20) * 20;
    const r = STATS[placementMode].radius;
    const blocked = isBlocked(gx, gy, placementMode);
    const color = blocked ? 0xef4444 : 0x4ade80;
    const iso = worldToIso(gx, gy);
    const dx = r * 2 * ISO.SX;
    const dy = r * 2 * ISO.SY;
    g.poly([
      iso.x,
      iso.y - dy,
      iso.x + dx,
      iso.y,
      iso.x,
      iso.y + dy,
      iso.x - dx,
      iso.y,
    ])
      .fill({ color, alpha: 0.4 })
      .stroke({ color, width: 2 });
  }

  private _drawDragSelect(dragSelect: DragSelect | null): void {
    const g = this.dragGfx;
    g.clear();
    if (!dragSelect?.active) return;

    // --- 1. VISUAL SCREEN BOX (The Blue Box) ---
    // This aligns with your mouse cursor on the screen.
    const tl = this.worldContainer.toLocal({
      x: dragSelect.startSx,
      y: dragSelect.startSy,
    });
    const br = this.worldContainer.toLocal({
      x: dragSelect.currentSx,
      y: dragSelect.currentSy,
    });

    // Normalize to handle dragging in any direction
    const rx = Math.min(tl.x, br.x);
    const ry = Math.min(tl.y, br.y);
    const rw = Math.abs(br.x - tl.x);
    const rh = Math.abs(br.y - tl.y);

    g.rect(rx, ry, rw, rh)
      .fill({ color: 0x3b82f6, alpha: 0.15 }) // Light blue fill
      .stroke({ color: 0x60a5fa, width: 1 });
  }

  private _redrawFog(fog: FogManager): void {
    if (!fog.fogDirty) return;
    fog.fogDirty = false;
    const g = this.fogGfx;
    const fc = FOG_CELL;
    g.clear();
    for (let cy = 0; cy < fog.fogRows; cy++) {
      for (let cx = 0; cx < fog.fogCols; cx++) {
        if (fog.fogGrid[cy][cx]) continue;
        const wx0 = cx * fc;
        const wy0 = cy * fc;

        const p00 = worldToIso(wx0, wy0);
        const p10 = worldToIso(wx0 + fc, wy0);
        const p11 = worldToIso(wx0 + fc, wy0 + fc);
        const p01 = worldToIso(wx0, wy0 + fc);
        g.poly([p00.x, p00.y, p10.x, p10.y, p11.x, p11.y, p01.x, p01.y]).fill({
          color: 0x000000,
          alpha: FOG_ALPHA,
        });
      }
    }
  }
}

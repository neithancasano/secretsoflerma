(function () {
  const ISO_W = 48;
  const ISO_H = 24;

  // Tile colors — swap these for real sprites later, map data never changes!
  const TILE_COLORS = {
    0: { fill: 0x2d5a1b, stroke: 0x245016 }, // Grass
    1: { fill: 0x8B6914, stroke: 0x7a5c10 }, // Dirt path
    2: { fill: 0x1a3a6e, stroke: 0x152e58 }, // Water
    3: { fill: 0x555566, stroke: 0x444455 }, // Stone / building
  };

  const STATE = {
    you: null,
    map: { w: 60, h: 40, tiles: null },
    players: new Map(),
    origin: { x: 0, y: 0 }
  };

  let lastSaveAt = 0;
  function maybeSavePos(x, y) {
    const now = Date.now();
    if (now - lastSaveAt < 2000) return;
    lastSaveAt = now;
    if (window.LERMA_SAVE_POS) window.LERMA_SAVE_POS(x, y);
  }

  function tileToScreen(tx, ty) {
    const x = (tx - ty) * (ISO_W / 2) + STATE.origin.x;
    const y = (tx + ty) * (ISO_H / 2) + STATE.origin.y;
    return { x, y };
  }

  function screenToTile(sx, sy) {
    const x = sx - STATE.origin.x;
    const y = sy - STATE.origin.y;
    const tx = (y / (ISO_H / 2) + x / (ISO_W / 2)) / 2;
    const ty = (y / (ISO_H / 2) - x / (ISO_W / 2)) / 2;
    return { tx, ty };
  }

  function clampTile(tx, ty) {
    tx = Math.max(0, Math.min(STATE.map.w - 1, tx));
    ty = Math.max(0, Math.min(STATE.map.h - 1, ty));
    return { tx, ty };
  }

  function getTile(x, y) {
    if (!STATE.map.tiles) return 0;
    return STATE.map.tiles[y * STATE.map.w + x] ?? 0;
  }

  function upsertPlayer(scene, id, tx, ty, name) {
    let p = STATE.players.get(id);
    if (!p) {
      const base  = scene.add.ellipse(0, 0, 18, 10, 0x7dd3fc).setOrigin(0.5, 0.5);
      const body  = scene.add.rectangle(0, 0, 10, 16, 0x7dd3fc).setOrigin(0.5, 1);
      const label = scene.add.text(0, -24, name || id, {
        fontSize: '11px', fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0', stroke: '#0b1020', strokeThickness: 3, resolution: 2
      }).setOrigin(0.5, 1);
      const container = scene.add.container(0, 0, [body, base, label]);
      p = { id, tx, ty, rx: tx, ry: ty, sprite: container, label };
      STATE.players.set(id, p);
    } else if (name && p.label) {
      p.label.setText(name);
    }
    p.tx = tx;
    p.ty = ty;
  }

  function removePlayer(id) {
    const p = STATE.players.get(id);
    if (!p) return;
    p.sprite.destroy();
    STATE.players.delete(id);
  }

  function setPlayerVisual(p) {
    const isYou  = (p.id === STATE.you);
    const color  = isYou ? 0xa3e635 : 0x7dd3fc;
    p.sprite.list[0].fillColor = color;
    p.sprite.list[1].fillColor = color;
    if (p.label) p.label.setColor(isYou ? '#a3e635' : '#e2e8f0');
  }

  function setDepth(p) {
    p.sprite.setDepth((p.ty + p.tx) * 10 + 5);
  }

  class MainScene extends Phaser.Scene {
    constructor() { super("main"); }

    create() {
      this.cameras.main.setBackgroundColor("#0b1020");
      this.scale.resize(window.innerWidth, window.innerHeight);
      window.addEventListener("resize", () => {
        this.scale.resize(window.innerWidth, window.innerHeight);
        this.recomputeOrigin();
        this.drawTileMap();
      });

      this.tileGraphics = this.add.graphics();
      this.recomputeOrigin();

      this.net = window.LERMA_NET.connect((msg) => this.onNet(msg));

      this.input.on("pointerdown", (pointer) => {
        // Account for camera scroll when converting click to world coords
        const cam   = this.cameras.main;
        const worldX = pointer.x + cam.scrollX;
        const worldY = pointer.y + cam.scrollY;
        const { tx, ty } = screenToTile(worldX, worldY);
        const c = clampTile(Math.floor(tx), Math.floor(ty));
        this.net.send({ t: "MOVE_TO", seq: (Date.now() % 1000000), x: c.tx, y: c.ty });
      });
    }

    recomputeOrigin() {
      const mapHpx = (STATE.map.w + STATE.map.h) * (ISO_H / 2);
      STATE.origin.x = Math.floor(window.innerWidth / 2);
      STATE.origin.y = Math.floor((window.innerHeight - mapHpx) / 2) + 60;
    }

    drawTileMap() {
      const g = this.tileGraphics;
      g.clear();
      for (let y = 0; y < STATE.map.h; y++) {
        for (let x = 0; x < STATE.map.w; x++) {
          const tileType = getTile(x, y);
          const colors   = TILE_COLORS[tileType] || TILE_COLORS[0];
          const c        = tileToScreen(x, y);
          const top    = { x: c.x,             y: c.y - ISO_H / 2 };
          const right  = { x: c.x + ISO_W / 2, y: c.y };
          const bottom = { x: c.x,             y: c.y + ISO_H / 2 };
          const left   = { x: c.x - ISO_W / 2, y: c.y };
          g.fillStyle(colors.fill, 1);
          g.fillPoints([top, right, bottom, left], true);
          g.lineStyle(1, colors.stroke, 0.6);
          g.strokePoints([top, right, bottom, left, top], false);
        }
      }
    }

    onNet(msg) {
      if (msg.t === "WELCOME") {
        STATE.map.w = msg.map.w;
        STATE.map.h = msg.map.h;
        this.recomputeOrigin();
        // Fetch tile data
        fetch('/secretsoflerma/map.json')
          .then(r => r.json())
          .then(data => {
            STATE.map.tiles = data.tiles;
            this.drawTileMap();
          })
          .catch(() => this.drawTileMap());
        return;
      }

      if (msg.t === "SNAPSHOT") {
        STATE.you = msg.you;
        for (const id of Array.from(STATE.players.keys())) removePlayer(id);
        for (const pl of msg.players) upsertPlayer(this, pl.id, pl.x, pl.y, pl.name);
        for (const p of STATE.players.values()) { setPlayerVisual(p); setDepth(p); }
        const me = msg.players.find(pl => pl.id === STATE.you);
        if (me) maybeSavePos(me.x, me.y);
        return;
      }

      if (msg.t === "DELTA") {
        if (Array.isArray(msg.rm)) for (const id of msg.rm) removePlayer(id);
        if (Array.isArray(msg.up)) {
          for (const u of msg.up) {
            upsertPlayer(this, u.id, u.x, u.y, u.name);
            if (u.id === STATE.you) maybeSavePos(u.x, u.y);
          }
        }
        for (const p of STATE.players.values()) { setPlayerVisual(p); setDepth(p); }
        return;
      }
    }

    update(_, dtMs) {
      const dt     = dtMs / 1000;
      const FOLLOW = 16;
      for (const p of STATE.players.values()) {
        p.rx += (p.tx - p.rx) * Math.min(1, FOLLOW * dt);
        p.ry += (p.ty - p.ry) * Math.min(1, FOLLOW * dt);
        const s = tileToScreen(p.rx, p.ry);
        p.sprite.x = s.x;
        p.sprite.y = s.y - 6;
        setDepth(p);
      }

      // Camera follows YOUR character
      const me = STATE.players.get(STATE.you);
      if (me) {
        const s = tileToScreen(me.rx, me.ry);
        const targetX = s.x - window.innerWidth  / 2;
        const targetY = s.y - window.innerHeight / 2;
        this.cameras.main.scrollX += (targetX - this.cameras.main.scrollX) * 0.1;
        this.cameras.main.scrollY += (targetY - this.cameras.main.scrollY) * 0.1;
      }
    }
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    width: window.innerWidth,
    height: window.innerHeight,
    scene: [MainScene]
  });
})();

(function () {
  // Isometric tile size (tweak these to taste)
  // RO-ish feel: wide diamond tiles
  const ISO_W = 48;   // tile width in pixels
  const ISO_H = 24;   // tile height in pixels

  const STATE = {
    you: null,
    map: { w: 60, h: 40 },
    players: new Map(), // id -> { id, tx,ty, rx,ry, sprite }
    origin: { x: 480, y: 90 } // screen offset (we’ll recompute on WELCOME)
  };

  function tileToScreen(tx, ty) {
    const x = (tx - ty) * (ISO_W / 2) + STATE.origin.x;
    const y = (tx + ty) * (ISO_H / 2) + STATE.origin.y;
    return { x, y };
  }

  function screenToTile(sx, sy) {
    // remove origin first
    const x = sx - STATE.origin.x;
    const y = sy - STATE.origin.y;

    // invert the isometric transform
    const tx = (y / (ISO_H / 2) + x / (ISO_W / 2)) / 2;
    const ty = (y / (ISO_H / 2) - x / (ISO_W / 2)) / 2;

    return { tx, ty };
  }

  function clampTile(tx, ty) {
    tx = Math.max(0, Math.min(STATE.map.w - 1, tx));
    ty = Math.max(0, Math.min(STATE.map.h - 1, ty));
    return { tx, ty };
  }

  function upsertPlayer(scene, id, tx, ty) {
    let p = STATE.players.get(id);

    if (!p) {
      // “pill” placeholder: ellipse with a tiny “body” rect above it
      const base = scene.add.ellipse(0, 0, 18, 10, 0x7dd3fc).setOrigin(0.5, 0.5);
      const body = scene.add.rectangle(0, 0, 10, 16, 0x7dd3fc).setOrigin(0.5, 1);

      const container = scene.add.container(0, 0, [body, base]);

      p = { id, tx, ty, rx: tx, ry: ty, sprite: container };
      STATE.players.set(id, p);
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
    const isYou = (p.id === STATE.you);
    const color = isYou ? 0xa3e635 : 0x7dd3fc;

    // container children: [bodyRect, baseEllipse]
    const body = p.sprite.list[0];
    const base = p.sprite.list[1];
    body.fillColor = color;
    base.fillColor = color;
  }

  function setDepth(p) {
    // Depth sorting: farther “down” should be in front.
    // Using (tx+ty) is a classic cheap depth key.
    p.sprite.setDepth((p.ty + p.tx) * 10 + 5);
  }

  class MainScene extends Phaser.Scene {
    constructor() { super("main"); }

    create() {
      this.cameras.main.setBackgroundColor("#0b1020");

      // Full-window game (nice for WP pages too)
      this.scale.resize(window.innerWidth, window.innerHeight);
      window.addEventListener("resize", () => {
        this.scale.resize(window.innerWidth, window.innerHeight);
        this.recomputeOrigin();
        this.drawIsoGrid();
      });

      this.grid = this.add.graphics();

      this.recomputeOrigin();
      this.drawIsoGrid();

      this.net = window.LERMA_NET.connect((msg) => this.onNet(msg));

      this.input.on("pointerdown", (pointer) => {
        // Convert click point to tile coords
        const { tx, ty } = screenToTile(pointer.worldX, pointer.worldY);
        const fx = Math.floor(tx);
        const fy = Math.floor(ty);
        const c = clampTile(fx, fy);

        this.net.send({ t: "MOVE_TO", seq: (Date.now() % 1000000), x: c.tx, y: c.ty });
      });
    }

    recomputeOrigin() {
      // Center the whole diamond-ish map nicely in the viewport.
      // Rough map pixel extents:
      const mapWpx = (STATE.map.w + STATE.map.h) * (ISO_W / 2);
      const mapHpx = (STATE.map.w + STATE.map.h) * (ISO_H / 2);

      STATE.origin.x = Math.floor(this.scale.width / 2);
      STATE.origin.y = Math.floor((this.scale.height - mapHpx) / 2) + 60; // push down a bit
    }

    drawIsoGrid() {
      const g = this.grid;
      g.clear();
      g.lineStyle(1, 0x1f2a44, 1);

      // Prototype: draw all tiles (OK for small maps).
      // Later we can draw only visible area for big maps.
      for (let y = 0; y < STATE.map.h; y++) {
        for (let x = 0; x < STATE.map.w; x++) {
          const c = tileToScreen(x, y);

          // diamond corners
          const top    = { x: c.x,               y: c.y - ISO_H / 2 };
          const right  = { x: c.x + ISO_W / 2,   y: c.y };
          const bottom = { x: c.x,               y: c.y + ISO_H / 2 };
          const left   = { x: c.x - ISO_W / 2,   y: c.y };

          g.strokePoints([top, right, bottom, left, top], false);
        }
      }
    }

    onNet(msg) {
      if (msg.t === "WELCOME") {
        STATE.map = msg.map;
        this.recomputeOrigin();
        this.drawIsoGrid();
        return;
      }

      if (msg.t === "SNAPSHOT") {
        STATE.you = msg.you;

        for (const id of Array.from(STATE.players.keys())) removePlayer(id);
        for (const pl of msg.players) upsertPlayer(this, pl.id, pl.x, pl.y);

        for (const p of STATE.players.values()) {
          setPlayerVisual(p);
          setDepth(p);
        }
        return;
      }

      if (msg.t === "DELTA") {
        if (Array.isArray(msg.rm)) for (const id of msg.rm) removePlayer(id);
        if (Array.isArray(msg.up)) for (const u of msg.up) upsertPlayer(this, u.id, u.x, u.y);

        for (const p of STATE.players.values()) {
          setPlayerVisual(p);
          setDepth(p);
        }
        return;
      }
    }

    update(_, dtMs) {
      const dt = dtMs / 1000;
      const FOLLOW = 16;

      for (const p of STATE.players.values()) {
        // Smooth in tile space
        p.rx += (p.tx - p.rx) * Math.min(1, FOLLOW * dt);
        p.ry += (p.ty - p.ry) * Math.min(1, FOLLOW * dt);

        // Convert to screen space for rendering
        const s = tileToScreen(p.rx, p.ry);

        // RO feel: feet on tile, body above it
        p.sprite.x = s.x;
        p.sprite.y = s.y - 6;

        setDepth(p);
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

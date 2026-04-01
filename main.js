(function () {
  const ISO_W = 48;
  const ISO_H = 24;

  const STATE = {
    you: null,
    map: { w: 60, h: 40 },
    players: new Map(),
    origin: { x: 480, y: 90 }
  };

  // Throttle position saves — only save every 2 seconds max
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

  function upsertPlayer(scene, id, tx, ty, name) {
    let p = STATE.players.get(id);

    if (!p) {
      const base = scene.add.ellipse(0, 0, 18, 10, 0x7dd3fc).setOrigin(0.5, 0.5);
      const body = scene.add.rectangle(0, 0, 10, 16, 0x7dd3fc).setOrigin(0.5, 1);
      const label = scene.add.text(0, -24, name || id, {
        fontSize: '11px',
        fontFamily: 'system-ui, sans-serif',
        color: '#e2e8f0',
        stroke: '#0b1020',
        strokeThickness: 3,
        resolution: 2
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
    const isYou = (p.id === STATE.you);
    const color = isYou ? 0xa3e635 : 0x7dd3fc;
    const body  = p.sprite.list[0];
    const base  = p.sprite.list[1];
    body.fillColor = color;
    base.fillColor = color;
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
        this.drawIsoGrid();
      });

      this.grid = this.add.graphics();
      this.recomputeOrigin();
      this.drawIsoGrid();
      this.net = window.LERMA_NET.connect((msg) => this.onNet(msg));

      this.input.on("pointerdown", (pointer) => {
        const { tx, ty } = screenToTile(pointer.worldX, pointer.worldY);
        const c = clampTile(Math.floor(tx), Math.floor(ty));
        this.net.send({ t: "MOVE_TO", seq: (Date.now() % 1000000), x: c.tx, y: c.ty });
      });
    }

    recomputeOrigin() {
      const mapHpx = (STATE.map.w + STATE.map.h) * (ISO_H / 2);
      STATE.origin.x = Math.floor(this.scale.width / 2);
      STATE.origin.y = Math.floor((this.scale.height - mapHpx) / 2) + 60;
    }

    drawIsoGrid() {
      const g = this.grid;
      g.clear();
      g.lineStyle(1, 0x1f2a44, 1);
      for (let y = 0; y < STATE.map.h; y++) {
        for (let x = 0; x < STATE.map.w; x++) {
          const c = tileToScreen(x, y);
          const top    = { x: c.x,             y: c.y - ISO_H / 2 };
          const right  = { x: c.x + ISO_W / 2, y: c.y };
          const bottom = { x: c.x,             y: c.y + ISO_H / 2 };
          const left   = { x: c.x - ISO_W / 2, y: c.y };
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
        for (const pl of msg.players) upsertPlayer(this, pl.id, pl.x, pl.y, pl.name);
        for (const p of STATE.players.values()) { setPlayerVisual(p); setDepth(p); }

        // Save our starting position
        const me = msg.players.find(pl => pl.id === STATE.you);
        if (me) maybeSavePos(me.x, me.y);
        return;
      }

      if (msg.t === "DELTA") {
        if (Array.isArray(msg.rm)) for (const id of msg.rm) removePlayer(id);
        if (Array.isArray(msg.up)) {
          for (const u of msg.up) {
            upsertPlayer(this, u.id, u.x, u.y, u.name);
            // Save our own position when we move
            if (u.id === STATE.you) maybeSavePos(u.x, u.y);
          }
        }
        for (const p of STATE.players.values()) { setPlayerVisual(p); setDepth(p); }
        return;
      }
    }

    update(_, dtMs) {
      const dt = dtMs / 1000;
      const FOLLOW = 16;
      for (const p of STATE.players.values()) {
        p.rx += (p.tx - p.rx) * Math.min(1, FOLLOW * dt);
        p.ry += (p.ty - p.ry) * Math.min(1, FOLLOW * dt);
        const s = tileToScreen(p.rx, p.ry);
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

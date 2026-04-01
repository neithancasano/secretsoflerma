(function () {
  const ISO_W = 48;
  const ISO_H = 24;

  const TILE_COLORS = {
    0: { fill: 0x2d5a1b, stroke: 0x245016 },
    1: { fill: 0x8B6914, stroke: 0x7a5c10 },
    2: { fill: 0x1a3a6e, stroke: 0x152e58 },
    3: { fill: 0x555566, stroke: 0x444455 },
  };

  const NPC_VISUALS = {
    poring: { bodyColor: 0xff6eb4, baseColor: 0xff9ed4, labelColor: '#ffb3d9', scale: 1.2 },
  };

  const STATE = {
    you: null,
    map: { w: 60, h: 40, tiles: null },
    players: new Map(),
    npcs: new Map(),
    origin: { x: 0, y: 0 },
    attackTarget: null,
  };

  let lastSaveAt = 0;
  function maybeSavePos(x, y) {
    const now = Date.now();
    if (now - lastSaveAt < 2000) return;
    lastSaveAt = now;
    if (window.LERMA_SAVE_POS) window.LERMA_SAVE_POS(x, y);
  }

  function tileToScreen(tx, ty) {
    return {
      x: (tx - ty) * (ISO_W / 2) + STATE.origin.x,
      y: (tx + ty) * (ISO_H / 2) + STATE.origin.y
    };
  }
  function screenToTile(sx, sy) {
    const x = sx - STATE.origin.x, y = sy - STATE.origin.y;
    return { tx: (y/(ISO_H/2) + x/(ISO_W/2))/2, ty: (y/(ISO_H/2) - x/(ISO_W/2))/2 };
  }
  function clampTile(tx, ty) {
    return { tx: Math.max(0, Math.min(STATE.map.w-1, tx)), ty: Math.max(0, Math.min(STATE.map.h-1, ty)) };
  }
  function getTile(x, y) {
    if (!STATE.map.tiles) return 0;
    return STATE.map.tiles[y * STATE.map.w + x] ?? 0;
  }

  // ── Player ──
  function upsertPlayer(scene, id, tx, ty, name) {
    let p = STATE.players.get(id);
    if (!p) {
      const base  = scene.add.ellipse(0, 0, 18, 10, 0x7dd3fc).setOrigin(0.5, 0.5);
      const body  = scene.add.rectangle(0, 0, 10, 16, 0x7dd3fc).setOrigin(0.5, 1);
      const label = scene.add.text(0, -24, name||id, { fontSize:'11px', fontFamily:'system-ui,sans-serif', color:'#e2e8f0', stroke:'#0b1020', strokeThickness:3, resolution:2 }).setOrigin(0.5,1);
      const container = scene.add.container(0, 0, [body, base, label]);
      p = { id, tx, ty, rx:tx, ry:ty, sprite:container, label };
      STATE.players.set(id, p);
    } else if (name && p.label) p.label.setText(name);
    p.tx = tx; p.ty = ty;
  }
  function removePlayer(id) {
    const p = STATE.players.get(id);
    if (!p) return;
    p.sprite.destroy();
    STATE.players.delete(id);
  }
  function setPlayerVisual(p) {
    const isYou = p.id === STATE.you;
    const color = isYou ? 0xa3e635 : 0x7dd3fc;
    p.sprite.list[0].fillColor = color;
    p.sprite.list[1].fillColor = color;
    if (p.label) p.label.setColor(isYou ? '#a3e635' : '#e2e8f0');
  }

  // ── NPC ──
  function upsertNPC(scene, id, tx, ty, name, kind, hp, maxHp) {
    let n = STATE.npcs.get(id);
    const vis = NPC_VISUALS[kind] || NPC_VISUALS.poring;
    const s = vis.scale || 1;

    if (!n) {
      const base  = scene.add.ellipse(0, 0, 22*s, 14*s, vis.baseColor).setOrigin(0.5, 0.5);
      const body  = scene.add.ellipse(0, -8*s, 16*s, 16*s, vis.bodyColor).setOrigin(0.5, 0.5);
      const eyeL  = scene.add.circle(-4*s, -10*s, 2*s, 0xffffff);
      const eyeR  = scene.add.circle( 4*s, -10*s, 2*s, 0xffffff);
      const pupL  = scene.add.circle(-4*s, -10*s, 1*s, 0x222222);
      const pupR  = scene.add.circle( 4*s, -10*s, 1*s, 0x222222);
      const label = scene.add.text(0, -26*s, name||'Poring', { fontSize:'10px', fontFamily:'system-ui,sans-serif', color:vis.labelColor, stroke:'#0b1020', strokeThickness:3, resolution:2 }).setOrigin(0.5,1);
      const hpBg   = scene.add.rectangle(0, -38*s, 30, 4, 0x333333).setOrigin(0.5, 0.5);
      const hpFill = scene.add.rectangle(-15, -38*s, 30, 4, 0xff4444).setOrigin(0, 0.5);

      const container = scene.add.container(0, 0, [base, body, eyeL, eyeR, pupL, pupR, hpBg, hpFill, label]);
      container.setSize(30, 30);
      container.setInteractive();

      container.on('pointerdown', (ptr) => {
        ptr.event.stopPropagation();
        STATE.attackTarget = id;
        scene.net.send({ t: 'ATTACK_NPC', npcId: id });
        body.setStrokeStyle(2, 0xffff00);
      });
      container.on('pointerover', () => { scene.input.setDefaultCursor('crosshair'); });
      container.on('pointerout',  () => { scene.input.setDefaultCursor('default'); });

      n = { id, tx, ty, rx:tx, ry:ty, sprite:container, label, hpFill, body, kind, hp: hp||50, maxHp: maxHp||50 };
      STATE.npcs.set(id, n);
    }

    if (hp !== undefined) {
      n.hp = hp; n.maxHp = maxHp || n.maxHp;
      const pct = Math.max(0, n.hp / n.maxHp);
      n.hpFill.width = 30 * pct;
      n.hpFill.x = -15;
    }

    n.tx = tx; n.ty = ty;
  }

  function removeNPC(id) {
    const n = STATE.npcs.get(id);
    if (!n) return;
    n.sprite.destroy();
    STATE.npcs.delete(id);
    if (STATE.attackTarget === id) STATE.attackTarget = null;
  }

  function setDepth(e, isNpc) {
    e.sprite.setDepth((e.ty + e.tx) * 10 + (isNpc ? 4 : 5));
  }

  // ── Floating damage number — uses WORLD coords so it stays on the Poring ──
  function spawnDmgNumber(scene, worldX, worldY, dmg) {
    const txt = scene.add.text(worldX, worldY - 20, `-${dmg}`, {
      fontSize: '14px', fontFamily: 'system-ui,sans-serif',
      color: '#ff4444', stroke: '#000', strokeThickness: 3,
      fontStyle: 'bold', resolution: 2
    }).setOrigin(0.5, 1).setDepth(9999);

    scene.tweens.add({
      targets: txt,
      y: worldY - 55,
      alpha: 0,
      duration: 900,
      ease: 'Power2',
      onComplete: () => txt.destroy()
    });
  }

  class MainScene extends Phaser.Scene {
    constructor() { super('main'); }

    create() {
      this.cameras.main.setBackgroundColor('#0b1020');
      this.scale.resize(window.innerWidth, window.innerHeight);
      window.addEventListener('resize', () => {
        this.scale.resize(window.innerWidth, window.innerHeight);
        this.recomputeOrigin();
        this.drawTileMap();
      });

      this.tileGraphics = this.add.graphics();
      this.recomputeOrigin();
      this.net = window.LERMA_NET.connect((msg) => this.onNet(msg));

      this.input.on('pointerdown', (pointer) => {
        if (pointer.event.defaultPrevented) return;
        if (STATE.attackTarget) {
          STATE.attackTarget = null;
          this.net.send({ t: 'CANCEL_ATTACK' });
          for (const n of STATE.npcs.values()) n.body.setStrokeStyle(0);
        }
        const cam = this.cameras.main;
        const worldX = pointer.x + cam.scrollX;
        const worldY = pointer.y + cam.scrollY;
        const { tx, ty } = screenToTile(worldX, worldY);
        const c = clampTile(Math.floor(tx), Math.floor(ty));
        this.net.send({ t: 'MOVE_TO', seq: Date.now() % 1000000, x: c.tx, y: c.ty });
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
          const colors = TILE_COLORS[getTile(x,y)] || TILE_COLORS[0];
          const c = tileToScreen(x, y);
          const top    = { x: c.x,           y: c.y - ISO_H/2 };
          const right  = { x: c.x + ISO_W/2, y: c.y };
          const bottom = { x: c.x,           y: c.y + ISO_H/2 };
          const left   = { x: c.x - ISO_W/2, y: c.y };
          g.fillStyle(colors.fill, 1);
          g.fillPoints([top, right, bottom, left], true);
          g.lineStyle(1, colors.stroke, 0.6);
          g.strokePoints([top, right, bottom, left, top], false);
        }
      }
    }

    onNet(msg) {
      if (msg.t === 'WELCOME') {
        STATE.map.w = msg.map.w; STATE.map.h = msg.map.h;
        this.recomputeOrigin();
        fetch('/secretsoflerma/map.json').then(r=>r.json()).then(d=>{ STATE.map.tiles=d.tiles; this.drawTileMap(); }).catch(()=>this.drawTileMap());
        return;
      }

      if (msg.t === 'SNAPSHOT') {
        STATE.you = msg.you;
        for (const id of [...STATE.players.keys()]) removePlayer(id);
        for (const id of [...STATE.npcs.keys()]) removeNPC(id);
        for (const pl of msg.players) upsertPlayer(this, pl.id, pl.x, pl.y, pl.name);
        for (const p of STATE.players.values()) { setPlayerVisual(p); setDepth(p, false); }
        if (Array.isArray(msg.npcs))
          for (const n of msg.npcs) upsertNPC(this, n.id, n.x, n.y, n.name, n.kind, n.hp, n.maxHp);
        for (const n of STATE.npcs.values()) setDepth(n, true);
        const me = msg.players.find(pl => pl.id === STATE.you);
        if (me) maybeSavePos(me.x, me.y);
        return;
      }

      if (msg.t === 'DELTA') {
        if (Array.isArray(msg.rm)) for (const id of msg.rm) removePlayer(id);
        if (Array.isArray(msg.up)) {
          for (const u of msg.up) {
            upsertPlayer(this, u.id, u.x, u.y, u.name);
            if (u.id === STATE.you) maybeSavePos(u.x, u.y);
          }
        }
        for (const p of STATE.players.values()) { setPlayerVisual(p); setDepth(p, false); }
        if (Array.isArray(msg.npcUp)) {
          for (const n of msg.npcUp) upsertNPC(this, n.id, n.x, n.y, n.name, n.kind, n.hp, n.maxHp);
          for (const n of STATE.npcs.values()) setDepth(n, true);
        }
        return;
      }

      if (msg.t === 'NPC_HIT') {
        const n = STATE.npcs.get(msg.npcId);
        if (!n) return;
        n.hp = msg.hp;
        const pct = Math.max(0, n.hp / n.maxHp);
        n.hpFill.width = 30 * pct;
        n.body.setFillStyle(0xff0000);
        setTimeout(() => { if (n.body) n.body.setFillStyle(NPC_VISUALS[n.kind]?.bodyColor || 0xff6eb4); }, 120);
        // Use world coords — damage floats over the Poring correctly
        spawnDmgNumber(this, n.sprite.x, n.sprite.y, msg.dmg);
        return;
      }

      if (msg.t === 'NPC_DIED') {
        const n = STATE.npcs.get(msg.npcId);
        if (!n) return;
        n.body.setFillStyle(0xffffff);
        this.time.delayedCall(200, () => removeNPC(msg.npcId));
        return;
      }

      if (msg.t === 'NPC_SPAWN') {
        upsertNPC(this, msg.id, msg.x, msg.y, msg.name, msg.kind, msg.hp, msg.maxHp);
        const n = STATE.npcs.get(msg.id);
        if (n) setDepth(n, true);
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
        p.sprite.x = s.x; p.sprite.y = s.y - 6;
        setDepth(p, false);
      }

      for (const n of STATE.npcs.values()) {
        n.rx += (n.tx - n.rx) * Math.min(1, FOLLOW * 0.4 * dt);
        n.ry += (n.ty - n.ry) * Math.min(1, FOLLOW * 0.4 * dt);
        const s = tileToScreen(n.rx, n.ry);
        n.sprite.x = s.x; n.sprite.y = s.y - 4;
        setDepth(n, true);
      }

      const me = STATE.players.get(STATE.you);
      if (me) {
        const s = tileToScreen(me.rx, me.ry);
        this.cameras.main.scrollX += (s.x - window.innerWidth/2  - this.cameras.main.scrollX) * 0.1;
        this.cameras.main.scrollY += (s.y - window.innerHeight/2 - this.cameras.main.scrollY) * 0.1;
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

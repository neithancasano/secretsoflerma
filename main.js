(function () {
  const ISO_W = 48, ISO_H = 24;

  const TILE_COLORS = {
    0:{fill:0x2d5a1b,stroke:0x245016},
    1:{fill:0x8B6914,stroke:0x7a5c10},
    2:{fill:0x1a3a6e,stroke:0x152e58},
    3:{fill:0x555566,stroke:0x444455},
  };

  const NPC_VISUALS = {
    poring:{bodyColor:0xff6eb4,baseColor:0xff9ed4,labelColor:'#ffb3d9',scale:1.2},
    migs:  {bodyColor:0xf59e0b,baseColor:0xfbbf24,labelColor:'#fde68a',scale:1.1},
  };

  // Exported frame indices from Sprite Mapper (used for timing + future spritesheet playback).
  const PLAYER_ANIM_MAP = {
    walk:{up:[104,105,106,107,108,109,110,111,112],down:[130,131,132,133,134,135,136,137,138],left:[117,118,119,120,121,122,123,124,125],right:[143,144,145,146,147,148,149,150,151]},
    slash:{up:[156,157,158,159,160,161],down:[182,183,184,185,186,187],left:[169,170,171,172,173,174],right:[195,196,197,198,199,200]},
  };
  const ATTACK_FRAME_MS = 70;

  const STATE = {
    you:null,
    map:{w:60,h:40,tiles:null},
    players:new Map(), npcs:new Map(),
    origin:{x:0,y:0},
    attackTarget:null, clickConsumed:false,
    playerHp:100, playerMaxHp:100,
    stats:null,
    zoneId:'lerma', zoneName:'Barangay Lerma',
    portals:[],
    migsOpen:false,
  };

  (function injectChatCursor(){
    if(document.getElementById('migs-cursor-style'))return;
    const svg=`<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><text y='26' font-size='26'>💬</text></svg>`;
    const encoded=encodeURIComponent(svg);
    const style=document.createElement('style');
    style.id='migs-cursor-style';
    style.textContent=`.migs-hover-cursor{cursor:url("data:image/svg+xml,${encoded}") 0 32,pointer!important;}`;
    document.head.appendChild(style);
  })();

  let lastSaveAt=0;
  function maybeSavePos(x,y){const now=Date.now();if(now-lastSaveAt<2000)return;lastSaveAt=now;if(window.LERMA_SAVE_POS)window.LERMA_SAVE_POS(x,y,STATE.zoneId);}

  function tileToScreen(tx,ty){return{x:(tx-ty)*(ISO_W/2)+STATE.origin.x,y:(tx+ty)*(ISO_H/2)+STATE.origin.y};}
  function screenToTile(sx,sy){const x=sx-STATE.origin.x,y=sy-STATE.origin.y;return{tx:(y/(ISO_H/2)+x/(ISO_W/2))/2,ty:(y/(ISO_H/2)-x/(ISO_W/2))/2};}
  function clampTile(tx,ty){return{tx:Math.max(0,Math.min(STATE.map.w-1,tx)),ty:Math.max(0,Math.min(STATE.map.h-1,ty))};}
  function getTile(x,y){if(!STATE.map.tiles)return 0;return STATE.map.tiles[y*STATE.map.w+x]??0;}
  function facingFromDelta(dx,dy){return Math.abs(dx)>Math.abs(dy)?(dx>=0?'right':'left'):(dy>=0?'down':'up');}

  const STAT_NAMES=[{key:'str',label:'STR'},{key:'agi',label:'AGI'},{key:'vit',label:'VIT'},{key:'int',label:'INT'},{key:'dex',label:'DEX'},{key:'luk',label:'LUK'}];
  function statCost(v){return Math.floor(v/10)+2;}

  function renderStatWindow(stats,net){
    if(!stats)return;
    STATE.stats=stats;
    document.getElementById('sw-level').textContent=stats.level;
    document.getElementById('stat-points-left').textContent=stats.statPoints;
    document.getElementById('sw-exp').textContent=stats.exp;
    document.getElementById('sw-exp-next').textContent=stats.expNext;
    const expPct=Math.min(100,(stats.exp/stats.expNext)*100);
    document.getElementById('exp-bar-fill').style.width=expPct+'%';
    const rows=document.getElementById('stat-rows');
    rows.innerHTML='';
    for(const s of STAT_NAMES){
      const cost=statCost(stats[s.key]),can=stats.statPoints>=cost;
      const row=document.createElement('div');row.className='stat-row';
      row.innerHTML=`<span class="stat-label">${s.label}</span><span class="stat-val">${stats[s.key]}</span><button class="stat-btn" data-stat="${s.key}" ${can?'':'disabled'}>+</button><span class="stat-cost">cost ${cost}</span>`;
      rows.appendChild(row);
    }
    rows.querySelectorAll('.stat-btn').forEach(btn=>btn.addEventListener('click',()=>{if(net)net.send({t:'ADD_STAT',stat:btn.dataset.stat});}));
    const derived=document.getElementById('derived-rows');derived.innerHTML='';
    for(const[label,val] of [['ATK',stats.atk],['DEF',stats.def],['Max HP',stats.maxHp],['ASPD',stats.aspd+'ms'],['HIT',stats.hit],['FLEE',stats.flee],['Crit',stats.critRate+'%'],['Weight',stats.weightLimit]]){
      const row=document.createElement('div');row.className='derived-row';
      row.innerHTML=`<span>${label}</span><span>${val}</span>`;
      derived.appendChild(row);
    }
  }

  function showMigsMenu(msg, net){
    STATE.migsOpen=true;
    let dlg=document.getElementById('migs-dialogue');
    if(!dlg){
      dlg=document.createElement('div');
      dlg.id='migs-dialogue';
      dlg.style.cssText='position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#0f172a;border:2px solid #f59e0b;border-radius:10px;padding:16px 20px;width:340px;z-index:50;font-family:system-ui,sans-serif;color:#e2e8f0;font-size:13px;';
      document.body.appendChild(dlg);
    }
    const destButtons=msg.destinations&&msg.destinations.length>0
      ? msg.destinations.map(d=>`<button class="migs-dest-btn" data-zone="${d.zoneId}" style="display:block;width:100%;margin:3px 0;padding:6px 10px;background:#1e293b;color:#fde68a;border:1px solid #f59e0b;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;">🌀 ${d.label}</button>`).join('')
      : '';
    dlg.innerHTML=`
      <div style="color:#f59e0b;font-weight:700;margin-bottom:8px;">🛒 Migs</div>
      <div style="color:#cbd5e1;margin-bottom:12px;font-size:12px;line-height:1.5;">${msg.greeting}</div>
      <div id="migs-options">
        ${msg.options.map(o=>{
          if(o.id==='teleport'){
            return `<div style="margin:4px 0;"><button class="migs-opt-btn" data-action="${o.id}" style="display:block;width:100%;padding:7px 10px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;">${o.label}</button><div id="migs-dests" style="display:none;padding:4px 0 4px 8px;">${destButtons}</div></div>`;
          }
          return `<button class="migs-opt-btn" data-action="${o.id}" style="display:block;width:100%;margin:4px 0;padding:7px 10px;background:#1e293b;color:#e2e8f0;border:1px solid #334155;border-radius:6px;cursor:pointer;text-align:left;font-size:12px;">${o.label}</button>`;
        }).join('')}
      </div>
      <div id="migs-msg" style="margin-top:8px;color:#4ade80;font-size:11px;min-height:16px;"></div>
    `;
    dlg.querySelectorAll('.migs-opt-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        const action=btn.dataset.action;
        if(action==='close'){closeMigsMenu();return;}
        if(action==='teleport'){
          const destsDiv=document.getElementById('migs-dests');
          destsDiv.style.display=destsDiv.style.display==='none'?'block':'none';
          return;
        }
        net.send({t:'MIGS_ACTION',action,npcId:msg.npcId});
      });
    });
    dlg.querySelectorAll('.migs-dest-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        net.send({t:'MIGS_ACTION',action:'teleport',destZone:btn.dataset.zone,npcId:msg.npcId});
      });
    });
  }

  function showMigsResponse(text){
    const msgEl=document.getElementById('migs-msg');
    if(msgEl)msgEl.textContent=text;
    setTimeout(()=>{if(msgEl)msgEl.textContent='';},3000);
  }

  function closeMigsMenu(){
    STATE.migsOpen=false;
    const dlg=document.getElementById('migs-dialogue');
    if(dlg)dlg.remove();
  }

  function updateZoneUI(zoneName){
    let el=document.getElementById('zone-indicator');
    if(!el){
      el=document.createElement('div');
      el.id='zone-indicator';
      el.style.cssText='position:fixed;top:10px;left:50%;transform:translateX(-50%);background:#0f172a;border:1px solid #334155;border-radius:20px;padding:4px 14px;color:#94a3b8;font-size:12px;font-family:system-ui,sans-serif;z-index:5;pointer-events:none;';
      document.body.appendChild(el);
    }
    el.textContent='📍 '+zoneName;
  }

  function upsertPlayer(scene,id,tx,ty,name,level){
    let p=STATE.players.get(id);
    if(!p){
      const base=scene.add.ellipse(0,0,18,10,0x7dd3fc).setOrigin(0.5,0.5);
      const body=scene.add.rectangle(0,0,10,16,0x7dd3fc).setOrigin(0.5,1);
      const label=scene.add.text(0,-24,name||id,{fontSize:'11px',fontFamily:'system-ui,sans-serif',color:'#e2e8f0',stroke:'#0b1020',strokeThickness:3,resolution:2}).setOrigin(0.5,1);
      const lvlTag=scene.add.text(0,-36,`Lv${level||1}`,{fontSize:'9px',fontFamily:'system-ui,sans-serif',color:'#a3e635',stroke:'#0b1020',strokeThickness:2,resolution:2}).setOrigin(0.5,1);
      const container=scene.add.container(0,0,[body,base,label,lvlTag]);
      p={id,tx,ty,rx:tx,ry:ty,sprite:container,label,lvlTag,body};
      STATE.players.set(id,p);
    } else {
      if(name&&p.label)p.label.setText(name);
      if(level&&p.lvlTag)p.lvlTag.setText(`Lv${level}`);
    }
    p.tx=tx;p.ty=ty;
  }
  function removePlayer(id){const p=STATE.players.get(id);if(!p)return;p.sprite.destroy();STATE.players.delete(id);}
  function setPlayerVisual(p){const isYou=p.id===STATE.you;const color=isYou?0xa3e635:0x7dd3fc;p.sprite.list[0].fillColor=color;p.sprite.list[1].fillColor=color;if(p.label)p.label.setColor(isYou?'#a3e635':'#e2e8f0');}

  function upsertNPC(scene,id,tx,ty,name,kind,hp,maxHp){
    let n=STATE.npcs.get(id);
    const vis=NPC_VISUALS[kind]||NPC_VISUALS.poring;
    const s=vis.scale||1;
    const isMigs=kind==='migs';
    if(!n){
      const base=scene.add.ellipse(0,0,22*s,14*s,vis.baseColor).setOrigin(0.5,0.5);
      const body=scene.add.ellipse(0,-8*s,16*s,16*s,vis.bodyColor).setOrigin(0.5,0.5);
      const eyeL=scene.add.circle(-4*s,-10*s,2*s,0xffffff);
      const eyeR=scene.add.circle(4*s,-10*s,2*s,0xffffff);
      const pupL=scene.add.circle(-4*s,-10*s,1*s,0x222222);
      const pupR=scene.add.circle(4*s,-10*s,1*s,0x222222);
      const label=scene.add.text(0,-26*s,name||kind,{fontSize:'10px',fontFamily:'system-ui,sans-serif',color:vis.labelColor,stroke:'#0b1020',strokeThickness:3,resolution:2}).setOrigin(0.5,1);
      const hpBg=scene.add.rectangle(0,-38*s,30,4,0x333333).setOrigin(0.5,0.5);
      const hpFill=scene.add.rectangle(-15,-38*s,30,4,0xff4444).setOrigin(0,0.5);
      if(isMigs){hpBg.setVisible(false);hpFill.setVisible(false);}
      const chatBubble=isMigs
        ? scene.add.text(0,-38*s,'💬',{fontSize:'14px',resolution:2}).setOrigin(0.5,1)
        : null;
      const children=[base,body,eyeL,eyeR,pupL,pupR,hpBg,hpFill,label];
      if(chatBubble)children.push(chatBubble);
      const container=scene.add.container(0,0,children);
      container.setSize(isMigs?48:30,isMigs?48:30);
      container.setInteractive();
      container.on('pointerdown',()=>{
        STATE.clickConsumed=true;
        if(isMigs){
          scene.net.send({t:'TALK_NPC',npcId:id});
        } else {
          STATE.attackTarget=id;
          playLocalAttack(scene,id,n.tx,n.ty);
          body.setStrokeStyle(2,0xffff00);
        }
      });
      container.on('pointerover',()=>{
        if(isMigs){
          scene.game.canvas.classList.add('migs-hover-cursor');
        } else {
          scene.input.setDefaultCursor('crosshair');
        }
      });
      container.on('pointerout',()=>{
        scene.game.canvas.classList.remove('migs-hover-cursor');
        scene.input.setDefaultCursor('default');
      });
      n={id,tx,ty,rx:tx,ry:ty,sprite:container,label,hpFill,body,kind,hp:hp||50,maxHp:maxHp||50};
      STATE.npcs.set(id,n);
    }
    if(!isMigs&&hp!==undefined){n.hp=hp;n.maxHp=maxHp||n.maxHp;const pct=Math.max(0,n.hp/n.maxHp);n.hpFill.width=30*pct;n.hpFill.x=-15;}
    n.tx=tx;n.ty=ty;
  }
  function removeNPC(id){const n=STATE.npcs.get(id);if(!n)return;n.sprite.destroy();STATE.npcs.delete(id);if(STATE.attackTarget===id)STATE.attackTarget=null;}
  function clearAllNPCs(){for(const n of STATE.npcs.values())n.sprite.destroy();STATE.npcs.clear();}
  function clearAllPlayers(){for(const p of STATE.players.values())p.sprite.destroy();STATE.players.clear();}

  function setDepth(e,isNpc){e.sprite.setDepth((e.ty+e.tx)*10+(isNpc?4:5));}

  function playSlashFx(scene,source,dir){
    const slash=scene.add.ellipse(source.x,source.y-14,22,10,0xffffff,0.15).setStrokeStyle(2,0xffffff,0.85).setDepth(9998);
    const cfg={
      up:{dx:0,dy:-18,angle:-90},
      down:{dx:0,dy:14,angle:90},
      left:{dx:-20,dy:-2,angle:180},
      right:{dx:20,dy:-2,angle:0},
    }[dir]||{dx:0,dy:-18,angle:-90};
    slash.setAngle(cfg.angle);
    scene.tweens.add({
      targets:slash,x:slash.x+cfg.dx,y:slash.y+cfg.dy,scaleX:2.4,scaleY:1.5,alpha:0,duration:180,ease:'Cubic.easeOut',
      onComplete:()=>slash.destroy()
    });
  }

  function playLocalAttack(scene,npcId,targetTx,targetTy){
    const me=STATE.players.get(STATE.you);
    if(!me){scene.net.send({t:'ATTACK_NPC',npcId});return;}
    if(me.attackAnimBusy)return;
    const dir=facingFromDelta(targetTx-me.rx,targetTy-me.ry);
    const slashFrames=PLAYER_ANIM_MAP.slash[dir]||PLAYER_ANIM_MAP.slash.down;
    const totalMs=slashFrames.length*ATTACK_FRAME_MS;
    const hitAtMs=Math.floor(totalMs*0.55);
    me.attackAnimBusy=true;
    me.facing=dir;

    scene.tweens.add({targets:me.body,angle:dir==='left'?-12:dir==='right'?12:0,scaleY:0.85,duration:hitAtMs,ease:'Sine.easeInOut',yoyo:true});
    scene.time.delayedCall(hitAtMs,()=>{
      scene.net.send({t:'ATTACK_NPC',npcId});
      playSlashFx(scene,me.sprite,dir);
      if(me.body)me.body.setFillStyle(0xfff59d);
    });
    scene.time.delayedCall(totalMs,()=>{
      me.attackAnimBusy=false;
      setPlayerVisual(me);
      if(me.body){me.body.angle=0;me.body.setScale(1,1);}
    });
  }

  function spawnDmgNumber(scene,worldX,worldY,dmg,color,isCrit){
    const txt=scene.add.text(worldX,worldY-20,isCrit?`★${dmg}`:`-${dmg}`,{fontSize:isCrit?'18px':'14px',fontFamily:'system-ui,sans-serif',color:color||'#ff4444',stroke:'#000',strokeThickness:3,fontStyle:'bold',resolution:2}).setOrigin(0.5,1).setDepth(9999);
    scene.tweens.add({targets:txt,y:worldY-60,alpha:0,duration:isCrit?1100:900,ease:'Power2',onComplete:()=>txt.destroy()});
  }

  function updatePlayerHpBar(hp,maxHp){
    if(hp!==undefined){STATE.playerHp=hp;STATE.playerMaxHp=maxHp;}
    const bar=document.getElementById('player-hp-fill'),txt=document.getElementById('player-hp-text');
    if(!bar||!txt)return;
    const pct=Math.max(0,STATE.playerHp/STATE.playerMaxHp)*100;
    bar.style.width=pct+'%';
    txt.textContent=`HP: ${STATE.playerHp} / ${STATE.playerMaxHp}`;
    bar.style.background=pct>50?'#4ade80':pct>25?'#facc15':'#ef4444';
  }

  // BUG FIX: always use /zones/{zoneId}.json — no more special case for lerma
  function fetchZoneMap(scene, zoneId, cb){
    fetch(`/secretsoflerma/zones/${zoneId}.json`)
      .then(r=>r.json())
      .then(d=>{STATE.map.tiles=d.tiles;cb();})
      .catch(()=>{STATE.map.tiles=null;cb();});
  }

  class MainScene extends Phaser.Scene {
    constructor(){super('main');}

    create(){
      this.cameras.main.setBackgroundColor('#0b1020');
      this.scale.resize(window.innerWidth,window.innerHeight);
      window.addEventListener('resize',()=>{this.scale.resize(window.innerWidth,window.innerHeight);this.recomputeOrigin();this.drawTileMap();});
      this.tileGraphics=this.add.graphics();
      this.portalEffects=[];
      this.createPortalParticleTexture();
      this.recomputeOrigin();
      this.net=window.LERMA_NET.connect((msg)=>this.onNet(msg));

      if(!document.getElementById('player-hp-bar')){
        const bar=document.createElement('div');
        bar.id='player-hp-bar';
        bar.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);width:200px;background:#1e293b;border:1px solid #334155;border-radius:6px;padding:4px 8px;z-index:10;font-family:system-ui,sans-serif;';
        bar.innerHTML=`<div id="player-hp-text" style="color:#94a3b8;font-size:11px;margin-bottom:3px;">HP: 100 / 100</div><div style="background:#334155;border-radius:3px;height:8px;overflow:hidden"><div id="player-hp-fill" style="height:100%;width:100%;background:#4ade80;border-radius:3px;transition:width 0.2s,background 0.2s"></div></div>`;
        document.body.appendChild(bar);
      }

      this.input.on('pointerdown',(pointer)=>{
        if(STATE.clickConsumed){STATE.clickConsumed=false;return;}
        if(STATE.migsOpen){closeMigsMenu();return;}
        if(STATE.attackTarget){STATE.attackTarget=null;this.net.send({t:'CANCEL_ATTACK'});for(const n of STATE.npcs.values())n.body.setStrokeStyle(0);}
        const cam=this.cameras.main;
        const worldX=pointer.x+cam.scrollX,worldY=pointer.y+cam.scrollY;
        const{tx,ty}=screenToTile(worldX,worldY);
        const c=clampTile(Math.floor(tx),Math.floor(ty));
        this.net.send({t:'MOVE_TO',seq:Date.now()%1000000,x:c.tx,y:c.ty});
      });
    }

    recomputeOrigin(){
      const mapHpx=(STATE.map.w+STATE.map.h)*(ISO_H/2);
      STATE.origin.x=Math.floor(window.innerWidth/2);
      STATE.origin.y=Math.floor((window.innerHeight-mapHpx)/2)+60;
    }

    drawTileMap(){
      const g=this.tileGraphics;
      g.clear();
      for(let y=0;y<STATE.map.h;y++){
        for(let x=0;x<STATE.map.w;x++){
          const colors=TILE_COLORS[getTile(x,y)]||TILE_COLORS[0];
          const c=tileToScreen(x,y);
          const top={x:c.x,y:c.y-ISO_H/2},right={x:c.x+ISO_W/2,y:c.y};
          const bottom={x:c.x,y:c.y+ISO_H/2},left={x:c.x-ISO_W/2,y:c.y};
          g.fillStyle(colors.fill,1);g.fillPoints([top,right,bottom,left],true);
          g.lineStyle(1,colors.stroke,0.6);g.strokePoints([top,right,bottom,left,top],false);
        }
      }
      this.refreshPortalEffects();
    }

    createPortalParticleTexture(){
      if(this.textures.exists('portal-particle'))return;
      const dot=this.make.graphics({x:0,y:0,add:false});
      dot.fillStyle(0xffffff,1);
      dot.fillCircle(4,4,4);
      dot.generateTexture('portal-particle',8,8);
      dot.destroy();
    }

    clearPortalEffects(){
      for(const fx of this.portalEffects){
        fx.glow.destroy();
        fx.outerRing.destroy();
        fx.innerRing.destroy();
        fx.particles.destroy();
      }
      this.portalEffects.length=0;
    }

    refreshPortalEffects(){
      this.clearPortalEffects();
      for(const portal of STATE.portals){
        const c=tileToScreen(portal.x,portal.y);
        const glow=this.add.ellipse(c.x,c.y+4,ISO_W*0.9,ISO_H*0.56,0x5BFF8B,0.25).setDepth(1);
        const outerRing=this.add.ellipse(c.x,c.y-3,ISO_W*0.8,ISO_H*0.42).setStrokeStyle(2,0xB6FF77,0.9).setDepth(2);
        const innerRing=this.add.ellipse(c.x,c.y-3,ISO_W*0.56,ISO_H*0.26).setStrokeStyle(2,0xE6FFB2,0.9).setDepth(2);
        const particles=this.add.particles(c.x,c.y-6,'portal-particle',{
          x:{min:-ISO_W*0.22,max:ISO_W*0.22},
          y:{min:-ISO_H*0.14,max:ISO_H*0.14},
          speedY:{min:-45,max:-12},
          speedX:{min:-14,max:14},
          scale:{start:0.75,end:0},
          alpha:{start:0.95,end:0},
          tint:[0x76FF91,0xB8FF96,0xE8FFC4],
          lifespan:{min:600,max:1100},
          frequency:34,
          blendMode:'ADD',
          rotate:{min:0,max:360},
        }).setDepth(3);

        this.tweens.add({targets:outerRing,angle:360,duration:2200,ease:'Linear',repeat:-1});
        this.tweens.add({targets:innerRing,angle:-360,duration:1700,ease:'Linear',repeat:-1});
        this.tweens.add({targets:glow,alpha:{from:0.15,to:0.42},duration:900,yoyo:true,ease:'Sine.easeInOut',repeat:-1});

        this.portalEffects.push({glow,outerRing,innerRing,particles});
      }
    }

    onNet(msg){
      if(msg.t==='WELCOME'){
        STATE.map.w=msg.map.w;STATE.map.h=msg.map.h;
        if(msg.zoneId){STATE.zoneId=msg.zoneId;STATE.zoneName=msg.zoneName;STATE.portals=msg.portals||[];}
        this.recomputeOrigin();
        updateZoneUI(STATE.zoneName);
        fetchZoneMap(this,STATE.zoneId,()=>this.drawTileMap());
        return;
      }

      if(msg.t==='SNAPSHOT'){
        STATE.you=msg.you;
        if(msg.zoneId){STATE.zoneId=msg.zoneId;STATE.zoneName=msg.zoneName;STATE.portals=msg.portals||[];updateZoneUI(STATE.zoneName);}
        clearAllPlayers();clearAllNPCs();
        for(const pl of msg.players)upsertPlayer(this,pl.id,pl.x,pl.y,pl.name,pl.level);
        for(const p of STATE.players.values()){setPlayerVisual(p);setDepth(p,false);}
        if(Array.isArray(msg.npcs))for(const n of msg.npcs)upsertNPC(this,n.id,n.x,n.y,n.name,n.kind,n.hp,n.maxHp);
        for(const n of STATE.npcs.values())setDepth(n,true);
        const me=msg.players.find(pl=>pl.id===STATE.you);
        if(me)maybeSavePos(me.x,me.y);
        return;
      }

      if(msg.t==='ZONE_CHANGE'){
        STATE.zoneId=msg.zoneId;
        STATE.zoneName=msg.zoneName;
        STATE.portals=msg.portals||[];
        STATE.map.w=msg.map.w;STATE.map.h=msg.map.h;
        updateZoneUI(STATE.zoneName);
        closeMigsMenu();
        if(window.LERMA_SAVE_POS)window.LERMA_SAVE_POS(msg.x,msg.y,msg.zoneId);
        clearAllPlayers();clearAllNPCs();
        this.recomputeOrigin();
        fetchZoneMap(this,STATE.zoneId,()=>this.drawTileMap());
        for(const pl of (msg.players||[]))upsertPlayer(this,pl.id,pl.x,pl.y,pl.name,pl.level);
        for(const p of STATE.players.values()){setPlayerVisual(p);setDepth(p,false);}
        if(Array.isArray(msg.npcs))for(const n of msg.npcs)upsertNPC(this,n.id,n.x,n.y,n.name,n.kind,n.hp,n.maxHp);
        for(const n of STATE.npcs.values())setDepth(n,true);
        const zoneTxt=this.add.text(window.innerWidth/2,window.innerHeight/2,`📍 ${msg.zoneName}`,{fontSize:'22px',fontFamily:'system-ui,sans-serif',color:'#a3e635',stroke:'#000',strokeThickness:4,resolution:2}).setOrigin(0.5).setDepth(9999).setScrollFactor(0);
        this.tweens.add({targets:zoneTxt,y:window.innerHeight/2-60,alpha:0,duration:2000,ease:'Power2',onComplete:()=>zoneTxt.destroy()});
        return;
      }

      if(msg.t==='DELTA'){
        if(Array.isArray(msg.rm))for(const id of msg.rm)removePlayer(id);
        if(Array.isArray(msg.up)){for(const u of msg.up){upsertPlayer(this,u.id,u.x,u.y,u.name,u.level);if(u.id===STATE.you)maybeSavePos(u.x,u.y);}}
        for(const p of STATE.players.values()){setPlayerVisual(p);setDepth(p,false);}
        if(Array.isArray(msg.npcUp)){for(const n of msg.npcUp)upsertNPC(this,n.id,n.x,n.y,n.name,n.kind,n.hp,n.maxHp);for(const n of STATE.npcs.values())setDepth(n,true);}
        return;
      }

      if(msg.t==='NPC_HIT'){
        const n=STATE.npcs.get(msg.npcId);if(!n)return;
        n.hp=msg.hp;const pct=Math.max(0,n.hp/n.maxHp);n.hpFill.width=30*pct;
        n.body.setFillStyle(0xff0000);
        setTimeout(()=>{if(n.body)n.body.setFillStyle(NPC_VISUALS[n.kind]?.bodyColor||0xff6eb4);},120);
        spawnDmgNumber(this,n.sprite.x,n.sprite.y,msg.dmg,msg.isCrit?'#ffff00':'#ff4444',msg.isCrit);
        return;
      }

      if(msg.t==='NPC_DIED'){
        const n=STATE.npcs.get(msg.npcId);if(!n)return;
        n.body.setFillStyle(0xffffff);
        this.time.delayedCall(200,()=>removeNPC(msg.npcId));
        return;
      }

      if(msg.t==='NPC_SPAWN'){
        upsertNPC(this,msg.id,msg.x,msg.y,msg.name,msg.kind,msg.hp,msg.maxHp);
        const n=STATE.npcs.get(msg.id);if(n)setDepth(n,true);
        return;
      }

      if(msg.t==='PLAYER_HIT'){
        updatePlayerHpBar(msg.hp,msg.maxHp);
        const me=STATE.players.get(STATE.you);
        if(me){me.sprite.list[0].setFillStyle(0xff4444);me.sprite.list[1].setFillStyle(0xff4444);setTimeout(()=>setPlayerVisual(me),150);spawnDmgNumber(this,me.sprite.x,me.sprite.y,msg.dmg,'#ff9900',false);}
        return;
      }

      if(msg.t==='STATS_UPDATE'){
        renderStatWindow(msg.stats,this.net);
        if(msg.hp!==undefined)updatePlayerHpBar(msg.hp,msg.maxHp);
        if(window.LERMA_SAVE_STATS)window.LERMA_SAVE_STATS(msg.stats);
        return;
      }

      if(msg.t==='EXP_GAIN'){
        const me=STATE.players.get(STATE.you);
        if(me){const txt=this.add.text(me.sprite.x,me.sprite.y-50,`+${msg.amount} EXP`,{fontSize:'11px',fontFamily:'system-ui,sans-serif',color:'#a3e635',stroke:'#000',strokeThickness:2,resolution:2}).setOrigin(0.5,1).setDepth(9999);this.tweens.add({targets:txt,y:me.sprite.y-80,alpha:0,duration:1200,ease:'Power2',onComplete:()=>txt.destroy()});}
        return;
      }

      if(msg.t==='PLAYER_LEVEL_UP'){
        if(msg.playerId===STATE.you){
          const lvlTxt=this.add.text(window.innerWidth/2,window.innerHeight/2,`⭐ LEVEL UP! ⭐\nNow Level ${msg.level}`,{fontSize:'28px',fontFamily:'system-ui,sans-serif',color:'#facc15',stroke:'#000',strokeThickness:4,align:'center',resolution:2}).setOrigin(0.5).setDepth(9999).setScrollFactor(0);
          this.tweens.add({targets:lvlTxt,y:window.innerHeight/2-80,alpha:0,duration:2500,ease:'Power2',onComplete:()=>lvlTxt.destroy()});
        }
        const p=STATE.players.get(msg.playerId);if(p&&p.lvlTag)p.lvlTag.setText(`Lv${msg.level}`);
        return;
      }

      if(msg.t==='MIGS_MENU'){showMigsMenu(msg,this.net);return;}
      if(msg.t==='MIGS_RESPONSE'){showMigsResponse(msg.message);return;}
      if(msg.t==='RESPAWN_UPDATED'){
        if(window.LERMA_USER){window.LERMA_USER.respawnZone=msg.zone;window.LERMA_USER.respawnX=msg.x;window.LERMA_USER.respawnY=msg.y;}
        if(window.LERMA_SAVE_RESPAWN)window.LERMA_SAVE_RESPAWN(msg.zone,msg.x,msg.y);
        return;
      }
    }

    update(_,dtMs){
      const dt=dtMs/1000,FOLLOW=16;
      for(const p of STATE.players.values()){
        p.rx+=(p.tx-p.rx)*Math.min(1,FOLLOW*dt);
        p.ry+=(p.ty-p.ry)*Math.min(1,FOLLOW*dt);
        const s=tileToScreen(p.rx,p.ry);
        p.sprite.x=s.x;p.sprite.y=s.y-6;setDepth(p,false);
      }
      for(const n of STATE.npcs.values()){
        n.rx+=(n.tx-n.rx)*Math.min(1,FOLLOW*0.5*dt);
        n.ry+=(n.ty-n.ry)*Math.min(1,FOLLOW*0.5*dt);
        const s=tileToScreen(n.rx,n.ry);
        n.sprite.x=s.x;n.sprite.y=s.y-4;setDepth(n,true);
      }
      const me=STATE.players.get(STATE.you);
      if(me){
        const s=tileToScreen(me.rx,me.ry);
        this.cameras.main.scrollX+=(s.x-window.innerWidth/2-this.cameras.main.scrollX)*0.1;
        this.cameras.main.scrollY+=(s.y-window.innerHeight/2-this.cameras.main.scrollY)*0.1;
      }
    }
  }

  new Phaser.Game({type:Phaser.AUTO,width:window.innerWidth,height:window.innerHeight,scene:[MainScene]});
})();

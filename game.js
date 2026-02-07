(() => {
  const canvas = document.getElementById("game");
  const ctx = canvas.getContext("2d");

  const uiHearts = document.getElementById("hearts");
  const uiStars  = document.getElementById("stars");
  const uiTime   = document.getElementById("time");
  const btnRestart = document.getElementById("btnRestart");
  const btnMute = document.getElementById("btnMute");

  // Make canvas focusable (helps on some Mac browser setups)
  canvas.tabIndex = 0;
  canvas.addEventListener("pointerdown", () => canvas.focus());

  // ---------- Helpers ----------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------- Input (MAC FRIENDLY) ----------
  const keysDown = new Set();
  const keysPressed = new Set(); // one-frame "tap"

  function normKey(e){
    // Normalize Space
    if (e.key === " ") return "space";
    return e.key.toLowerCase();
  }

  const blockKeys = new Set([
    "arrowup","arrowdown","arrowleft","arrowright","space"
  ]);

  window.addEventListener("keydown", (e) => {
    const k = normKey(e);
    if (blockKeys.has(k)) e.preventDefault(); // stop page scroll on Mac
    if (!keysDown.has(k)) keysPressed.add(k); // edge trigger
    keysDown.add(k);
  }, { passive: false });

  window.addEventListener("keyup", (e) => {
    const k = normKey(e);
    keysDown.delete(k);
  });

  function down(...list){ return list.some(k => keysDown.has(k)); }
  function tap(...list){ return list.some(k => keysPressed.has(k)); }

  // ---------- Tiny synth music ----------
  let audioCtx = null;
  let musicOn = true;
  let musicTimer = 0;

  function ensureAudio(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }

  function beep(freq, dur, type="square", vol=0.02){
    if (!musicOn) return;
    ensureAudio();
    const t0 = audioCtx.currentTime;
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.value = vol;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.stop(t0 + dur + 0.01);
  }

  const sfx = {
    collect(){ beep(880, 0.06, "square", 0.03); beep(1320, 0.05, "square", 0.02); },
    hurt(){ beep(220, 0.11, "sawtooth", 0.03); },
    win(){ beep(660, 0.08, "square", 0.03); beep(880, 0.08, "square", 0.03); beep(1320, 0.10, "square", 0.03); },
    jump(){ beep(920, 0.05, "square", 0.02); },
    dash(){ beep(520, 0.05, "square", 0.02); }
  };

  btnMute.addEventListener("click", () => {
    musicOn = !musicOn;
    btnMute.textContent = `Music: ${musicOn ? "On" : "Off"}`;
  });

  window.addEventListener("pointerdown", () => {
    if (audioCtx && audioCtx.state === "suspended") audioCtx.resume();
  });

  // ---------- Game constants ----------
  const W = canvas.width, H = canvas.height;
  const TILE = 30;
  const GRAV = 2200;
  const FRICTION_GROUND = 0.86;

  const cam = { x: 0, y: 0 };

  // ---------- Level ----------
  const levelCols = 64;
  const levelRows = 18;

  // '.' empty, '1' solid, 's' spikes, 'h' heart, 'e' enemy, '4' portal base
  const mapStr = [
    "................................................................",
    "................................................................",
    "................................................................",
    "...............h...............s...............................P",
    "..............111.............111..............................4",
    "...............................................h...............1",
    ".....................111..........................111..........1",
    ".............e..................................................",
    "..........111111......................s.........................",
    ".....................................111...................h....",
    "..................h.......................111.............111....",
    ".................111............................................",
    "..................................e.............................",
    "......s..............111111...............................e.....",
    ".....111..................................................1111..",
    "..................h.............s...............................",
    "..111............111...........111....................h.........",
    "1111111111111111111111111111111111111111111111111111111111111111",
  ];

  const tiles = Array.from({length: levelRows}, () => Array(levelCols).fill(0));
  const hearts = [];
  const enemies = [];
  let portal = { x: 0, y: 0, w: TILE, h: TILE*2 };

  for (let r=0; r<levelRows; r++){
    for (let c=0; c<levelCols; c++){
      const ch = mapStr[r][c];
      const x = c*TILE, y = r*TILE;
      if (ch === "1") tiles[r][c] = 1;
      if (ch === "s") tiles[r][c] = 3;
      if (ch === "4") { tiles[r][c] = 4; portal = { x, y: y - TILE, w: TILE, h: TILE*2 }; }
      if (ch === "h") hearts.push({ x: x+TILE*0.2, y: y+TILE*0.2, w: TILE*0.6, h: TILE*0.6, taken:false, bob: Math.random()*10 });
      if (ch === "e") enemies.push({ x: x+TILE*0.1, y: y+TILE*0.15, w: TILE*0.8, h: TILE*0.7, vx: (Math.random()>0.5?1:-1)*120, alive:true });
    }
  }

  const worldW = levelCols*TILE;
  const worldH = levelRows*TILE;

  // ---------- Player ----------
  const players = [
    { name:"Luna", colorA:"#ff5ac8", colorB:"#ffd1ef", jumpVel: 780, dashSpeed: 520, dashTime: 0.14 },
    { name:"Rio",  colorA:"#5affd2", colorB:"#d2fff1", jumpVel: 740, dashSpeed: 640, dashTime: 0.12 }
  ];

  const S = {
    active: 0,
    x: TILE*2,
    y: TILE*9,
    w: 22,
    h: 28,
    vx: 0,
    vy: 0,
    onGround: false,
    coyote: 0,
    jumpBuffer: 0,
    dash: 0,
    dashDir: 1,
    invuln: 0,
    hearts: 0,
    stars:  0,
    win: false,
    t0: performance.now(),
    timeSec: 0,
  };

  function reset(){
    S.active = 0;
    S.x = TILE*2; S.y = TILE*9;
    S.vx = 0; S.vy = 0;
    S.onGround = false;
    S.coyote = 0;
    S.jumpBuffer = 0;
    S.dash = 0;
    S.dashDir = 1;
    S.invuln = 0;
    S.hearts = 0;
    S.stars = 0;
    S.win = false;
    S.t0 = performance.now();
    S.timeSec = 0;
    hearts.forEach(h => h.taken = false);
    enemies.forEach(e => { e.alive = true; e.vx = (Math.random()>0.5?1:-1)*120; });
  }
  btnRestart.addEventListener("click", reset);

  // ---------- Collision helpers ----------
  const rects = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;

  function tileAt(px, py){
    const c = Math.floor(px / TILE);
    const r = Math.floor(py / TILE);
    if (c<0 || c>=levelCols || r<0 || r>=levelRows) return 0;
    return tiles[r][c];
  }

  function resolveAxis(axis){
    const pw=S.w, ph=S.h;

    const left = Math.floor(S.x / TILE);
    const right = Math.floor((S.x+pw) / TILE);
    const top = Math.floor(S.y / TILE);
    const bottom = Math.floor((S.y+ph) / TILE);

    for (let r = top-1; r <= bottom+1; r++){
      for (let c = left-1; c <= right+1; c++){
        if (r<0 || c<0 || r>=levelRows || c>=levelCols) continue;
        const t = tiles[r][c];
        if (!(t===1 || t===4)) continue; // solid only

        const tx = c*TILE, ty = r*TILE;
        const a = { x:S.x, y:S.y, w:pw, h:ph };
        const b = { x:tx, y:ty, w:TILE, h:TILE };
        if (!rects(a,b)) continue;

        if (axis === "x"){
          if (S.vx > 0) S.x = tx - pw - 0.01;
          else if (S.vx < 0) S.x = tx + TILE + 0.01;
          S.vx = 0;
        } else {
          if (S.vy > 0){
            S.y = ty - ph - 0.01;
            S.vy = 0;
            S.onGround = true;
            S.coyote = 0.12;
          } else if (S.vy < 0){
            S.y = ty + TILE + 0.01;
            S.vy = 0;
          }
        }
      }
    }
  }

  function checkSpikes(){
    const footY = S.y + S.h;
    const t1 = tileAt(S.x+3, footY);
    const t2 = tileAt(S.x+S.w-3, footY);
    if ((t1===3 || t2===3) && S.invuln<=0) hurt();
  }

  function hurt(){
    sfx.hurt();
    S.invuln = 0.9;
    S.vy = -520;
    S.vx = -S.dashDir*220;
    S.stars = Math.max(0, S.stars-1);
    if (S.stars===0 && S.hearts>0) S.hearts = Math.max(0, S.hearts-1);
    if (S.hearts===0 && S.stars===0){
      S.x = TILE*2; S.y = TILE*9;
      S.vx = 0; S.vy = 0;
    }
  }

  // ---------- Render helpers ----------
  if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x,y,w,h,r){
      r = Math.min(r, w/2, h/2);
      this.beginPath();
      this.moveTo(x+r, y);
      this.arcTo(x+w, y, x+w, y+h, r);
      this.arcTo(x+w, y+h, x, y+h, r);
      this.arcTo(x, y+h, x, y, r);
      this.arcTo(x, y, x+w, y, r);
      this.closePath();
      return this;
    };
  }

  function mosaicBG(){
    const size = 24;
    const ox = -cam.x*0.25, oy = -cam.y*0.18;
    for (let y=-size; y<H+size; y+=size){
      for (let x=-size; x<W+size; x+=size){
        const nx = x+ox, ny = y+oy;
        const v = (Math.sin((nx+ny)*0.01) + Math.sin(nx*0.013) + Math.cos(ny*0.016))*0.5;
        const a = 0.12 + 0.08*Math.abs(v);
        ctx.fillStyle = `rgba(${Math.floor(150+90*Math.sin(nx*0.02))},${Math.floor(140+100*Math.sin(ny*0.018+1))},${Math.floor(170+80*Math.cos((nx+ny)*0.017))},${a})`;
        ctx.fillRect(x,y,size-1,size-1);
      }
    }
  }

  function drawTile(x,y,t){
    const gx=x-cam.x, gy=y-cam.y;
    if (t===1){
      const hue = (x*0.03 + y*0.02) % 360;
      ctx.fillStyle = `hsl(${hue}, 85%, 55%)`;
      ctx.fillRect(gx,gy,TILE,TILE);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fillRect(gx+2,gy+2,TILE-4,TILE-4);
    } else if (t===3){
      ctx.fillStyle = "rgba(255,70,110,0.95)";
      for (let i=0;i<5;i++){
        const sx = gx + i*(TILE/5);
        ctx.beginPath();
        ctx.moveTo(sx, gy+TILE);
        ctx.lineTo(sx+(TILE/10), gy+6);
        ctx.lineTo(sx+(TILE/5), gy+TILE);
        ctx.closePath(); ctx.fill();
      }
    } else if (t===4){
      ctx.fillStyle = "rgba(120,160,255,0.85)";
      ctx.fillRect(gx,gy,TILE,TILE);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(gx+3,gy+3,TILE-6,TILE-6);
    }
  }

  function drawHeart(h){
    const gx=h.x-cam.x, gy=h.y-cam.y;
    const bob = Math.sin(performance.now()*0.004 + h.bob)*4;
    ctx.save();
    ctx.translate(gx+h.w/2, gy+h.h/2 + bob);
    const p=3;
    const shape=[
      "01100110",
      "11111111",
      "11111111",
      "11111111",
      "01111110",
      "00111100",
      "00011000",
    ];
    for (let r=0;r<shape.length;r++){
      for (let c=0;c<shape[r].length;c++){
        if (shape[r][c]==="1"){
          ctx.fillStyle="rgba(255,90,200,0.95)";
          ctx.fillRect((c-4)*p,(r-3)*p,p,p);
          ctx.fillStyle="rgba(255,255,255,0.25)";
          ctx.fillRect((c-4)*p+1,(r-3)*p+1,p-2,p-2);
        }
      }
    }
    ctx.restore();
  }

  function drawPortal(){
    const gx=portal.x-cam.x, gy=portal.y-cam.y;
    const pulse = 0.45 + 0.25*Math.sin(performance.now()*0.004);
    ctx.save();
    ctx.fillStyle = `rgba(140,80,255,${0.25 + pulse*0.15})`;
    ctx.fillRect(gx-8,gy-10,portal.w+16,portal.h+20);
    ctx.fillStyle="rgba(30,10,60,0.55)";
    ctx.fillRect(gx,gy,portal.w,portal.h);
    const grad=ctx.createLinearGradient(gx,gy,gx,gy+portal.h);
    grad.addColorStop(0,"rgba(255,90,200,0.7)");
    grad.addColorStop(0.5,"rgba(90,255,210,0.65)");
    grad.addColorStop(1,"rgba(120,160,255,0.65)");
    ctx.fillStyle=grad;
    ctx.fillRect(gx+4,gy+4,portal.w-8,portal.h-8);
    ctx.fillStyle="rgba(255,255,255,0.9)";
    ctx.font="12px system-ui";
    ctx.fillText("Need 5 ❤", gx-6, gy-14);
    ctx.restore();
  }

  function drawEnemy(e){
    const gx=e.x-cam.x, gy=e.y-cam.y;
    ctx.save();
    ctx.translate(gx+e.w/2, gy+e.h/2);
    const wob = 1+0.06*Math.sin(performance.now()*0.01 + gx*0.01);
    ctx.scale(wob, 1/wob);
    ctx.fillStyle="rgba(255,210,60,0.95)";
    ctx.beginPath(); ctx.roundRect(-e.w/2,-e.h/2,e.w,e.h,10); ctx.fill();
    ctx.fillStyle="rgba(20,20,30,0.85)";
    ctx.fillRect(-6,-2,3,4); ctx.fillRect(3,-2,3,4);
    ctx.restore();
  }

  function drawPlayer(){
    const A = players[S.active];
    const gx=S.x-cam.x, gy=S.y-cam.y;
    const blink = (Math.sin(performance.now()*0.01) > 0.98);
    const inv = S.invuln>0 ? (Math.sin(performance.now()*0.03) > 0 ? 0.35 : 1.0) : 1.0;

    ctx.save();
    ctx.globalAlpha = inv;

    const grad=ctx.createLinearGradient(gx,gy,gx,gy+S.h);
    grad.addColorStop(0, A.colorB);
    grad.addColorStop(1, A.colorA);
    ctx.fillStyle=grad;
    ctx.beginPath(); ctx.roundRect(gx,gy,S.w,S.h,8); ctx.fill();

    ctx.fillStyle="rgba(20,20,30,0.75)";
    ctx.fillRect(gx + (S.dashDir>0? 13:7), gy+10, 3, blink?1:3);
    ctx.fillRect(gx + (S.dashDir>0? 17:11), gy+10, 3, blink?1:3);

    ctx.fillStyle="rgba(255,255,255,0.22)";
    ctx.fillRect(gx+3, gy+4, S.w-6, 3);

    // name bubble
    ctx.globalAlpha = 0.95;
    ctx.fillStyle="rgba(0,0,0,0.25)";
    ctx.beginPath(); ctx.roundRect(gx-6, gy-22, 64, 18, 9); ctx.fill();
    ctx.fillStyle="rgba(255,255,255,0.9)";
    ctx.font="12px system-ui";
    ctx.fillText(A.name, gx+2, gy-9);

    ctx.restore();
  }

  // ---------- Update ----------
  let last = performance.now();

  function update(dt){
    if (!S.win) S.timeSec = (performance.now() - S.t0)/1000;

    const A = players[S.active];

    // Switch character
    if (tap("c")){
      S.active = (S.active + 1) % players.length;
      S.stars++;
      sfx.collect();
    }

    // movement
    const move = (down("a","arrowleft") ? -1 : 0) + (down("d","arrowright") ? 1 : 0);
    if (move !== 0) S.dashDir = move;

    // Jump buffer (mac safe keys)
    if (tap("w","arrowup","space")) S.jumpBuffer = 0.14;
    else S.jumpBuffer = Math.max(0, S.jumpBuffer - dt);

    // coyote
    S.coyote = Math.max(0, S.coyote - dt);

    // dash
    if (tap("shift") && S.dash <= 0 && !S.win){
      S.dash = A.dashTime;
      S.vy = Math.min(S.vy, 60);
      sfx.dash();
    }

    S.onGround = false;

    if (!S.win){
      if (S.dash > 0){
        S.dash -= dt;
        S.vx = A.dashSpeed * S.dashDir;
      } else {
        const target = move * 300;
        S.vx = lerp(S.vx, target, 0.14);
        S.vx *= (S.onGround ? FRICTION_GROUND : 0.98);
      }

      // gravity
      S.vy += GRAV * dt;
      S.vy = Math.min(S.vy, 1400);

      // integrate X
      S.x += S.vx * dt;
      S.x = clamp(S.x, 0, worldW - S.w);
      resolveAxis("x");

      // integrate Y
      S.y += S.vy * dt;
      S.y = clamp(S.y, 0, worldH - S.h);
      resolveAxis("y");

      // ✅ Robust grounded check (after resolving Y)
      const under = tileAt(S.x + S.w/2, S.y + S.h + 2);
      const grounded = S.onGround || S.coyote > 0 || under === 1 || under === 4;

      // ✅ Jump (always works)
      if (S.jumpBuffer > 0 && grounded){
        S.jumpBuffer = 0;
        S.vy = -A.jumpVel;
        S.dash = 0;
        S.coyote = 0;
        sfx.jump();
      }
    }

    // invuln timer
    if (S.invuln > 0) S.invuln -= dt;

    // collect hearts
    for (const h of hearts){
      if (h.taken) continue;
      const a = { x:S.x, y:S.y, w:S.w, h:S.h };
      const b = { x:h.x, y:h.y, w:h.w, h:h.h };
      if (rects(a,b)){
        h.taken = true;
        S.hearts++;
        sfx.collect();
      }
    }

    // enemies
    for (const e of enemies){
      if (!e.alive) continue;

      e.x += e.vx * dt;
      const aheadX = e.vx > 0 ? e.x + e.w + 2 : e.x - 2;
      const footY = e.y + e.h + 2;
      const tAhead = tileAt(aheadX, e.y + e.h*0.6);
      const tFoot  = tileAt(aheadX, footY);

      if (tAhead === 1 || tAhead === 4 || (tFoot !== 1 && tFoot !== 4)) e.vx *= -1;

      if (!S.win && S.invuln <= 0){
        const a = { x:S.x, y:S.y, w:S.w, h:S.h };
        const b = { x:e.x, y:e.y, w:e.w, h:e.h };
        if (rects(a,b)){
          const bottom = S.y + S.h;
          if (S.vy > 0 && bottom - e.y < 16){
            e.alive = false;
            S.vy = -520;
            S.stars += 2;
            sfx.collect();
          } else {
            hurt();
          }
        }
      }
    }

    checkSpikes();

    // win
    if (!S.win){
      const a = { x:S.x, y:S.y, w:S.w, h:S.h };
      const b = { x:portal.x, y:portal.y, w:portal.w, h:portal.h };
      if (rects(a,b) && S.hearts >= 5){
        S.win = true;
        sfx.win();
      }
    }

    // camera
    const cx = S.x + S.w/2;
    const cy = S.y + S.h/2;
    cam.x = clamp(cx - W/2, 0, worldW - W);
    cam.y = clamp(cy - H/2, 0, worldH - H);

    // UI
    uiHearts.textContent = S.hearts;
    uiStars.textContent = S.stars;
    const t = Math.floor(S.timeSec);
    uiTime.textContent = `${Math.floor(t/60)}:${String(t%60).padStart(2,"0")}`;
  }

  // ---------- Draw ----------
  function draw(){
    ctx.clearRect(0,0,W,H);
    ctx.fillStyle="rgba(0,0,0,0.14)";
    ctx.fillRect(0,0,W,H);
    mosaicBG();

    const c0=Math.floor(cam.x/TILE), c1=Math.ceil((cam.x+W)/TILE);
    const r0=Math.floor(cam.y/TILE), r1=Math.ceil((cam.y+H)/TILE);

    for (let r=r0-1;r<=r1+1;r++){
      for (let c=c0-1;c<=c1+1;c++){
        if (r<0||c<0||r>=levelRows||c>=levelCols) continue;
        const t=tiles[r][c];
        if (t) drawTile(c*TILE, r*TILE, t);
      }
    }

    for (const h of hearts) if (!h.taken) drawHeart(h);
    drawPortal();
    for (const e of enemies) if (e.alive) drawEnemy(e);
    drawPlayer();

    if (S.win){
      ctx.save();
      ctx.fillStyle="rgba(0,0,0,0.42)";
      ctx.fillRect(0,0,W,H);
      ctx.fillStyle="rgba(255,255,255,0.92)";
      ctx.font="700 34px system-ui";
      ctx.fillText("YOU MADE IT TOGETHER ✨", 220, 220);
      ctx.fillStyle="rgba(255,255,255,0.78)";
      ctx.font="16px system-ui";
      ctx.fillText(`Hearts: ${S.hearts}   Stars: ${S.stars}`, 360, 260);
      ctx.fillText("Press Restart to play again", 335, 290);
      ctx.restore();
    }
  }

  // ---------- Loop ----------
  function loop(now){
    const dt = Math.min(0.033, (now - last)/1000);
    last = now;

    update(dt);
    // ✅ KEY FIX: clear taps only after update reads them
    keysPressed.clear();

    draw();

    // ambient tiny music
    musicTimer += dt;
    if (musicOn && musicTimer > 0.65 && !S.win){
      musicTimer = 0;
      const base = 262;
      const seq = [0,7,12,16];
      const n = seq[Math.floor((performance.now()/650) % seq.length)];
      beep(base * Math.pow(2, n/12), 0.06, "triangle", 0.012);
    }

    requestAnimationFrame(loop);
  }

  reset();
  requestAnimationFrame(loop);
})();

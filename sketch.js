/*  SINK THE DRUG BOATS (P5) — v0.7.3 (GLOBAL Top10 + UX patches + new GAME OVER copy)
    ✅ GLOBAL Top10 leaderboard via your Apps Script (JSONP)
    ✅ Optimistic leaderboard update (player sees score immediately)
    ✅ Re-fetch leaderboard after 1.2s to avoid Sheets propagation delay
    ✅ Highlight current player in leaderboard (by email)
    ✅ Try auto-start MAIN MENU music on load (will work only when browser allows autoplay)
    ✅ Lead gen click-to-focus exact field (X+Y box hit test)
    ✅ NEW: Game Over message copy (2 lines) replacing "YOU RAN OUT OF AMMO"
    ✅ NEW: Tutorial overlay on first gameplay start (session-only)
    ✅ Everything else unchanged from your v0.7.2 baseline

  IMPORTANT:
  - You MUST include p5.sound in your HTML (p5.sound.min.js) or sounds won't work.
  - Autoplay audio is blocked in many browsers; we try, but first tap may still be required.
*/

const ASSET_DIR = ""; // set "assets/" if needed

const GOOGLE_LEAD_ENDPOINT =
  "https://script.google.com/macros/s/AKfycbxvw8_T9NFUb80Uy6NSiq7obdMZae7yLPInH3zOZRLaMlpoR4Yc-HOhkkUrqeYbD3V1kA/exec";

// ---- Logical resolution ----
const BASE_W = 1920;
const BASE_H = 1080;

// ---- Gameplay baseline ----
const TARGET_SINKS_PER_WAVE = 4; // matches BAR 0..4
const BOAT_HP = 3;               // 3 hits to sink

const POINTS_HIT = 250;
const POINTS_SINK = 1000;

// ---- HUD placement (bottom) ----
const HUD_MARGIN_BOTTOM = 28;
const HUD_SCALE = 1.0;

// ---- Boats scaling/spacing ----
const BOAT_SCALE = 0.70;
const BOAT_MIN_LANE_SEP = 180;
const PLAY_AREA_TOP = 80;
const PLAY_AREA_PAD_BOTTOM = 40;

function getPlayBottomY() {
  return getHudTopYWorld() - PLAY_AREA_PAD_BOTTOM;
}

// ---- Lead gen ----
const LEAD_DEBUG = false;

// ✅ YOUR CORRECTED LEAD_LAYOUT
let LEAD_LAYOUT = {
  first:  { left: 26.5, top: 25.5, width: 42.0, height: 10.0 },
  last:   { left: 26.5, top: 39.0, width: 42.0, height: 10.0 },
  email:  { left: 26.5, top: 53.0, width: 44.0, height: 10.0 },
  submit: { left: 36.0, top: 65.5, width: 28.0, height: 14.0 },
};

function setLeadLayout(partial) {
  LEAD_LAYOUT = {
    ...LEAD_LAYOUT,
    ...partial,
    first:  { ...LEAD_LAYOUT.first,  ...(partial.first  || {}) },
    last:   { ...LEAD_LAYOUT.last,   ...(partial.last   || {}) },
    email:  { ...LEAD_LAYOUT.email,  ...(partial.email  || {}) },
    submit: { ...LEAD_LAYOUT.submit, ...(partial.submit || {}) },
  };
  applyLeadLayout();
}

// ----------------------------------------------------
function assetPath(fileName) { return encodeURI(ASSET_DIR + fileName); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// ----------------------------------------------------
// State
// ----------------------------------------------------
const STATE = { START: "START", LEAD: "LEAD", PLAYING: "PLAYING", GAMEOVER: "GAMEOVER" };
let gameState = STATE.START;

// ----------------------------------------------------
// Assets
// ----------------------------------------------------
let img = {};
let fontPressStart;
let pg;

// Sound assets (p5.sound)
let sfx = {};
let music = {};
let audioUnlocked = false;

// Last render transform for correct pointer mapping
let lastRender = { dx: 0, dy: 0, s: 1, dw: BASE_W, dh: BASE_H };

// ----------------------------------------------------
// Game vars
// ----------------------------------------------------
let boats, effects, popups;
let score = 0, level = 1, wave = 1, ammo = 0, sinksThisWave = 0;

// Game over reason
let gameOverReason = "";

// Lead-per-session (asks again on refresh)
let leadSubmittedThisSession = false;
let currentLead = { first: "", last: "", email: "" };

// Leaderboard (local fallback)
const LB_KEY = "sdb_local_leaderboard_v1";
const LB_MAX = 10;
let leaderboard = [];

// Leaderboard (global)
let globalTop10 = [];
let globalLBLoading = false;
let globalLBLastFetchMs = 0;

// ----------------------------------------------------
// Tutorial overlay (session-only)
// ----------------------------------------------------
let tutorialSeenThisSession = false;
let showTutorialOverlay = false;

const TUTORIAL_LINES = [
  "CLICK / TAP to shoot the boats",
  "Ammo is limited — every shot counts",
  "Sink 4 boats to advance to the next level",
  "Boats get faster as you level up",
  "Tap/Click to start"
];

// ----------------------------------------------------
// Preload
// ----------------------------------------------------
function preload() {
  // Images
  img.background = loadImage(assetPath("BACKGROUND.png"));
  img.firstScreen = loadImage(assetPath("FIRST SCREEN.png"));
  img.startButton = loadImage(assetPath("BUTTON.png"));
  img.leadFull = loadImage(assetPath("FULL LEAD GEN.png"));

  img.bar = {
    0: loadImage(assetPath("BAR 0.png")),
    1: loadImage(assetPath("BAR 1.png")),
    2: loadImage(assetPath("BAR 2.png")),
    3: loadImage(assetPath("BAR 3.png")),
    4: loadImage(assetPath("BAR 4.png")),
  };

  img.boatIdle = [
    loadImage(assetPath("BOAT 1.png")),
    loadImage(assetPath("BOAT 2.png")),
    loadImage(assetPath("BOAT 3.png")),
  ];
  img.boatDamaged = loadImage(assetPath("BOAT DAMAGED.png"));
  img.boatBroken = loadImage(assetPath("BOAT BROKEN.png"));
  img.boatExploded = loadImage(assetPath("BOAT EXPLOTED.png"));

  img.explosionSmall = loadImage(assetPath("EXPLOSION 1.png"));
  img.explosionMedium = loadImage(assetPath("EXPLOSION 2.png"));
  img.explosionBig = loadImage(assetPath("EXPLOSION 3.png"));

  fontPressStart = loadFont(assetPath("PressStart2P-Regular.ttf"));

  // Sounds (requires p5.sound)
  sfx.button = loadSound(assetPath("Button.wav"));
  sfx.shot = loadSound(assetPath("Shot.wav"));
  sfx.hit = loadSound(assetPath("HIT boat.wav"));
  sfx.explosion = loadSound(assetPath("Explosion.wav"));
  sfx.levelup = loadSound(assetPath("LEVEL UP.wav"));
  sfx.gameover = loadSound(assetPath("GAME OVER.wav"));

  music.menu = loadSound(assetPath("MAIN MENU.wav"));
  music.game = loadSound(assetPath("GAMEPLAY.mp3"));
}

// ----------------------------------------------------
// Setup
// ----------------------------------------------------
function setup() {
  createCanvas(windowWidth, windowHeight);
  pixelDensity(1);

  pg = createGraphics(BASE_W, BASE_H);
  pg.pixelDensity(1);
  pg.noSmooth();

  injectFontForDOM();
  initLeadGenUI();

  loadLocalLeaderboard();
  resetGame();

  // Optional prefetch (won't break anything)
  setTimeout(() => fetchGlobalTop10JSONP(true), 600);

  // ✅ Try to start menu music immediately on load (may be blocked by autoplay policies)
  tryAutoStartMenuMusic();
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
  positionLeadGenUI();
}

// ----------------------------------------------------
// Audio helpers
// ----------------------------------------------------
function unlockAudioOnce() {
  if (audioUnlocked) return;
  try { userStartAudio(); } catch (e) {}
  audioUnlocked = true;
  syncMusicToState();
}

function tryAutoStartMenuMusic() {
  // Many browsers block autoplay; we try anyway.
  try {
    userStartAudio();
    audioUnlocked = true;
    syncMusicToState();
  } catch (e) {
    // Will start on first user gesture via unlockAudioOnce()
  }
}

function playSFX(sound, vol = 1.0) {
  if (!audioUnlocked || !sound) return;
  sound.setVolume(vol);
  sound.play();
}

function loopMusic(track, vol = 0.40) {
  if (!audioUnlocked || !track) return;
  track.setVolume(vol);
  if (!track.isPlaying()) track.loop();
}

function stopMusic(track) {
  if (!track) return;
  if (track.isPlaying()) track.stop();
}

function syncMusicToState() {
  if (!audioUnlocked) return;

  if (gameState === STATE.START) {
    stopMusic(music.game);
    loopMusic(music.menu, 0.45);
  } else if (gameState === STATE.LEAD) {
    stopMusic(music.game);
    loopMusic(music.menu, 0.45);
  } else if (gameState === STATE.PLAYING) {
    stopMusic(music.menu);
    loopMusic(music.game, 0.38);
  } else if (gameState === STATE.GAMEOVER) {
    stopMusic(music.game);
    stopMusic(music.menu);
  }
}

// ----------------------------------------------------
// Difficulty model
// ----------------------------------------------------
function ammoForWave(levelN) {
  const minNeeded = TARGET_SINKS_PER_WAVE * BOAT_HP; // 12
  const baseAmmo = minNeeded + 6;                    // 18 at level 1
  const dec = Math.floor((levelN - 1) / 2);
  return Math.max(minNeeded + 1, baseAmmo - dec);
}

function speedRangeForLevel(levelN) {
  const baseMin = 240;
  const baseMax = 340;
  const mult = 1 + 0.10 * Math.min(levelN - 1, 10) + 0.05 * Math.max(0, levelN - 11);
  const min = baseMin * mult;
  const max = baseMax * mult * 1.10;
  return { min, max };
}

function spawnIntervalForLevel(levelN) {
  return clamp(2.1 - levelN * 0.07, 1.1, 2.1);
}

function maxBoatsForLevel(levelN) {
  return clamp(2 + Math.floor((levelN - 1) / 4), 2, 5);
}

// ----------------------------------------------------
// Game flow
// ----------------------------------------------------
function resetGame() {
  boats = new BoatsHandler();
  effects = new EffectsHandler();
  popups = new PointsPopups();

  score = 0;
  level = 1;
  wave = 1;
  gameOverReason = "";
  startWave();
}

function startWave() {
  ammo = ammoForWave(level);
  sinksThisWave = 0;

  boats.clear();
  for (let i = 0; i < 2; i++) boats.spawnBoat(true);
}

function nextWave() {
  wave += 1;
  level += 1;
  playSFX(sfx.levelup, 0.9);
  startWave();
}

// ----------------------------------------------------
// Draw loop
// ----------------------------------------------------
function draw() {
  const dt = deltaTime / 1000;

  pg.push();
  pg.clear();
  pg.noSmooth();

  drawBackground();

  if (gameState === STATE.START) {
    drawStartScreen();
  } else if (gameState === STATE.LEAD) {
    drawLeadBackdrop();
  } else if (gameState === STATE.PLAYING) {
    updatePlaying(dt);
    drawPlaying();
  } else if (gameState === STATE.GAMEOVER) {
    drawGameOver();
  }

  pg.pop();
  renderToScreenFit(pg);
}

function drawBackground() {
  if (img.background) pg.image(img.background, 0, 0, BASE_W, BASE_H);
  else pg.background(0);
}

function updatePlaying(dt) {
  boats.update(dt);
  effects.update(dt);
  popups.update(dt);

  if (sinksThisWave >= TARGET_SINKS_PER_WAVE) nextWave();

  if (ammo <= 0 && sinksThisWave < TARGET_SINKS_PER_WAVE) {
    gameOverReason = "OUT_OF_AMMO";
    setState(STATE.GAMEOVER);
    playSFX(sfx.gameover, 0.95);

    // Save local + submit global + show instantly + fetch global top10
    pushLocalScore();
    submitGlobalScore();

    // ✅ optimistic update so player sees their score immediately
    optimisticInsertIntoGlobalTop10();

    // ✅ fetch now + re-fetch after 1.2s (Sheets propagation)
    fetchGlobalTop10JSONP(true);
    setTimeout(() => fetchGlobalTop10JSONP(true), 1200);
  }
}

function drawPlaying() {
  boats.draw(pg);
  effects.draw(pg);
  popups.draw(pg);
  drawHUD();

  if (showTutorialOverlay) drawTutorialOverlay();
}

function drawStartScreen() {
  if (img.firstScreen) pg.image(img.firstScreen, 0, 0, BASE_W, BASE_H);
  const r = getStartButtonRect();
  if (img.startButton) pg.image(img.startButton, r.x, r.y, r.w, r.h);
}

function getStartButtonRect() {
  const w = 780;
  const h = 150;
  const x = (BASE_W - w) / 2;
  const y = BASE_H * 0.78;
  return { x, y, w, h };
}

function drawLeadBackdrop() {
  if (img.firstScreen) pg.image(img.firstScreen, 0, 0, BASE_W, BASE_H);
  pg.fill(0, 170);
  pg.rect(0, 0, BASE_W, BASE_H);
}

function drawGameOver() {
  pg.fill(0, 185);
  pg.rect(0, 0, BASE_W, BASE_H);

  pg.textFont(fontPressStart);
  pg.textAlign(CENTER, CENTER);

  pg.fill(255);
  pg.textSize(44);
  pg.text("GAME OVER", BASE_W / 2, BASE_H * 0.30);

  // ✅ NEW COPY (2 lines)
  pg.textSize(16);
  pg.fill(255, 220, 0);
  if (gameOverReason === "OUT_OF_AMMO") {
    pg.text("Madison Cawthorn: Great shooting!", BASE_W / 2, BASE_H * 0.375);
    pg.text("You've saved thousands of Americans from deadly poison!", BASE_W / 2, BASE_H * 0.405);
  }

  pg.textSize(18);
  pg.fill(255, 220, 0);
  pg.text(`SCORE ${score}`, BASE_W / 2, BASE_H * 0.46);
  pg.text(`TAP TO PLAY AGAIN`, BASE_W / 2, BASE_H * 0.54);

  drawLeaderboardPanel();
}

// ----------------------------------------------------
// Tutorial overlay drawing
// ----------------------------------------------------
function drawTutorialOverlay() {
  pg.push();

  pg.noStroke();
  pg.fill(0, 200);
  pg.rect(0, 0, BASE_W, BASE_H);

  const cardW = 1120;
  const cardH = 360;
  const x = (BASE_W - cardW) / 2;
  const y = (BASE_H - cardH) / 2;

  pg.fill(0, 180);
  pg.rect(x, y, cardW, cardH, 18);

  pg.textFont(fontPressStart);
  pg.textAlign(CENTER, TOP);

  pg.fill(255);
  pg.textSize(28);
  pg.text("HOW TO PLAY", BASE_W / 2, y + 34);

  pg.textSize(16);
  pg.fill(255, 220, 0);

  const startY = y + 110;
  const lineH = 34;

  for (let i = 0; i < TUTORIAL_LINES.length; i++) {
    pg.text(TUTORIAL_LINES[i], BASE_W / 2, startY + i * lineH);
  }

  pg.pop();
}

// ----------------------------------------------------
// Leaderboard panel (GLOBAL TOP 10, fallback local) + highlight current player
// ----------------------------------------------------
function drawLeaderboardPanel() {
  const panelW = 820;
  const panelH = 360;
  const x = (BASE_W - panelW) / 2;
  const y = BASE_H * 0.62;

  pg.push();
  pg.noStroke();
  pg.fill(0, 190);
  pg.rect(x, y, panelW, panelH, 16);

  pg.textFont(fontPressStart);
  pg.textAlign(LEFT, TOP);
  pg.fill(255);
  pg.textSize(20);
  pg.text("LEADERBOARD", x + 26, y + 22);

  pg.textSize(14);
  pg.fill(255, 220, 0);
  pg.text("TOP SCORES (GLOBAL)", x + 26, y + 60);

  const list = (globalTop10 && globalTop10.length) ? globalTop10 : leaderboard;

  const startY = y + 96;
  const rowH = 26;

  if (!list.length) {
    pg.textSize(14);
    pg.fill(255);
    pg.text("Loading top scores...", x + 26, startY);
    pg.pop();
    return;
  }

  const myEmail = String(currentLead.email || "").trim().toLowerCase();

  for (let i = 0; i < Math.min(list.length, LB_MAX); i++) {
    const r = list[i];
    const lineY = startY + i * rowH;

    const rank = String(i + 1).padStart(2, "0");
    const name = (String(r.first || "").toUpperCase() + " " + String(r.last || "").toUpperCase()).trim();
    const safeName = name ? name : "PLAYER";
    const pts = String(r.score || 0);

    const isMe = myEmail && (String(r.email || "").trim().toLowerCase() === myEmail);

    // highlight current player (no assets): arrow + cyan-ish text + subtle row backing
    if (isMe) {
      pg.noStroke();
      pg.fill(0, 255, 255, 40);
      pg.rect(x + 18, lineY - 2, panelW - 36, rowH - 2, 8);
    }

    pg.textSize(14);
    pg.fill(isMe ? color(0, 255, 255) : 255);
    const prefix = isMe ? "> " : "";
    pg.text(`${prefix}${rank}. ${safeName}`, x + 26, lineY);

    pg.textAlign(RIGHT, TOP);
    pg.fill(isMe ? color(0, 255, 255) : color(255, 220, 0));
    pg.text(pts, x + panelW - 26, lineY);

    pg.textAlign(LEFT, TOP);
  }

  pg.pop();
}

// ----------------------------------------------------
// HUD bottom (BAR 0..4) + your final future defaults
// ----------------------------------------------------
function drawHUD() {
  const idx = clamp(sinksThisWave, 0, 4);
  const barImg = img.bar[idx];
  if (!barImg) return;

  const w = barImg.width * HUD_SCALE;
  const h = barImg.height * HUD_SCALE;

  const x = (BASE_W - w) / 2;
  const y = BASE_H - HUD_MARGIN_BOTTOM - h;

  pg.image(barImg, x, y, w, h);

  pg.textFont(fontPressStart);
  pg.textAlign(LEFT, CENTER);
  pg.noStroke();

  pg.textSize(26);

  drawHUDText(String(ammo),  x + w * 0.10, y + h * 0.40);
  drawHUDText(String(level), x + w * 0.62, y + h * 0.40);
  drawHUDText(String(score), x + w * 0.79, y + h * 0.55);
}

function drawHUDText(str, x, y) {
  pg.fill(0, 220);
  pg.text(str, x + 2, y + 2);
  pg.fill(255);
  pg.text(str, x, y);
}

function getHudTopYWorld() {
  const idx = clamp(sinksThisWave, 0, 4);
  const barImg = img.bar[idx];
  if (!barImg) return BASE_H;
  const h = barImg.height * HUD_SCALE;
  return BASE_H - HUD_MARGIN_BOTTOM - h;
}

// ----------------------------------------------------
// Render without stretching (FIT + letterbox)
// ----------------------------------------------------
function renderToScreenFit(buffer) {
  const sx = width / BASE_W;
  const sy = height / BASE_H;
  const s = Math.min(sx, sy);

  const dw = BASE_W * s;
  const dh = BASE_H * s;

  const dx = (width - dw) / 2;
  const dy = (height - dh) / 2;

  lastRender = { dx, dy, s, dw, dh };

  background(0);
  image(buffer, dx, dy, dw, dh);
}

// ----------------------------------------------------
// Input mapping
// ----------------------------------------------------
function screenToWorld(sx, sy) {
  const { dx, dy, s } = lastRender;
  const wx = (sx - dx) / s;
  const wy = (sy - dy) / s;
  return { x: clamp(wx, 0, BASE_W), y: clamp(wy, 0, BASE_H) };
}

// ----------------------------------------------------
// State transitions
// ----------------------------------------------------
function setState(next) {
  if (gameState === next) return;
  gameState = next;
  syncMusicToState();

  // ✅ tutorial: show once per session when gameplay starts
  if (gameState === STATE.PLAYING && !tutorialSeenThisSession) {
    showTutorialOverlay = true;
  }
}

// ----------------------------------------------------
// Input handlers
// ----------------------------------------------------
function mousePressed() { handlePrimaryPress(mouseX, mouseY); return false; }
function touchStarted() { handlePrimaryPress(mouseX, mouseY); return false; }

function handlePrimaryPress(sx, sy) {
  unlockAudioOnce();
  const { x, y } = screenToWorld(sx, sy);

  if (gameState === STATE.START) {
    const r = getStartButtonRect();
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
      playSFX(sfx.button, 0.85);

      // Lead asked again on refresh, but NOT on Play Again.
      if (leadSubmittedThisSession) {
        closeLeadGenIfOpen();
        setState(STATE.PLAYING);
      } else {
        openLeadGen();
      }
    }
    return;
  }

  if (gameState === STATE.GAMEOVER) {
    playSFX(sfx.button, 0.8);
    resetGame();
    setState(STATE.START);
    return;
  }

  if (gameState !== STATE.PLAYING) return;

  // ✅ tutorial consumes first tap/click so we don't shoot immediately
  if (showTutorialOverlay) {
    showTutorialOverlay = false;
    tutorialSeenThisSession = true;
    return;
  }

  if (y > getHudTopYWorld()) return;
  if (ammo <= 0) return;

  ammo -= 1;
  playSFX(sfx.shot, 0.75);

  const hitBoat = boats.hitTest(x, y);
  if (hitBoat) {
    const result = hitBoat.applyHit();
    if (result === "HIT") {
      score += POINTS_HIT;
      playSFX(sfx.hit, 0.85);
      effects.spawnExplosion(x, y, "small");
      popups.spawn(x, y, `+${POINTS_HIT}`);
    } else if (result === "SINK") {
      score += POINTS_SINK;
      sinksThisWave += 1;
      playSFX(sfx.explosion, 0.9);
      effects.spawnExplosion(x, y, "big");
      popups.spawn(x, y, `+${POINTS_SINK}`);
    }
  } else {
    effects.spawnSplash(x, y);
  }
}

// ----------------------------------------------------
// Boats (BOTTOM -> TOP)
// ----------------------------------------------------
class Boat {
  constructor() {
    const sp = speedRangeForLevel(level);
    this.vy = -random(sp.min, sp.max);
    this.vx = random(-25, 25);

    const playBottom = getPlayBottomY();
    this.y = playBottom + random(120, 260);

    const marginX = 240;
    this.x = random(marginX, BASE_W - marginX);

    this.hp = BOAT_HP;
    this.idleImg = random(img.boatIdle);
    this.scale = BOAT_SCALE;

    this.sinkT = 0;
    this.dead = false;
  }

  getImage() {
    if (this.dead) return null;
    if (this.sinkT > 0) return img.boatExploded;
    if (this.hp === 3) return this.idleImg;
    if (this.hp === 2) return img.boatDamaged;
    if (this.hp === 1) return img.boatBroken;
    return img.boatExploded;
  }

  hitTest(px, py) {
    const im = this.getImage() || this.idleImg;
    const w = im.width * this.scale;
    const h = im.height * this.scale;
    const left = this.x - w / 2;
    const top = this.y - h / 2;
    return px >= left && px <= left + w && py >= top && py <= top + h;
  }

  applyHit() {
    if (this.dead || this.sinkT > 0) return null;
    this.hp = Math.max(0, this.hp - 1);
    if (this.hp > 0) return "HIT";
    this.sinkT = 0.35;
    return "SINK";
  }

  update(dt) {
    if (this.dead) return;

    if (this.sinkT > 0) {
      this.sinkT -= dt;
      if (this.sinkT <= 0) this.dead = true;
      return;
    }

    this.y += this.vy * dt;
    this.x += this.vx * dt;

    const marginX = 220;
    this.x = clamp(this.x, marginX, BASE_W - marginX);

    if (this.y < PLAY_AREA_TOP - 220) this.dead = true;
  }

  draw(g) {
    if (this.dead) return;
    const im = this.getImage();
    if (!im) return;

    const w = im.width * this.scale;
    const h = im.height * this.scale;

    g.push();
    g.imageMode(CENTER);
    g.noSmooth();
    g.image(im, this.x, this.y, w, h);
    g.pop();
  }
}

class BoatsHandler {
  constructor() {
    this.list = [];
    this.spawnCooldown = 0;
  }

  clear() {
    this.list = [];
    this.spawnCooldown = 0;
  }

  spawnBoat(isInitial = false) {
    for (let attempt = 0; attempt < 16; attempt++) {
      const b = new Boat();
      if (this.isSpawnValid(b) || isInitial) { this.list.push(b); return; }
    }
    this.list.push(new Boat());
  }

  isSpawnValid(candidate) {
    for (const b of this.list) {
      const dy = Math.abs(b.y - candidate.y);
      const dx = Math.abs(b.x - candidate.x);
      if (dy < BOAT_MIN_LANE_SEP && dx < 220) return false;
    }
    return true;
  }

  update(dt) {
    this.spawnCooldown -= dt;

    const maxBoats = maxBoatsForLevel(level);
    if (this.spawnCooldown <= 0 && this.list.length < maxBoats) {
      this.spawnBoat(false);
      this.spawnCooldown = spawnIntervalForLevel(level);
    }

    for (const b of this.list) b.update(dt);
    this.list = this.list.filter((b) => !b.dead);

    if (this.list.length === 0 && gameState === STATE.PLAYING && sinksThisWave < TARGET_SINKS_PER_WAVE) {
      this.spawnCooldown = Math.min(this.spawnCooldown, 0.25);
    }
  }

  draw(g) { for (const b of this.list) b.draw(g); }

  hitTest(x, y) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      if (this.list[i].hitTest(x, y)) return this.list[i];
    }
    return null;
  }
}

// ----------------------------------------------------
// Effects
// ----------------------------------------------------
class EffectsHandler {
  constructor() { this.explosions = []; this.splashes = []; }

  spawnExplosion(x, y, size) {
    const im =
      size === "big" ? img.explosionBig :
      size === "medium" ? img.explosionMedium :
      img.explosionSmall;

    this.explosions.push({
      x, y, im,
      t: 0.25, life: 0.25,
      scale: size === "big" ? 0.95 : 0.70
    });
  }

  spawnSplash(x, y) { this.splashes.push({ x, y, t: 0.15, life: 0.15 }); }

  update(dt) {
    for (const e of this.explosions) e.t -= dt;
    this.explosions = this.explosions.filter((e) => e.t > 0);

    for (const s of this.splashes) s.t -= dt;
    this.splashes = this.splashes.filter((s) => s.t > 0);
  }

  draw(g) {
    for (const e of this.explosions) {
      const a = clamp(e.t / e.life, 0, 1);
      g.push();
      g.imageMode(CENTER);
      g.noSmooth();
      g.tint(255, 255 * a);
      g.image(e.im, e.x, e.y, e.im.width * e.scale, e.im.height * e.scale);
      g.noTint();
      g.pop();
    }

    for (const s of this.splashes) {
      const a = clamp(s.t / s.life, 0, 1);
      g.push();
      g.noStroke();
      g.fill(180, 220, 255, 190 * a);
      g.circle(s.x, s.y, 14);
      g.pop();
    }
  }
}

// ----------------------------------------------------
// Points popups
// ----------------------------------------------------
class PointsPopups {
  constructor() { this.list = []; }

  spawn(x, y, text) { this.list.push({ x, y, text, vy: -40, t: 0.9, life: 0.9 }); }

  update(dt) {
    for (const p of this.list) { p.t -= dt; p.y += p.vy * dt; }
    this.list = this.list.filter((p) => p.t > 0);
  }

  draw(g) {
    g.textFont(fontPressStart);
    g.textAlign(CENTER, CENTER);

    for (const p of this.list) {
      const a = clamp(p.t / p.life, 0, 1);
      g.push();
      g.textSize(16);
      g.fill(0, 210 * a);
      g.text(p.text, p.x + 2, p.y + 2);
      g.fill(255, 220, 0, 255 * a);
      g.text(p.text, p.x, p.y);
      g.pop();
    }
  }
}

// ----------------------------------------------------
// Local Leaderboard (fallback)
// ----------------------------------------------------
function loadLocalLeaderboard() {
  try {
    const raw = localStorage.getItem(LB_KEY);
    leaderboard = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(leaderboard)) leaderboard = [];
  } catch (e) {
    leaderboard = [];
  }
}

function saveLocalLeaderboard() {
  try { localStorage.setItem(LB_KEY, JSON.stringify(leaderboard)); } catch (e) {}
}

function pushLocalScore() {
  const first = (currentLead.first || "").trim();
  const last  = (currentLead.last || "").trim();
  const email = (currentLead.email || "").trim();
  const entry = { ts: Date.now(), first, last, email, score, level };

  leaderboard.push(entry);
  leaderboard.sort((a, b) => (b.score - a.score) || (a.ts - b.ts));
  leaderboard = leaderboard.slice(0, LB_MAX);
  saveLocalLeaderboard();
}

// ----------------------------------------------------
// GLOBAL Leaderboard (submit + JSONP fetch top10)
// ----------------------------------------------------
function submitGlobalScore() {
  const first = (currentLead.first || "").trim();
  const last  = (currentLead.last || "").trim();
  const email = (currentLead.email || "").trim();
  if (!first || !last || !email) return;

  const params = new URLSearchParams();
  params.append("first", first);
  params.append("last", last);
  params.append("email", email);
  params.append("score", String(score));
  params.append("level", String(level));
  params.append("platform", "web");
  params.append("userAgent", navigator.userAgent || "");

  fetch(GOOGLE_LEAD_ENDPOINT, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
    body: params.toString(),
  }).catch(() => {});
}

// ✅ optimistic insert: show player score immediately in the global list
function optimisticInsertIntoGlobalTop10() {
  const first = (currentLead.first || "").trim();
  const last  = (currentLead.last || "").trim();
  const email = (currentLead.email || "").trim();
  if (!first || !last || !email) return;

  const entry = {
    ts: new Date().toISOString(),
    first,
    last,
    email,
    score: Number(score || 0),
    level: Number(level || 0)
  };

  const merged = Array.isArray(globalTop10) ? globalTop10.slice() : [];
  const key = email.toLowerCase();

  let replaced = false;
  for (let i = 0; i < merged.length; i++) {
    const e = merged[i];
    if (String(e.email || "").trim().toLowerCase() === key) {
      if (Number(entry.score) > Number(e.score || 0)) merged[i] = entry;
      replaced = true;
      break;
    }
  }
  if (!replaced) merged.push(entry);

  merged.sort((a, b) => Number(b.score || 0) - Number(a.score || 0));
  globalTop10 = merged.slice(0, 10);
}

function fetchGlobalTop10JSONP(force = false) {
  const now = Date.now();
  if (globalLBLoading) return;
  if (!force && (now - globalLBLastFetchMs < 6000)) return;
  globalLBLoading = true;
  globalLBLastFetchMs = now;

  const cbName = "__sdbLeaderboardCB_" + Math.floor(Math.random() * 1e9);

  window[cbName] = function(payload) {
    try {
      if (payload && payload.ok && Array.isArray(payload.items)) {
        globalTop10 = payload.items.slice(0, 10);
      }
    } finally {
      globalLBLoading = false;
      try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
    }
  };

  const url =
    GOOGLE_LEAD_ENDPOINT +
    "?action=leaderboard&limit=10&mode=best&callback=" +
    encodeURIComponent(cbName) +
    "&_ts=" + now;

  const s = document.createElement("script");
  s.src = url;
  s.async = true;
  s.onerror = () => {
    globalLBLoading = false;
    try { delete window[cbName]; } catch(e) { window[cbName] = undefined; }
  };
  document.body.appendChild(s);
  setTimeout(() => { try { s.remove(); } catch(e) {} }, 8000);
}

// ----------------------------------------------------
// Lead Gen (DOM) — click-to-focus uses X+Y box hit test
// ----------------------------------------------------
let leadOverlay, leadCard;
let leadFirst, leadLast, leadEmail;
let leadSubmit, leadMsg;

function injectFontForDOM() {
  const style = document.createElement("style");
  style.innerHTML = `
    @font-face {
      font-family: "PressStart2P";
      src: url("${assetPath("PressStart2P-Regular.ttf")}") format("truetype");
      font-display: swap;
    }
    .ps2p { font-family: "PressStart2P", monospace; }
  `;
  document.head.appendChild(style);
}

function initLeadGenUI() {
  leadOverlay = createDiv("");
  leadOverlay.style("position", "fixed");
  leadOverlay.style("left", "0");
  leadOverlay.style("top", "0");
  leadOverlay.style("width", "100vw");
  leadOverlay.style("height", "100vh");
  leadOverlay.style("display", "none");
  leadOverlay.style("align-items", "center");
  leadOverlay.style("justify-content", "center");
  leadOverlay.style("background", "rgba(0,0,0,0.55)");
  leadOverlay.style("z-index", "9999");
  leadOverlay.style("overflow", "hidden");
  leadOverlay.style("pointer-events", "auto");

  leadCard = createDiv("");
  leadCard.parent(leadOverlay);
  leadCard.style("position", "relative");
  leadCard.style("background-image", `url("${assetPath("FULL LEAD GEN.png")}")`);
  leadCard.style("background-repeat", "no-repeat");
  leadCard.style("background-position", "center");
  leadCard.style("background-size", "contain");
  leadCard.style("pointer-events", "auto");

  leadFirst = createInput("");
  leadLast = createInput("");
  leadEmail = createInput("");

  const fields = [leadFirst, leadLast, leadEmail];
  for (const el of fields) {
    el.parent(leadCard);
    el.addClass("ps2p");
    el.style("position", "absolute");
    el.style("background", "transparent");
    el.style("border", "none");
    el.style("outline", "none");
    el.style("padding", "10px 12px");
    el.style("font-size", "18px");
    el.style("color", "#0b0b0b");
    el.style("z-index", "3");
    el.style("pointer-events", "auto");
  }

  leadEmail.attribute("type", "email");
  leadEmail.attribute("inputmode", "email");

  leadFirst.elt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); leadLast.elt.focus(); }
  });
  leadLast.elt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); leadEmail.elt.focus(); }
  });
  leadEmail.elt.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); onSubmitLead(); }
  });

  // ✅ Click-to-focus (X+Y box hit test)
  leadCard.elt.addEventListener("pointerdown", (e) => {
    unlockAudioOnce();

    const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "button") return;

    const rect = leadCard.elt.getBoundingClientRect();
    const localX = e.clientX - rect.left;
    const localY = e.clientY - rect.top;

    const xPct = (localX / rect.width) * 100;
    const yPct = (localY / rect.height) * 100;

    const inBox = (box) =>
      xPct >= box.left &&
      xPct <= box.left + box.width &&
      yPct >= box.top &&
      yPct <= box.top + box.height;

    if (inBox(LEAD_LAYOUT.first)) { leadFirst.elt.focus(); return; }
    if (inBox(LEAD_LAYOUT.last))  { leadLast.elt.focus();  return; }
    if (inBox(LEAD_LAYOUT.email)) { leadEmail.elt.focus(); return; }

    if (yPct < LEAD_LAYOUT.last.top) leadFirst.elt.focus();
    else if (yPct < LEAD_LAYOUT.email.top) leadLast.elt.focus();
    else leadEmail.elt.focus();
  });

  leadSubmit = createButton("");
  leadSubmit.parent(leadCard);
  leadSubmit.style("position", "absolute");
  leadSubmit.style("background", "transparent");
  leadSubmit.style("border", "none");
  leadSubmit.style("cursor", "pointer");
  leadSubmit.style("z-index", "4");
  leadSubmit.style("pointer-events", "auto");
  leadSubmit.mousePressed(() => {
    unlockAudioOnce();
    playSFX(sfx.button, 0.85);
    onSubmitLead();
  });

  if (LEAD_DEBUG) {
    leadFirst.style("outline", "2px solid rgba(0,255,0,0.6)");
    leadLast.style("outline", "2px solid rgba(0,255,0,0.6)");
    leadEmail.style("outline", "2px solid rgba(0,255,0,0.6)");
    leadSubmit.style("outline", "2px solid rgba(255,255,0,0.6)");
  }

  leadMsg = createDiv("");
  leadMsg.parent(leadOverlay);
  leadMsg.style("position", "fixed");
  leadMsg.style("left", "0");
  leadMsg.style("right", "0");
  leadMsg.style("bottom", "22px");
  leadMsg.style("text-align", "center");
  leadMsg.style("font-family", "system-ui, sans-serif");
  leadMsg.style("font-size", "14px");
  leadMsg.style("color", "#fff");
  leadMsg.style("z-index", "10000");
  leadMsg.html("");

  positionLeadGenUI();
  applyLeadLayout();
}

function positionLeadGenUI() {
  if (!leadCard) return;
  const w = Math.min(windowWidth * 0.92, 1080);
  const h = w * 0.58;
  leadCard.style("width", `${w}px`);
  leadCard.style("height", `${h}px`);
  applyLeadLayout();
}

function pct(v) { return `${v}%`; }

function applyLeadLayout() {
  if (!leadCard || !leadFirst) return;

  leadFirst.style("left", pct(LEAD_LAYOUT.first.left));
  leadFirst.style("top", pct(LEAD_LAYOUT.first.top));
  leadFirst.style("width", pct(LEAD_LAYOUT.first.width));
  leadFirst.style("height", pct(LEAD_LAYOUT.first.height));

  leadLast.style("left", pct(LEAD_LAYOUT.last.left));
  leadLast.style("top", pct(LEAD_LAYOUT.last.top));
  leadLast.style("width", pct(LEAD_LAYOUT.last.width));
  leadLast.style("height", pct(LEAD_LAYOUT.last.height));

  leadEmail.style("left", pct(LEAD_LAYOUT.email.left));
  leadEmail.style("top", pct(LEAD_LAYOUT.email.top));
  leadEmail.style("width", pct(LEAD_LAYOUT.email.width));
  leadEmail.style("height", pct(LEAD_LAYOUT.email.height));

  leadSubmit.style("left", pct(LEAD_LAYOUT.submit.left));
  leadSubmit.style("top", pct(LEAD_LAYOUT.submit.top));
  leadSubmit.style("width", pct(LEAD_LAYOUT.submit.width));
  leadSubmit.style("height", pct(LEAD_LAYOUT.submit.height));
}

function openLeadGen() {
  setState(STATE.LEAD);
  document.body.style.overflow = "hidden";
  leadOverlay.style("display", "flex");
  leadMsg.html("");
  setTimeout(() => leadFirst.elt.focus(), 80);
}

function closeLeadGenIfOpen() {
  if (!leadOverlay) return;
  leadOverlay.style("display", "none");
  document.body.style.overflow = "auto";
}

function closeLeadGenAndStart() {
  closeLeadGenIfOpen();
  setState(STATE.PLAYING);
}

async function onSubmitLead() {
  const firstName = (leadFirst.value() || "").trim();
  const lastName  = (leadLast.value() || "").trim();
  const email     = (leadEmail.value() || "").trim();

  if (!firstName || !lastName || !email) {
    leadMsg.html("Please complete all fields.");
    return;
  }
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    leadMsg.html("Please enter a valid email.");
    return;
  }

  leadSubmit.attribute("disabled", "");
  leadMsg.html("Submitting...");

  const params = new URLSearchParams();
  params.append("first", firstName);
  params.append("last", lastName);
  params.append("email", email);
  params.append("platform", "web");
  params.append("userAgent", navigator.userAgent || "");

  try {
    await fetch(GOOGLE_LEAD_ENDPOINT, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8" },
      body: params.toString(),
    });
  } catch (e) {
    leadMsg.html("Error submitting. Please try again.");
    leadSubmit.removeAttribute("disabled");
    return;
  }

  // ✅ SESSION-ONLY FLAG (asks again on refresh)
  leadSubmittedThisSession = true;
  currentLead = { first: firstName, last: lastName, email: email };

  leadMsg.html("Submitted!");
  setTimeout(() => {
    leadSubmit.removeAttribute("disabled");
    closeLeadGenAndStart();
  }, 250);
}

// ----------------------------------------------------
// Initial music state + tutorial keyboard close
// ----------------------------------------------------
function keyPressed() {
  unlockAudioOnce();
  if (gameState === STATE.PLAYING && showTutorialOverlay) {
    showTutorialOverlay = false;
    tutorialSeenThisSession = true;
  }
}

function mouseClicked() { unlockAudioOnce(); }
setTimeout(() => syncMusicToState(), 0);

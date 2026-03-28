import Phaser from 'phaser';
import './style.css';

type Vec2 = { x: number; y: number };

type PaddleId = 'left' | 'right';

type PaddleState = {
  id: PaddleId;
  body: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  touchId: number | null;
  homeX: number;
  homeY: number;
  half: PaddleId;
  grabOffsetX: number;
  grabOffsetY: number;
  lastTargetX: number;
  lastTargetY: number;
};

type ScoreState = {
  left: number;
  right: number;
};

type FireworkParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: number;
  size: number;
};

const WORLD = {
  width: 1920,
  height: 1080,
  inset: 56,
  goalWidth: 300,
  goalDepth: 28,
  paddleRadius: 86,
  puckRadius: 40,
  maxTouches: 2,
  drag: 0.00008,
  wallDamping: 0.92,
  paddleReturnLerp: 0.12,
  paddleHitBoost: 1.08,
  paddleHitInfluence: 1.15,
  paddleSpeedClamp: 3400,
  puckMinSpeed: 320,
  puckMaxSpeed: 3000,
  puckServeSpeed: 980,
  goalPauseMs: 1350,
  touchSmoothing: 0.34,
};

class AirpuckScene extends Phaser.Scene {
  private stars: Phaser.GameObjects.Arc[] = [];
  private rink!: Phaser.GameObjects.Graphics;
  private puck!: Phaser.GameObjects.Arc;
  private puckGlow!: Phaser.GameObjects.Arc;
  private puckTrail!: Phaser.GameObjects.Graphics;
  private fireworksGraphics!: Phaser.GameObjects.Graphics;
  private paddles!: Record<PaddleId, PaddleState>;
  private score: ScoreState = { left: 0, right: 0 };
  private scoreText!: Phaser.GameObjects.Text;
  private subtitleText!: Phaser.GameObjects.Text;
  private menuContainer!: Phaser.GameObjects.Container;
  private fullscreenButton!: Phaser.GameObjects.Container;
  private menuVisible = false;
  private goalFreeze = false;
  private activePointerIds = new Set<number>();
  private puckVelocity: Vec2 = { x: 0, y: 0 };
  private puckLastPositions: Vec2[] = [];
  private fireworks: FireworkParticle[] = [];

  constructor() {
    super('airpuck');
  }

  create() {
    this.cameras.main.setBackgroundColor('#050816');
    this.createBackdrop();
    this.createRink();
    this.createEntities();
    this.createUi();
    this.registerInput();
    this.scale.on('resize', this.handleResize, this);
    this.handleResize();
    this.resetRound(Phaser.Math.Between(0, 1) === 0 ? 'left' : 'right');
  }

  private createBackdrop() {
    for (let i = 0; i < 120; i += 1) {
      const star = this.add.circle(
        Phaser.Math.Between(0, WORLD.width),
        Phaser.Math.Between(0, WORLD.height),
        Phaser.Math.FloatBetween(1, 3),
        Phaser.Display.Color.GetColor(
          Phaser.Math.Between(180, 255),
          Phaser.Math.Between(180, 255),
          255,
        ),
        Phaser.Math.FloatBetween(0.25, 0.85),
      );
      this.stars.push(star);
    }
  }

  private createRink() {
    this.rink = this.add.graphics();
    this.puckTrail = this.add.graphics();
    this.fireworksGraphics = this.add.graphics();
  }

  private createEntities() {
    this.puckGlow = this.add.circle(WORLD.width / 2, WORLD.height / 2, WORLD.puckRadius * 2.2, 0x66ccff, 0.12);
    this.puck = this.add.circle(WORLD.width / 2, WORLD.height / 2, WORLD.puckRadius, 0xe8f7ff, 1);

    this.paddles = {
      left: this.createPaddle('left', 320, WORLD.height / 2, 0xff6bd6),
      right: this.createPaddle('right', WORLD.width - 320, WORLD.height / 2, 0x69f0ff),
    };
  }

  private createPaddle(id: PaddleId, x: number, y: number, color: number): PaddleState {
    const glow = this.add.circle(x, y, WORLD.paddleRadius * 1.45, color, 0.15);
    const body = this.add.circle(x, y, WORLD.paddleRadius, color, 1);
    body.setStrokeStyle(6, 0xffffff, 0.7);

    return {
      id,
      body,
      glow,
      vx: 0,
      vy: 0,
      touchId: null,
      homeX: x,
      homeY: y,
      half: id,
      grabOffsetX: 0,
      grabOffsetY: 0,
      lastTargetX: x,
      lastTargetY: y,
    };
  }

  private createUi() {
    this.scoreText = this.add
      .text(WORLD.width / 2, WORLD.height / 2, '0  :  0', {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '72px',
        color: '#eaf6ff',
        fontStyle: 'bold',
        stroke: '#091427',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.subtitleText = this.add
      .text(WORLD.width / 2, WORLD.height / 2 + 86, 'Tap score to restart • Tap FULLSCREEN for mobile', {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '30px',
        color: '#8fb6d9',
      })
      .setOrigin(0.5);

    this.fullscreenButton = this.makeMenuButton(WORLD.width / 2, WORLD.height - 86, 'FULLSCREEN', () => {
      void this.enterFullscreen();
    }, 340);
    this.fullscreenButton.setDepth(10);

    const panel = this.add.rectangle(WORLD.width / 2, WORLD.height / 2, 560, 380, 0x081120, 0.92);
    panel.setStrokeStyle(4, 0x69f0ff, 0.6);

    const title = this.add
      .text(WORLD.width / 2, WORLD.height / 2 - 110, 'Restart match?', {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '48px',
        color: '#f4fbff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const restartBtn = this.makeMenuButton(WORLD.width / 2, WORLD.height / 2 + 10, 'Restart', () => {
      this.score = { left: 0, right: 0 };
      this.updateScoreText();
      this.toggleMenu(false);
      this.goalFreeze = false;
      this.fireworks = [];
      this.resetRound('right');
    });

    const closeBtn = this.makeMenuButton(WORLD.width / 2, WORLD.height / 2 + 110, 'Resume', () => {
      this.toggleMenu(false);
    });

    this.menuContainer = this.add.container(0, 0, [panel, title, restartBtn, closeBtn]);
    this.menuContainer.setVisible(false);
    this.menuContainer.setDepth(20);

    this.scoreText.on('pointerdown', () => this.toggleMenu(true));
  }

  private makeMenuButton(x: number, y: number, label: string, onClick: () => void, width = 280) {
    const bg = this.add.rectangle(x, y, width, 72, 0x11213a, 0.95).setStrokeStyle(3, 0xc6efff, 0.55);
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '32px',
        color: '#f3fbff',
      })
      .setOrigin(0.5);

    bg.setInteractive({ useHandCursor: true });
    text.setInteractive({ useHandCursor: true });
    bg.on('pointerdown', onClick);
    text.on('pointerdown', onClick);
    return this.add.container(0, 0, [bg, text]);
  }

  private registerInput() {
    this.input.addPointer(3);
    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);
    this.input.on('pointerupoutside', this.onPointerUp, this);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    if (this.menuVisible || this.goalFreeze) return;
    if (this.activePointerIds.size >= WORLD.maxTouches) return;
    if (this.activePointerIds.has(pointer.id)) return;

    const available = Object.values(this.paddles).filter((p) => p.touchId === null);
    if (available.length === 0) return;

    const nearest = available.reduce((best, paddle) => {
      const bestDist = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, best.body.x, best.body.y);
      const currentDist = Phaser.Math.Distance.Between(pointer.worldX, pointer.worldY, paddle.body.x, paddle.body.y);
      return currentDist < bestDist ? paddle : best;
    }, available[0]);

    nearest.touchId = pointer.id;
    nearest.grabOffsetX = nearest.body.x - pointer.worldX;
    nearest.grabOffsetY = nearest.body.y - pointer.worldY;
    nearest.lastTargetX = nearest.body.x;
    nearest.lastTargetY = nearest.body.y;
    this.activePointerIds.add(pointer.id);
    this.movePaddleToPointer(nearest, pointer, 1 / 60, true);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (!this.activePointerIds.has(pointer.id)) return;
    const paddle = Object.values(this.paddles).find((p) => p.touchId === pointer.id);
    if (!paddle) return;
    this.movePaddleToPointer(paddle, pointer, 1 / 60, false);
  }

  private onPointerUp(pointer: Phaser.Input.Pointer) {
    const paddle = Object.values(this.paddles).find((p) => p.touchId === pointer.id);
    if (!paddle) return;
    paddle.touchId = null;
    paddle.grabOffsetX = 0;
    paddle.grabOffsetY = 0;
    this.activePointerIds.delete(pointer.id);
  }

  private movePaddleToPointer(paddle: PaddleState, pointer: Phaser.Input.Pointer, dt: number, snap: boolean) {
    const rawTargetX = pointer.worldX + paddle.grabOffsetX;
    const rawTargetY = pointer.worldY + paddle.grabOffsetY;
    const clamped = this.clampPaddlePosition(paddle, rawTargetX, rawTargetY);
    const target = snap
      ? clamped
      : {
          x: Phaser.Math.Linear(paddle.lastTargetX, clamped.x, WORLD.touchSmoothing),
          y: Phaser.Math.Linear(paddle.lastTargetY, clamped.y, WORLD.touchSmoothing),
        };

    paddle.vx = Phaser.Math.Clamp((target.x - paddle.body.x) / dt, -WORLD.paddleSpeedClamp, WORLD.paddleSpeedClamp);
    paddle.vy = Phaser.Math.Clamp((target.y - paddle.body.y) / dt, -WORLD.paddleSpeedClamp, WORLD.paddleSpeedClamp);
    paddle.body.setPosition(target.x, target.y);
    paddle.glow.setPosition(target.x, target.y);
    paddle.lastTargetX = target.x;
    paddle.lastTargetY = target.y;
  }

  update(time: number, delta: number) {
    const dt = Math.min(delta / 1000, 0.025);
    this.animateBackdrop(time);
    this.updatePaddles(dt);
    if (!this.menuVisible && !this.goalFreeze) {
      this.updatePuck(dt);
    }
    this.updateFireworks(dt);
    this.drawRink();
    this.drawTrail();
  }

  private animateBackdrop(time: number) {
    this.stars.forEach((star, index) => {
      star.alpha = 0.3 + ((Math.sin(time * 0.0018 + index) + 1) * 0.25);
    });
  }

  private updatePaddles(dt: number) {
    Object.values(this.paddles).forEach((paddle) => {
      if (paddle.touchId === null) {
        const target = this.clampPaddlePosition(paddle, paddle.homeX, paddle.homeY);
        const nextX = Phaser.Math.Linear(paddle.body.x, target.x, WORLD.paddleReturnLerp);
        const nextY = Phaser.Math.Linear(paddle.body.y, target.y, WORLD.paddleReturnLerp);
        paddle.vx = (nextX - paddle.body.x) / Math.max(dt, 0.001);
        paddle.vy = (nextY - paddle.body.y) / Math.max(dt, 0.001);
        paddle.body.setPosition(nextX, nextY);
        paddle.glow.setPosition(nextX, nextY);
        paddle.lastTargetX = nextX;
        paddle.lastTargetY = nextY;
      }
    });
  }

  private updatePuck(dt: number) {
    this.puckVelocity.x *= 1 - WORLD.drag * (dt * 1000);
    this.puckVelocity.y *= 1 - WORLD.drag * (dt * 1000);

    let nextX = this.puck.x + this.puckVelocity.x * dt;
    let nextY = this.puck.y + this.puckVelocity.y * dt;

    const left = WORLD.inset + WORLD.puckRadius;
    const right = WORLD.width - WORLD.inset - WORLD.puckRadius;
    const top = WORLD.inset + WORLD.puckRadius;
    const bottom = WORLD.height - WORLD.inset - WORLD.puckRadius;
    const goalTop = (WORLD.height - WORLD.goalWidth) / 2;
    const goalBottom = goalTop + WORLD.goalWidth;

    const inLeftGoalMouth = nextY > goalTop && nextY < goalBottom && nextX - WORLD.puckRadius <= WORLD.inset + WORLD.goalDepth;
    const inRightGoalMouth = nextY > goalTop && nextY < goalBottom && nextX + WORLD.puckRadius >= WORLD.width - WORLD.inset - WORLD.goalDepth;

    if (!inLeftGoalMouth && nextX <= left) {
      nextX = left;
      this.puckVelocity.x *= -WORLD.wallDamping;
      this.puckVelocity.y *= WORLD.wallDamping;
    }

    if (!inRightGoalMouth && nextX >= right) {
      nextX = right;
      this.puckVelocity.x *= -WORLD.wallDamping;
      this.puckVelocity.y *= WORLD.wallDamping;
    }

    if (nextY <= top || nextY >= bottom) {
      nextY = Phaser.Math.Clamp(nextY, top, bottom);
      this.puckVelocity.y *= -WORLD.wallDamping;
      this.puckVelocity.x *= WORLD.wallDamping;
    }

    this.puck.setPosition(nextX, nextY);
    this.puckGlow.setPosition(nextX, nextY);

    this.resolvePaddleCollision(this.paddles.left);
    this.resolvePaddleCollision(this.paddles.right);

    const speed = Math.hypot(this.puckVelocity.x, this.puckVelocity.y);
    if (speed < WORLD.puckMinSpeed && speed > 0) {
      const scale = WORLD.puckMinSpeed / speed;
      this.puckVelocity.x *= scale;
      this.puckVelocity.y *= scale;
    }
    if (speed > WORLD.puckMaxSpeed) {
      const scale = WORLD.puckMaxSpeed / speed;
      this.puckVelocity.x *= scale;
      this.puckVelocity.y *= scale;
    }

    this.trackPuckHistory();
    this.checkGoal();
  }

  private resolvePaddleCollision(paddle: PaddleState) {
    const dx = this.puck.x - paddle.body.x;
    const dy = this.puck.y - paddle.body.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = WORLD.paddleRadius + WORLD.puckRadius;
    if (distance <= 0 || distance >= minDistance) return;

    const nx = dx / distance;
    const ny = dy / distance;
    const overlap = minDistance - distance;
    this.puck.x += nx * overlap;
    this.puck.y += ny * overlap;
    this.puckGlow.setPosition(this.puck.x, this.puck.y);

    const relativeVx = this.puckVelocity.x - paddle.vx;
    const relativeVy = this.puckVelocity.y - paddle.vy;
    const relativeAlongNormal = relativeVx * nx + relativeVy * ny;

    if (relativeAlongNormal > 0) return;

    const bounce = -relativeAlongNormal * WORLD.paddleHitBoost;
    this.puckVelocity.x += nx * bounce + paddle.vx * 0.22 * WORLD.paddleHitInfluence;
    this.puckVelocity.y += ny * bounce + paddle.vy * 0.22 * WORLD.paddleHitInfluence;

    const tangentX = -ny;
    const tangentY = nx;
    const paddleTangent = paddle.vx * tangentX + paddle.vy * tangentY;
    this.puckVelocity.x += tangentX * paddleTangent * 0.16;
    this.puckVelocity.y += tangentY * paddleTangent * 0.16;
  }

  private trackPuckHistory() {
    this.puckLastPositions.unshift({ x: this.puck.x, y: this.puck.y });
    if (this.puckLastPositions.length > 10) {
      this.puckLastPositions.pop();
    }
  }

  private drawTrail() {
    this.puckTrail.clear();
    this.puckLastPositions.forEach((pos, index) => {
      const alpha = 0.16 - index * 0.013;
      const radius = WORLD.puckRadius * (0.78 - index * 0.045);
      if (alpha > 0 && radius > 3) {
        this.puckTrail.fillStyle(0x7fd6ff, alpha);
        this.puckTrail.fillCircle(pos.x, pos.y, radius);
      }
    });
  }

  private checkGoal() {
    const goalTop = (WORLD.height - WORLD.goalWidth) / 2;
    const goalBottom = goalTop + WORLD.goalWidth;
    const leftLine = WORLD.inset + WORLD.goalDepth;
    const rightLine = WORLD.width - WORLD.inset - WORLD.goalDepth;

    if (this.puck.y > goalTop && this.puck.y < goalBottom && this.puck.x - WORLD.puckRadius <= leftLine) {
      this.handleGoal('right');
      return;
    }

    if (this.puck.y > goalTop && this.puck.y < goalBottom && this.puck.x + WORLD.puckRadius >= rightLine) {
      this.handleGoal('left');
    }
  }

  private handleGoal(scoringSide: PaddleId) {
    if (this.goalFreeze) return;

    this.goalFreeze = true;
    this.activePointerIds.clear();
    Object.values(this.paddles).forEach((paddle) => {
      paddle.touchId = null;
      paddle.grabOffsetX = 0;
      paddle.grabOffsetY = 0;
    });

    if (scoringSide === 'left') {
      this.score.left += 1;
      this.spawnFireworks(WORLD.inset + WORLD.goalDepth + 70, WORLD.height / 2, 0xff6bd6);
    } else {
      this.score.right += 1;
      this.spawnFireworks(WORLD.width - WORLD.inset - WORLD.goalDepth - 70, WORLD.height / 2, 0x69f0ff);
    }

    this.updateScoreText();
    this.subtitleText.setText('GOAL! Cosmic fireworks...');
    this.puckVelocity = { x: 0, y: 0 };

    this.time.delayedCall(WORLD.goalPauseMs, () => {
      this.goalFreeze = false;
      this.subtitleText.setText('Tap score to restart • Tap FULLSCREEN for mobile');
      this.resetRound(scoringSide === 'left' ? 'right' : 'left');
    });
  }

  private spawnFireworks(x: number, y: number, baseColor: number) {
    const palette = [baseColor, 0xffffff, 0x7fd6ff, 0xb968ff, 0xffde59];
    for (let burst = 0; burst < 3; burst += 1) {
      const burstAngle = Phaser.Math.FloatBetween(0, Math.PI * 2);
      const burstX = x + Math.cos(burstAngle) * Phaser.Math.Between(10, 70);
      const burstY = y + Math.sin(burstAngle) * Phaser.Math.Between(10, 120);
      for (let i = 0; i < 26; i += 1) {
        const angle = (Math.PI * 2 * i) / 26 + Phaser.Math.FloatBetween(-0.15, 0.15);
        const speed = Phaser.Math.Between(180, 520);
        this.fireworks.push({
          x: burstX,
          y: burstY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: Phaser.Math.FloatBetween(0.55, 1.15),
          maxLife: 1.15,
          color: palette[Phaser.Math.Between(0, palette.length - 1)],
          size: Phaser.Math.FloatBetween(3, 8),
        });
      }
    }
  }

  private updateFireworks(dt: number) {
    this.fireworksGraphics.clear();
    const next: FireworkParticle[] = [];

    this.fireworks.forEach((particle) => {
      particle.life -= dt;
      if (particle.life <= 0) return;
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vx *= 0.985;
      particle.vy *= 0.985;
      particle.size *= 0.992;
      const alpha = particle.life / particle.maxLife;
      this.fireworksGraphics.fillStyle(particle.color, alpha);
      this.fireworksGraphics.fillCircle(particle.x, particle.y, particle.size);
      next.push(particle);
    });

    this.fireworks = next;
  }

  private updateScoreText() {
    this.scoreText.setText(`${this.score.left}  :  ${this.score.right}`);
  }

  private resetRound(servingTo: PaddleId) {
    this.puck.setPosition(WORLD.width / 2, WORLD.height / 2);
    this.puckGlow.setPosition(WORLD.width / 2, WORLD.height / 2);
    this.puckLastPositions = [];
    const angleBase = servingTo === 'left' ? 0 : Math.PI;
    const angle = angleBase + Phaser.Math.FloatBetween(-0.35, 0.35);
    this.puckVelocity = {
      x: Math.cos(angle) * WORLD.puckServeSpeed,
      y: Math.sin(angle) * WORLD.puckServeSpeed,
    };

    Object.values(this.paddles).forEach((paddle) => {
      paddle.touchId = null;
      paddle.vx = 0;
      paddle.vy = 0;
      paddle.grabOffsetX = 0;
      paddle.grabOffsetY = 0;
      paddle.body.setPosition(paddle.homeX, paddle.homeY);
      paddle.glow.setPosition(paddle.homeX, paddle.homeY);
      paddle.lastTargetX = paddle.homeX;
      paddle.lastTargetY = paddle.homeY;
    });

    this.activePointerIds.clear();
  }

  private clampPaddlePosition(paddle: PaddleState, x: number, y: number) {
    const top = WORLD.inset + WORLD.paddleRadius;
    const bottom = WORLD.height - WORLD.inset - WORLD.paddleRadius;
    const centerGap = 110;
    const leftBound = WORLD.inset + WORLD.paddleRadius;
    const rightBound = WORLD.width - WORLD.inset - WORLD.paddleRadius;

    const isLeftSide = paddle.half === 'left';
    const minX = isLeftSide ? leftBound : WORLD.width / 2 + centerGap;
    const maxX = isLeftSide ? WORLD.width / 2 - centerGap : rightBound;

    return {
      x: Phaser.Math.Clamp(x, minX, maxX),
      y: Phaser.Math.Clamp(y, top, bottom),
    };
  }

  private drawRink() {
    const g = this.rink;
    g.clear();

    g.fillStyle(0x081629, 0.78);
    g.fillRoundedRect(WORLD.inset, WORLD.inset, WORLD.width - WORLD.inset * 2, WORLD.height - WORLD.inset * 2, 42);

    g.lineStyle(8, 0x7fd6ff, 0.95);
    g.strokeRoundedRect(WORLD.inset, WORLD.inset, WORLD.width - WORLD.inset * 2, WORLD.height - WORLD.inset * 2, 42);

    g.lineStyle(4, 0xb968ff, 0.6);
    g.strokeCircle(WORLD.width / 2, WORLD.height / 2, 180);

    g.lineStyle(6, 0x75cfff, 0.4);
    g.lineBetween(WORLD.width / 2, WORLD.inset + 28, WORLD.width / 2, WORLD.height - WORLD.inset - 28);

    const goalTop = (WORLD.height - WORLD.goalWidth) / 2;
    g.fillStyle(0x173455, 0.95);
    g.fillRect(WORLD.inset, goalTop, WORLD.goalDepth, WORLD.goalWidth);
    g.fillRect(WORLD.width - WORLD.inset - WORLD.goalDepth, goalTop, WORLD.goalDepth, WORLD.goalWidth);

    g.lineStyle(6, 0xffffff, 0.4);
    g.strokeRect(WORLD.inset, goalTop, WORLD.goalDepth, WORLD.goalWidth);
    g.strokeRect(WORLD.width - WORLD.inset - WORLD.goalDepth, goalTop, WORLD.goalDepth, WORLD.goalWidth);
  }

  private toggleMenu(show: boolean) {
    this.menuVisible = show;
    this.menuContainer.setVisible(show);
  }

  private handleResize() {
    const canvas = this.game.canvas;
    canvas.style.width = '';
    canvas.style.height = '';
    canvas.style.maxWidth = '100vw';
    canvas.style.maxHeight = '100vh';
    this.scale.refresh();
  }

  private async enterFullscreen() {
    try {
      if (document.fullscreenElement == null) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Some mobile browsers only partially support the standard fullscreen API.
    }

    try {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
      if (orientation?.lock) {
        await orientation.lock('landscape-primary');
      }
    } catch {
      // Orientation lock often requires fullscreen and may still fail on iOS.
    }

    this.fullscreenButton.setVisible(false);
    this.subtitleText.setText('Tap score to restart');
  }
}

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#050816',
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: WORLD.width,
    height: WORLD.height,
  },
  scene: [AirpuckScene],
  render: {
    antialias: true,
    powerPreference: 'high-performance',
  },
  input: {
    activePointers: 4,
    smoothFactor: 0,
  },
});

window.addEventListener('resize', () => game.scale.refresh());

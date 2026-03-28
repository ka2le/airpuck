import Phaser from 'phaser';
import './style.css';

type Vec2 = { x: number; y: number };
type Side = 'left' | 'right' | 'top' | 'bottom';

type PaddleState = {
  id: 'a' | 'b';
  body: Phaser.GameObjects.Arc;
  glow: Phaser.GameObjects.Arc;
  vx: number;
  vy: number;
  touchId: number | null;
  homeX: number;
  homeY: number;
  grabOffsetX: number;
  grabOffsetY: number;
  lastTargetX: number;
  lastTargetY: number;
};

type ScoreState = {
  a: number;
  b: number;
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

type Layout = {
  width: number;
  height: number;
  inset: number;
  goalLength: number;
  goalDepth: number;
  paddleRadius: number;
  puckRadius: number;
  centerX: number;
  centerY: number;
  divideVertical: boolean;
  playerASide: Side;
  playerBSide: Side;
};

const TUNING = {
  maxTouches: 2,
  drag: 0.00008,
  wallDamping: 0.92,
  paddleReturnLerp: 0.12,
  paddleHitBoost: 1.08,
  paddleHitInfluence: 1.15,
  paddleSpeedClamp: 3400,
  puckMinSpeed: 320,
  puckMaxSpeed: 3000,
  puckServeSpeedFactor: 0.95,
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
  private paddles!: Record<'a' | 'b', PaddleState>;
  private score: ScoreState = { a: 0, b: 0 };
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
  private layout: Layout = this.makeLayout(window.innerWidth || 1280, window.innerHeight || 720);

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
    this.relayout(this.scale.width, this.scale.height);
    this.resetRound(Phaser.Math.Between(0, 1) === 0 ? 'a' : 'b');
  }

  private makeLayout(width: number, height: number): Layout {
    const safeWidth = Math.max(width, 320);
    const safeHeight = Math.max(height, 320);
    const shortSide = Math.min(safeWidth, safeHeight);
    const inset = Math.max(18, Math.round(shortSide * 0.05));
    const goalLength = Math.round(shortSide * 0.28);
    const goalDepth = Math.max(18, Math.round(shortSide * 0.026));
    const paddleRadius = Math.max(38, Math.round(shortSide * 0.08));
    const puckRadius = Math.max(18, Math.round(shortSide * 0.036));
    const divideVertical = safeWidth >= safeHeight;

    return {
      width: safeWidth,
      height: safeHeight,
      inset,
      goalLength,
      goalDepth,
      paddleRadius,
      puckRadius,
      centerX: safeWidth / 2,
      centerY: safeHeight / 2,
      divideVertical,
      playerASide: divideVertical ? 'left' : 'top',
      playerBSide: divideVertical ? 'right' : 'bottom',
    };
  }

  private createBackdrop() {
    for (let i = 0; i < 120; i += 1) {
      const star = this.add.circle(0, 0, Phaser.Math.FloatBetween(1, 3), 0xffffff, Phaser.Math.FloatBetween(0.25, 0.85));
      this.stars.push(star);
    }
  }

  private createRink() {
    this.rink = this.add.graphics();
    this.puckTrail = this.add.graphics();
    this.fireworksGraphics = this.add.graphics();
  }

  private createEntities() {
    this.puckGlow = this.add.circle(0, 0, 20, 0x66ccff, 0.12);
    this.puck = this.add.circle(0, 0, 10, 0xe8f7ff, 1);

    this.paddles = {
      a: this.createPaddle(0xff6bd6),
      b: this.createPaddle(0x69f0ff),
    };
  }

  private createPaddle(color: number): PaddleState {
    const glow = this.add.circle(0, 0, 40, color, 0.15);
    const body = this.add.circle(0, 0, 20, color, 1);
    body.setStrokeStyle(6, 0xffffff, 0.7);

    return {
      id: color === 0xff6bd6 ? 'a' : 'b',
      body,
      glow,
      vx: 0,
      vy: 0,
      touchId: null,
      homeX: 0,
      homeY: 0,
      grabOffsetX: 0,
      grabOffsetY: 0,
      lastTargetX: 0,
      lastTargetY: 0,
    };
  }

  private createUi() {
    this.scoreText = this.add
      .text(0, 0, '0 : 0', {
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
      .text(0, 0, 'Tap score to restart • Tap FULLSCREEN for mobile', {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '30px',
        color: '#8fb6d9',
      })
      .setOrigin(0.5);

    this.fullscreenButton = this.makeMenuButton(0, 0, 'FULLSCREEN', () => {
      void this.enterFullscreen();
    }, 340);
    this.fullscreenButton.setDepth(10);

    const panel = this.add.rectangle(0, 0, 560, 380, 0x081120, 0.92);
    panel.setStrokeStyle(4, 0x69f0ff, 0.6);

    const title = this.add
      .text(0, 0, 'Restart match?', {
        fontFamily: 'Arial, Helvetica, sans-serif',
        fontSize: '48px',
        color: '#f4fbff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5);

    const restartBtn = this.makeMenuButton(0, 0, 'Restart', () => {
      this.score = { a: 0, b: 0 };
      this.updateScoreText();
      this.toggleMenu(false);
      this.goalFreeze = false;
      this.fireworks = [];
      this.resetRound('b');
    });

    const closeBtn = this.makeMenuButton(0, 0, 'Resume', () => {
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
    if (this.activePointerIds.size >= TUNING.maxTouches) return;
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
    const clamped = this.clampPaddlePosition(paddle.id, rawTargetX, rawTargetY);
    const target = snap
      ? clamped
      : {
          x: Phaser.Math.Linear(paddle.lastTargetX, clamped.x, TUNING.touchSmoothing),
          y: Phaser.Math.Linear(paddle.lastTargetY, clamped.y, TUNING.touchSmoothing),
        };

    paddle.vx = Phaser.Math.Clamp((target.x - paddle.body.x) / dt, -TUNING.paddleSpeedClamp, TUNING.paddleSpeedClamp);
    paddle.vy = Phaser.Math.Clamp((target.y - paddle.body.y) / dt, -TUNING.paddleSpeedClamp, TUNING.paddleSpeedClamp);
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
        const target = { x: paddle.homeX, y: paddle.homeY };
        const nextX = Phaser.Math.Linear(paddle.body.x, target.x, TUNING.paddleReturnLerp);
        const nextY = Phaser.Math.Linear(paddle.body.y, target.y, TUNING.paddleReturnLerp);
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
    const speedFloor = Math.min(this.layout.width, this.layout.height) * 0.28;
    const speedCeil = Math.min(this.layout.width, this.layout.height) * 2.5;

    this.puckVelocity.x *= 1 - TUNING.drag * (dt * 1000);
    this.puckVelocity.y *= 1 - TUNING.drag * (dt * 1000);

    let nextX = this.puck.x + this.puckVelocity.x * dt;
    let nextY = this.puck.y + this.puckVelocity.y * dt;

    const l = this.layout;
    const left = l.inset + l.puckRadius;
    const right = l.width - l.inset - l.puckRadius;
    const top = l.inset + l.puckRadius;
    const bottom = l.height - l.inset - l.puckRadius;

    if (l.divideVertical) {
      const goalTop = l.centerY - l.goalLength / 2;
      const goalBottom = l.centerY + l.goalLength / 2;
      const inLeftGoalMouth = nextY > goalTop && nextY < goalBottom && nextX - l.puckRadius <= l.inset + l.goalDepth;
      const inRightGoalMouth = nextY > goalTop && nextY < goalBottom && nextX + l.puckRadius >= l.width - l.inset - l.goalDepth;

      if (!inLeftGoalMouth && nextX <= left) {
        nextX = left;
        this.puckVelocity.x *= -TUNING.wallDamping;
        this.puckVelocity.y *= TUNING.wallDamping;
      }
      if (!inRightGoalMouth && nextX >= right) {
        nextX = right;
        this.puckVelocity.x *= -TUNING.wallDamping;
        this.puckVelocity.y *= TUNING.wallDamping;
      }
      if (nextY <= top || nextY >= bottom) {
        nextY = Phaser.Math.Clamp(nextY, top, bottom);
        this.puckVelocity.y *= -TUNING.wallDamping;
        this.puckVelocity.x *= TUNING.wallDamping;
      }
    } else {
      const goalLeft = l.centerX - l.goalLength / 2;
      const goalRight = l.centerX + l.goalLength / 2;
      const inTopGoalMouth = nextX > goalLeft && nextX < goalRight && nextY - l.puckRadius <= l.inset + l.goalDepth;
      const inBottomGoalMouth = nextX > goalLeft && nextX < goalRight && nextY + l.puckRadius >= l.height - l.inset - l.goalDepth;

      if (!inTopGoalMouth && nextY <= top) {
        nextY = top;
        this.puckVelocity.y *= -TUNING.wallDamping;
        this.puckVelocity.x *= TUNING.wallDamping;
      }
      if (!inBottomGoalMouth && nextY >= bottom) {
        nextY = bottom;
        this.puckVelocity.y *= -TUNING.wallDamping;
        this.puckVelocity.x *= TUNING.wallDamping;
      }
      if (nextX <= left || nextX >= right) {
        nextX = Phaser.Math.Clamp(nextX, left, right);
        this.puckVelocity.x *= -TUNING.wallDamping;
        this.puckVelocity.y *= TUNING.wallDamping;
      }
    }

    this.puck.setPosition(nextX, nextY);
    this.puckGlow.setPosition(nextX, nextY);

    this.resolvePaddleCollision(this.paddles.a);
    this.resolvePaddleCollision(this.paddles.b);

    const speed = Math.hypot(this.puckVelocity.x, this.puckVelocity.y);
    if (speed < speedFloor && speed > 0) {
      const scale = speedFloor / speed;
      this.puckVelocity.x *= scale;
      this.puckVelocity.y *= scale;
    }
    if (speed > speedCeil) {
      const scale = speedCeil / speed;
      this.puckVelocity.x *= scale;
      this.puckVelocity.y *= scale;
    }

    this.trackPuckHistory();
    this.checkGoal();
  }

  private resolvePaddleCollision(paddle: PaddleState) {
    const l = this.layout;
    const dx = this.puck.x - paddle.body.x;
    const dy = this.puck.y - paddle.body.y;
    const distance = Math.hypot(dx, dy);
    const minDistance = l.paddleRadius + l.puckRadius;
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

    const bounce = -relativeAlongNormal * TUNING.paddleHitBoost;
    this.puckVelocity.x += nx * bounce + paddle.vx * 0.22 * TUNING.paddleHitInfluence;
    this.puckVelocity.y += ny * bounce + paddle.vy * 0.22 * TUNING.paddleHitInfluence;

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
      const radius = this.layout.puckRadius * (0.78 - index * 0.045);
      if (alpha > 0 && radius > 3) {
        this.puckTrail.fillStyle(0x7fd6ff, alpha);
        this.puckTrail.fillCircle(pos.x, pos.y, radius);
      }
    });
  }

  private checkGoal() {
    const l = this.layout;

    if (l.divideVertical) {
      const goalTop = l.centerY - l.goalLength / 2;
      const goalBottom = l.centerY + l.goalLength / 2;
      const leftLine = l.inset + l.goalDepth;
      const rightLine = l.width - l.inset - l.goalDepth;

      if (this.puck.y > goalTop && this.puck.y < goalBottom && this.puck.x - l.puckRadius <= leftLine) {
        this.handleGoal('b');
        return;
      }
      if (this.puck.y > goalTop && this.puck.y < goalBottom && this.puck.x + l.puckRadius >= rightLine) {
        this.handleGoal('a');
      }
      return;
    }

    const goalLeft = l.centerX - l.goalLength / 2;
    const goalRight = l.centerX + l.goalLength / 2;
    const topLine = l.inset + l.goalDepth;
    const bottomLine = l.height - l.inset - l.goalDepth;

    if (this.puck.x > goalLeft && this.puck.x < goalRight && this.puck.y - l.puckRadius <= topLine) {
      this.handleGoal('b');
      return;
    }
    if (this.puck.x > goalLeft && this.puck.x < goalRight && this.puck.y + l.puckRadius >= bottomLine) {
      this.handleGoal('a');
    }
  }

  private handleGoal(scoringPlayer: 'a' | 'b') {
    if (this.goalFreeze) return;

    const l = this.layout;
    this.goalFreeze = true;
    this.activePointerIds.clear();
    Object.values(this.paddles).forEach((paddle) => {
      paddle.touchId = null;
      paddle.grabOffsetX = 0;
      paddle.grabOffsetY = 0;
    });

    this.score[scoringPlayer] += 1;

    if (l.divideVertical) {
      const x = scoringPlayer === 'a' ? l.inset + l.goalDepth + 70 : l.width - l.inset - l.goalDepth - 70;
      this.spawnFireworks(x, l.centerY, scoringPlayer === 'a' ? 0xff6bd6 : 0x69f0ff);
    } else {
      const y = scoringPlayer === 'a' ? l.inset + l.goalDepth + 70 : l.height - l.inset - l.goalDepth - 70;
      this.spawnFireworks(l.centerX, y, scoringPlayer === 'a' ? 0xff6bd6 : 0x69f0ff);
    }

    this.updateScoreText();
    this.subtitleText.setText('GOAL! Cosmic fireworks...');
    this.puckVelocity = { x: 0, y: 0 };

    this.time.delayedCall(TUNING.goalPauseMs, () => {
      this.goalFreeze = false;
      this.subtitleText.setText(this.fullscreenButton.visible ? 'Tap score to restart • Tap FULLSCREEN for mobile' : 'Tap score to restart');
      this.resetRound(scoringPlayer === 'a' ? 'b' : 'a');
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
    this.scoreText.setText(`${this.score.a}  :  ${this.score.b}`);
  }

  private resetRound(servingPlayer: 'a' | 'b') {
    const l = this.layout;
    const shortSide = Math.min(l.width, l.height);
    const serveSpeed = shortSide * TUNING.puckServeSpeedFactor;

    this.puck.setPosition(l.centerX, l.centerY);
    this.puckGlow.setPosition(l.centerX, l.centerY);
    this.puckLastPositions = [];

    let angleBase = 0;
    if (l.divideVertical) {
      angleBase = servingPlayer === 'a' ? 0 : Math.PI;
    } else {
      angleBase = servingPlayer === 'a' ? Math.PI / 2 : -Math.PI / 2;
    }

    const angle = angleBase + Phaser.Math.FloatBetween(-0.35, 0.35);
    this.puckVelocity = {
      x: Math.cos(angle) * serveSpeed,
      y: Math.sin(angle) * serveSpeed,
    };

    this.positionPaddlesAtHome();
    this.activePointerIds.clear();
  }

  private positionPaddlesAtHome() {
    const l = this.layout;
    const offset = Math.min(l.width, l.height) * 0.24;

    if (l.divideVertical) {
      this.setPaddleHome(this.paddles.a, l.centerX - offset, l.centerY);
      this.setPaddleHome(this.paddles.b, l.centerX + offset, l.centerY);
    } else {
      this.setPaddleHome(this.paddles.a, l.centerX, l.centerY - offset);
      this.setPaddleHome(this.paddles.b, l.centerX, l.centerY + offset);
    }
  }

  private setPaddleHome(paddle: PaddleState, x: number, y: number) {
    paddle.touchId = null;
    paddle.vx = 0;
    paddle.vy = 0;
    paddle.grabOffsetX = 0;
    paddle.grabOffsetY = 0;
    paddle.homeX = x;
    paddle.homeY = y;
    paddle.body.setPosition(x, y);
    paddle.glow.setPosition(x, y);
    paddle.lastTargetX = x;
    paddle.lastTargetY = y;
  }

  private clampPaddlePosition(player: 'a' | 'b', x: number, y: number) {
    const l = this.layout;
    const centerGap = Math.min(l.width, l.height) * 0.1;
    const left = l.inset + l.paddleRadius;
    const right = l.width - l.inset - l.paddleRadius;
    const top = l.inset + l.paddleRadius;
    const bottom = l.height - l.inset - l.paddleRadius;

    if (l.divideVertical) {
      const minX = player === 'a' ? left : l.centerX + centerGap;
      const maxX = player === 'a' ? l.centerX - centerGap : right;
      return { x: Phaser.Math.Clamp(x, minX, maxX), y: Phaser.Math.Clamp(y, top, bottom) };
    }

    const minY = player === 'a' ? top : l.centerY + centerGap;
    const maxY = player === 'a' ? l.centerY - centerGap : bottom;
    return { x: Phaser.Math.Clamp(x, left, right), y: Phaser.Math.Clamp(y, minY, maxY) };
  }

  private drawRink() {
    const g = this.rink;
    const l = this.layout;
    g.clear();

    g.fillStyle(0x081629, 0.78);
    g.fillRoundedRect(l.inset, l.inset, l.width - l.inset * 2, l.height - l.inset * 2, 42);

    g.lineStyle(8, 0x7fd6ff, 0.95);
    g.strokeRoundedRect(l.inset, l.inset, l.width - l.inset * 2, l.height - l.inset * 2, 42);

    g.lineStyle(4, 0xb968ff, 0.6);
    g.strokeCircle(l.centerX, l.centerY, Math.min(l.width, l.height) * 0.17);

    g.lineStyle(6, 0x75cfff, 0.4);
    if (l.divideVertical) {
      g.lineBetween(l.centerX, l.inset + 28, l.centerX, l.height - l.inset - 28);
      const goalTop = l.centerY - l.goalLength / 2;
      g.fillStyle(0x173455, 0.95);
      g.fillRect(l.inset, goalTop, l.goalDepth, l.goalLength);
      g.fillRect(l.width - l.inset - l.goalDepth, goalTop, l.goalDepth, l.goalLength);
      g.lineStyle(6, 0xffffff, 0.4);
      g.strokeRect(l.inset, goalTop, l.goalDepth, l.goalLength);
      g.strokeRect(l.width - l.inset - l.goalDepth, goalTop, l.goalDepth, l.goalLength);
    } else {
      g.lineBetween(l.inset + 28, l.centerY, l.width - l.inset - 28, l.centerY);
      const goalLeft = l.centerX - l.goalLength / 2;
      g.fillStyle(0x173455, 0.95);
      g.fillRect(goalLeft, l.inset, l.goalLength, l.goalDepth);
      g.fillRect(goalLeft, l.height - l.inset - l.goalDepth, l.goalLength, l.goalDepth);
      g.lineStyle(6, 0xffffff, 0.4);
      g.strokeRect(goalLeft, l.inset, l.goalLength, l.goalDepth);
      g.strokeRect(goalLeft, l.height - l.inset - l.goalDepth, l.goalLength, l.goalDepth);
    }
  }

  private toggleMenu(show: boolean) {
    this.menuVisible = show;
    this.menuContainer.setVisible(show);
  }

  private relayout(width: number, height: number) {
    this.layout = this.makeLayout(width, height);
    const l = this.layout;

    this.cameras.main.setViewport(0, 0, width, height);
    this.cameras.main.setScroll(0, 0);
    this.cameras.main.setZoom(1);

    this.stars.forEach((star) => {
      if (star.x === 0 && star.y === 0) {
        star.setPosition(Phaser.Math.Between(0, l.width), Phaser.Math.Between(0, l.height));
      } else {
        star.x = Phaser.Math.Wrap(star.x, 0, l.width);
        star.y = Phaser.Math.Wrap(star.y, 0, l.height);
      }
    });

    this.puck.setRadius(l.puckRadius);
    this.puckGlow.setRadius(l.puckRadius * 2.2);
    Object.values(this.paddles).forEach((paddle) => {
      paddle.body.setRadius(l.paddleRadius);
      paddle.glow.setRadius(l.paddleRadius * 1.45);
    });

    this.positionPaddlesAtHome();
    this.puck.setPosition(l.centerX, l.centerY);
    this.puckGlow.setPosition(l.centerX, l.centerY);

    this.scoreText.setPosition(l.centerX, l.centerY).setFontSize(Math.max(40, Math.round(Math.min(l.width, l.height) * 0.066)));
    this.subtitleText
      .setPosition(l.centerX, l.centerY + Math.min(l.width, l.height) * 0.08)
      .setFontSize(Math.max(18, Math.round(Math.min(l.width, l.height) * 0.028)));

    this.fullscreenButton.setPosition(l.centerX, l.height - Math.max(50, l.inset + 18));

    const panel = this.menuContainer.list[0] as Phaser.GameObjects.Rectangle;
    const title = this.menuContainer.list[1] as Phaser.GameObjects.Text;
    const restartBtn = this.menuContainer.list[2] as Phaser.GameObjects.Container;
    const closeBtn = this.menuContainer.list[3] as Phaser.GameObjects.Container;
    panel.setPosition(l.centerX, l.centerY).setSize(Math.min(560, l.width * 0.72), Math.min(380, l.height * 0.5));
    title.setPosition(l.centerX, l.centerY - 110);
    restartBtn.setPosition(l.centerX, l.centerY + 10);
    closeBtn.setPosition(l.centerX, l.centerY + 110);

    this.updateScoreText();
  }

  private handleResize(gameSize: Phaser.Structs.Size) {
    this.relayout(gameSize.width, gameSize.height);
  }

  private async enterFullscreen() {
    try {
      if (document.fullscreenElement == null) {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Mobile browsers vary here.
    }

    try {
      const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
      if (orientation?.lock) {
        await orientation.lock('landscape-primary');
      }
    } catch {
      // Optional enhancement only.
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
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    width: window.innerWidth,
    height: window.innerHeight,
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

window.addEventListener('resize', () => {
  game.scale.resize(window.innerWidth, window.innerHeight);
});

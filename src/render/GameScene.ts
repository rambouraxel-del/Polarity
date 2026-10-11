import Phaser from 'phaser';
import type { App } from '../app';

/** Scène unique : elle délègue la logique à App et sert de boucle de rendu. */
export class GameScene extends Phaser.Scene {
  constructor(private readonly app: App) {
    super('jeu');
  }

  create(): void {
    this.app.onSceneReady(this);
  }

  override update(): void {
    this.app.frame();
  }
}

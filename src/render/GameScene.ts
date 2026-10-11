import Phaser from 'phaser';
import type { App } from '../app';
import ast1 from '../assets/sprites/ast1.png';
import ast2 from '../assets/sprites/ast2.png';
import ast3 from '../assets/sprites/ast3.png';
import ast4 from '../assets/sprites/ast4.png';
import ship from '../assets/sprites/ship.png';
import { ASTEROID_TEXTURES, SHIP_TEXTURE } from './ArenaRenderer';

/** Scène unique : elle charge les sprites (locaux), délègue la logique à App et sert de boucle de rendu. */
export class GameScene extends Phaser.Scene {
  constructor(private readonly app: App) {
    super('jeu');
  }

  preload(): void {
    this.load.image(SHIP_TEXTURE, ship);
    [ast1, ast2, ast3, ast4].forEach((url, i) => this.load.image(ASTEROID_TEXTURES[i], url));
  }

  create(): void {
    this.app.onSceneReady(this);
  }

  override update(): void {
    this.app.frame();
  }
}

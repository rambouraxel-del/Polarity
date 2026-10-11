import Phaser from 'phaser';
import { App } from './app';
import { GameScene } from './render/GameScene';
import './style.css';

const app = new App();
const parent = document.getElementById('game')!;

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent,
  width: Math.max(1, window.innerWidth),
  height: Math.max(1, window.innerHeight),
  backgroundColor: '#070b1f',
  scale: { mode: Phaser.Scale.NONE },
  // Les entrées sont gérées par InputController (Pointer Events DOM) : Phaser ne capture rien.
  input: { keyboard: false, mouse: false, touch: false, gamepad: false },
  audio: { noAudio: true },
  banner: false,
  disableContextMenu: true,
  // Mipmaps : les sprites 128 px sont réduits à 20–50 px à l'écran ; sans cela ils scintilleraient.
  render: { antialias: true, powerPreference: 'high-performance', mipmapFilter: 'LINEAR_MIPMAP_LINEAR' },
  scene: [new GameScene(app)],
});
app.attachGame(game);

// Accès de débogage pour les tests de bout en bout
(window as unknown as { __polarite?: App }).__polarite = app;

import './style.css';
import { Game } from './core/Game';

declare global {
    interface Window { game: Game; }
}

window.addEventListener('load', async () => { window.game = await Game.create(); });

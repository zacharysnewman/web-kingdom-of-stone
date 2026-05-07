import './style.css';
import { Game } from './game';

declare global {
    interface Window { game: Game; }
}

window.addEventListener('load', async () => { window.game = await Game.create(); });

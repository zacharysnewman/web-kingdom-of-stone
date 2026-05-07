import { createStore } from 'zustand/vanilla';

export interface PlayerState {
    gold: number;
    population: number;
    maxPop: number;
}

export const playerStore = createStore<PlayerState>()(() => ({
    gold: 1000,
    population: 0,
    maxPop: 10,
}));

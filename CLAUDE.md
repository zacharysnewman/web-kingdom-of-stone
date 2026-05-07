# Kingdom of Stone — Claude Instructions

## Shared logic: AI and player use the same code paths

AI should never duplicate player-facing logic. If a player action goes through a method (e.g. `_trainUnit`), the AI must call that same method — not replicate its internals inline. Gate player-only side effects (notifications, HUD updates) on `entity.team === CONSTANTS.TEAM_PLAYER` inside the shared method.

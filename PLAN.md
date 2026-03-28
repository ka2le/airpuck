# Airpuck Plan

## Concept
A mobile-friendly two-player air hockey game played with the phone lying flat on a table in landscape/fullscreen.

## Core Requirements
- Two simultaneous touch points supported
- Each touch grabs the nearest available paddle
- If two touches are active, no new grabs until one touch ends
- Goals on opposite ends
- Fast puck with light drag
- Edge impacts reduce puck speed somewhat
- Paddle velocity affects puck bounce strength/direction
- Score display is tappable and opens restart menu
- Full playable game with space theme
- Fullscreen by default / on rotation
- Static web deploy via GitHub Pages

## Technical Direction
- Phaser 3 for fast rendering, game loop, input, mobile support
- TypeScript + Vite for maintainable web build
- Custom multitouch-to-paddle assignment logic
- Simple physics tuned for arcade air-hockey feel rather than heavy simulation
- Responsive landscape layout for phone/table play

## Milestones
1. Scaffold project
2. Build arena, paddles, puck, goals, score UI
3. Implement multitouch paddle grabbing
4. Tune collisions and puck response from paddle motion
5. Add restart menu and fullscreen/orientation behavior
6. Apply space theme and polish
7. Test production build
8. Create repo, push, configure Pages, deploy

## Notes
- Keep project-specific decisions in this folder.
- Prefer deterministic gameplay feel over generic physics defaults.

---
purpose: The spec of the table football minigame and the plan to build it, starting with a prototype that tests whether it plays well over the evening's connection.
audience: Konstantin, Pierre, and the agents building the table football minigame
maintainer: Konstantin
kind: brief
---

# Table football

Élodie loves table football. This minigame is a table football table on the TV, played live by 2 to 6 players in two teams, each player moving their rods from their phone. Its kind is `foosball`.

The evening is hosted: every phone and the TV reach the server over the internet, so what a player does shows on the TV a moment later (the lag), and Wi-Fi hiccups make that moment longer now and then. The design keeps lag from mattering much. Pierre's view: if it's a bit broken, it can be fun. Pierre measured a ping round trip of 27 to 45 ms from his home to the production server.

## Lag: positions, not timing

Lag spoils inputs that depend on a precise moment, and barely affects inputs that depend on a position. So the whole game is played by position:

- **The finger is the rod.** The player drags a finger up and down a tall strip on their phone, and their men follow the finger's position (absolute, not a joystick). The player always knows where they meant to be; the rod catching up on the TV reads as a heavy rod, not as lag.
- **Shots are automatic.** A ball that touches a man is kicked toward the other goal, its angle set by where on the man it hits. Aiming is placing the rod; no button press has to land at the right moment.
- **Power shot, held.** While the player holds the phone's power button, their next touch is a strong shot. A held button lasts longer than the lag, so it arrives in time.
- **A slow, heavy ball.** It takes about two seconds to cross the table, and its speed is capped. A Wi-Fi hiccup makes it jump a little.
- **A dead ball comes back.** A ball that stays almost still for a few seconds is served again from the middle.

## Teams and rods

Each team has four rods: goalie, defence, midfield and attack. A team's players split them:

| Players in a team | Who holds which rods |
|---|---|
| 1 | All four, on one strip |
| 2 | Back (goalie and defence), front (midfield and attack) |
| 3 | Goalie and defence, midfield, attack |

A match needs at least one player per team. With 3 or 5 players the teams are uneven (2 against 1, 3 against 2).

## A match

- **Start:** the ball is served from the middle. After a goal, it is served again.
- **End:** the first team to the target score wins. The game master's ⚙ Settings: target 3, 5 or 7 goals (default 5), and a time limit of 3 or 5 minutes or none (default none). When time runs out with a tie, the next goal wins.
- **Podium:** the winning team's players share first place, the others share second.
- **A player who leaves or is taken out:** their rods pass to a teammate. A team with nobody left loses, and the match ends.
- **The game master's End game** ends the match with the score so far.

## Screens

**TV:** the table seen from above, goals left and right, rods vertical; each team in its colour, each rod group labelled with its holder's character. The score and the clock above it. A goal gets a big "GOAL!" with the scorer's character.

**Phone (portrait):** the strip, almost the full height, with the player's team colour and the rods they hold; the power button beside it. The phone draws no table: the players watch the TV.

## How it fits the code

- **A plain-lobby minigame with spots,** like Pyramide ([minigames.md](minigames.md)): round rules in `shared/foosball.js`, round server code in `server/foosball.ts`, screens in `public/play/foosball-ui.js` and `public/screen/foosball-screen.js`, the registration lines and types. Six spots, three per team; a player picks a team by walking onto one of its spots.
- **The live match runs in the server code's memory,** not in the saved state:
  - phones send their rod position (`rod`, at most 15 per second, like `pos`) and the power button (`power`); the server code keeps them and returns no action, so nothing is saved;
  - the server code advances the ball about 30 times a second with a pure step function in `shared/foosball.js`, so tests can drive it, and sends the ball and rods to the TV as unsaved messages about 20 times a second;
  - the TV draws them about 100 ms late and interpolates between them, so an irregular arrival doesn't stutter;
  - a goal becomes an action through `io.apply`, so the score is saved. After a restart the score is kept and the ball is served from the middle.
- **[minigames.md](minigames.md) says unsaved messages are "for effects, not fast-moving games".** This minigame is the first to use them for a live game; that sentence gets updated with it.
- **The dev start:** `ITLOE_CONTENT=minigame:foosball`.
- **Remote players** open the TV's page in their own browser and play on their phone. Their TV page draws the match from the same snapshots, with their own lag.
- **Out of scope:** bots, spinning rods, a tableau in the story and its reward.

## Plan

1. **Prototype.** The registered minigame with the plain lobby's "I'm ready" (no spots yet), teams alternating in party order, the table, the ball, the rods, automatic shots and the power shot, a match that runs until End game, and the score. All tuning values (ball speed, cap, man sizes, rod speed) in one table in `shared/foosball.js`. A lag readout on the TV for each player: how long their rod messages take to come back in the TV's snapshots, typical and worst over the last 10 seconds.
   **Checkpoint:** Konstantin and Pierre play it on real phones against the production server (pushing to `production` deploys it, once Konstantin says so). Decide: does it play well, and what to retune.
2. **The full minigame:** spots and the team split for 2 to 6 players, the settings, the match end, the podium, leaving, the goal celebration, the PROTOCOL.md entries, the minigames.md update, and tests.
3. **An e2e suite** that plays a match to its podium, and a storyboard sequence. Then delete this brief.

Waiting on: the prototype.

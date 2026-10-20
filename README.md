# SirTet

A tetris for those who prefer emptying the dishwasher.

**Play it: https://vortitron.github.io/SirTet/**

SirTet turns tetris upside down. Instead of dropping pieces into a well,
matching crockery in the dishwasher rack clumps together into tetrominoes
that float *up* the column, and your job is to put each one away in the
kitchen cupboards at the top: the right cupboard, the right way round, with
no gaps. It runs in any modern browser, on a phone or a desktop, with no
install and no build step.

## How to play

Matching crockery in the dishwasher clumps into tetrominoes that float up
the column, pausing at each cupboard. Turn each piece the right way round
and push it in sideways. The first piece claims an empty cupboard for its
shape; after that every piece must fit flush with no gaps (a green outline
shows where it would land, red means it will not fit), and each shape gets
just one cupboard. Misses, misfits and dawdlers come back as chipped plates
at the bottom. Fly the I-shaped cutlery flat into the drawer on top to clear
a row, and swipe a full cupboard shut for a bonus. Don't let the dishes
reach the cupboards!

## Controls

| | Touch | Keyboard |
|---|---|---|
| Move | Tap left or right of the piece (hold to slide) | Left / Right (or A / D) |
| Turn | Tap the piece | Up, X or W clockwise; Z anticlockwise |
| Next shelf | Swipe up | Space |
| Back a shelf | Swipe down | Down (or S) |
| Shut a cupboard door | Swipe across the cupboard | 1-3 left cupboards (top to bottom), 4-6 right |
| Pause | Pause button | P or Esc |
| Sound | Speaker button | M |
| Start / play again | Start button | Enter |

With a mouse, a quick sideways drag across a cupboard shuts it too.

## Rules as implemented

The original description (below) leaves room for interpretation. These are
the choices made, aiming for the most fun game:

- **The column and the rack.** The black column is 10 squares wide and 22
  tall. The game starts with 3 rows of random crockery at the bottom (plates,
  mugs and bowls; glasses join at level 5 and saucepans at level 10). Every
  few seconds the dishwasher pushes in a new row of random dishes at the
  bottom, with gaps, and the rows above are pushed up. Dishes fall straight
  down into any hole below them, and a dish on a column more than two higher
  than its neighbour slides off onto the lower side, like a pile of plates
  settling, so the rack never grows thin spires.
- **How a piece forms.** Four or more same-kind dishes touching edge to edge
  form a piece. Any four connected squares are always one of the seven
  tetrominoes, so the shape decides its type (I, O, T, S, Z, J or L). If a
  clump is bigger than four, the top four lift off and the rest stay. A
  forming piece glows and wobbles for a moment, then lifts off and flies
  upwards. Pieces can chain: dishes drop into the hole it leaves and may form
  another. Lifting every last dish out of the rack scores a big
  "Dishwasher empty!" bonus.
- **Several pieces at once.** Pieces lift off at least about a second apart,
  topmost first, and at most three fly at a time. The uppermost flying piece
  is the one you steer; the others rise and wait just below the cupboards
  for their turn.
- **Cupboards.** Three cupboards on each side of the top of the column, each
  two squares high. A rising piece pauses briefly at each cupboard level
  ("shelf"), like a lift stopping at floors, and waits at the top. To put it
  away, push it sideways into the cupboard while it is level with it. Only
  pieces lying flat (exactly two squares high) fit through a cupboard
  opening; anything else just bumps the side. Overshot a shelf? Drop back
  down to it (swipe down or press Down).
- **Patience.** Once a piece reaches the cupboards a ring next to it starts
  emptying. When the ring runs out the piece is sent back ("Too slow!").
  Sinking back a shelf does not refill it. The ring starts at about six and
  a half seconds and shrinks with each level.
- **Landing preview.** For the cupboard the piece is lined up with (its
  shelf, on the side it is nearer), a green outline shows exactly where it
  would come to rest. A red outline and a cross mean that cupboard would
  send it back, so you can turn it or pick another before you commit.
- **Claiming a cupboard.** The first piece into an empty cupboard claims it
  for its shape, and can go in any way round. A shape can only own one
  cupboard at a time, so an empty cupboard turns away a shape that already
  has one, and says so ("J already has a cupboard").
- **Fitting without gaps.** Each later piece slides in until it touches what
  is already on the shelf, and it must leave no gap in either row. That
  means turning it the right way round: T, J and L have to alternate
  between their two flat orientations, while O, S and Z always tile with
  themselves. Right-hand cupboards are seen from the other side, so the
  orientation that fits is mirrored compared with the left.
- **Full shelves.** Cupboards never fill up: as pieces go in, older ones
  slide out of the back, off the edge of the screen. A little label on the
  shelf edge counts how many pieces are in there.
- **Mistakes.** A piece that goes into the wrong cupboard, a cupboard owned
  by another shape, or the right cupboard the wrong way round is rejected.
  So is a piece whose patience runs out. A rejected piece falls back down
  and lands at the bottom as chipped crockery in its own shape, together
  with a few random dishes, pushing all the rows up. Chipped crockery never
  forms pieces, but it is washed clean (turned back into a random dish) when
  a piece lifts off right next to it.
- **The I piece is special: it is cutlery.** It never goes in a cupboard.
  Instead, fly it to the very top lying flat and line it up with the
  cutlery drawer above the middle of the column: it drops into the drawer
  and the whole bottom row of the rack is cleared, which is the one way to
  claw back space. That also leaves exactly six shapes for six cupboards.
- **Shutting a door.** Swipe across a cupboard (or press its number key) to
  shut its door. That banks a bonus for everything in it, empties it, and
  after a moment it opens again ready to be claimed by any shape. While the
  door is shut it acts as a wall. A swipe was chosen over press-and-hold so
  that holding a finger beside the piece to slide it never shuts a door by
  accident.
- **Game over.** When the dishes stack up into the cupboard zone (the dashed
  red line, which pulses as they get close), the kitchen is full and the
  game ends, just as in normal tetris.
- **Scoring.** Every piece put away scores (20 + 10 x run) x level, where
  the run counts pieces put away in a row without a mistake (capped at
  +100), and a piece that leaves its shelf level ("Neat!") adds 30 x level.
  Shutting a door scores 5 x level x (pieces in it) squared, so long tidy
  shelves pay. The cutlery drawer scores 100 x level plus 10 per dish
  cleared. An empty dishwasher is worth 1,000 x level, and washing chipped
  crockery 5 a dish.
- **Difficulty.** Every 10 pieces put away is a new level. Each level brings
  new rows sooner, makes pieces rise faster, shortens the pause at each
  shelf and the patience ring. More kinds of dish arrive at levels 5 and 10,
  so pieces form less often, and from level 12 the new rows get fuller.
  Leaving the game alone ends it in about a minute; a steady player lasts
  five minutes or more and reaches level 8 to 14.
- **The title screen** plays a demo game, run by the same autopilot used for
  balancing, so you can see what is going on before reading a word.

## The original idea

> The layout is centred on the familar black column, at the bottom are 3 rows of random squares.
> At the top side though, there are cupboards, 3 each side, 2 squares high. The user decides which cupboard is for which piece by placing the first in it. (The I piece is special in some way.)
>
> A row of random squares appears at the bottom. If a piece is formed, it starts the fly upwards. The player has to get it in the right cupboard and the right way round so that it fits without any gaps (except the first piece in the cupboard), otherwise it appears at the bottom of the screen and pushes the rows upwards.
> Multiple pieces could end up flying at the same time, but they need to have a small delay so the upper most one is the playing piece.
> Needs to be mobile friendly so eg. tap the piece to rotate, tap left of screen to go left and right of screen to go right.
> Cursor key usage for those with a keyboard.
> The items in the cupboard simply go off the screen to the left or right to make room for more pieces, but with an optional press to close the door which starts the cupboard again, meaning it can accept any type of piece.
> Each piece can only have 1 cupboard at a time, so if there is a cupboard open for a piece other cupboards will reject the piece even if it is empty.
>
> Game plays until the screen is full just like in normal tetris.

## Running it locally

It is a static site using ES modules, so open it through any static web
server (`file://` will not do):

```
python3 -m http.server 8080   # then open http://localhost:8080/
```

Add `?seed=123` to the URL for a repeatable game, and `?demo=0` to turn off
the demo behind the title screen.

## Development

```
node --test tests/*.test.js          # unit tests for the core rules (Node 18+)
python tests/playtest.py             # Playwright playtest, desktop and mobile
node tools/sim.js 20 260 0.06        # balancing: 20 games, 260 ms reactions, 6% mistakes
```

The playtest needs `pip install playwright` and a Chromium from
`playwright install chromium`. It serves the folder, plays real games with
key presses on a desktop viewport and with taps and swipes in 360x640
mobile emulation, checks the title card fits at phone and landscape sizes,
saves screenshots to `tests/shots/` and fails on any console error.

- `index.html`, `style.css`: the page, title, pause and game over cards,
  and the pause and sound buttons.
- `src/game.js`: game state and rules, no DOM. `src/stack.js`: the rack
  (gravity, settling, forming pieces, washing). `src/cupboard.js`: cupboard
  fitting rules. `src/pieces.js`: tetromino shapes.
- `src/render.js`, `src/layout.js`: Canvas 2D drawing, all in code: no
  images, fonts or other assets. `src/input.js`: keyboard and touch.
  `src/audio.js`: WebAudio clinks and thuds.
- `src/bot.js`: a small autopilot, used for the title demo, for balancing
  (`tools/sim.js`) and to advise the playtest, which then plays through
  real key presses and taps.

Hosting: GitHub Pages serves the repository root as it is (`.nojekyll`
keeps Jekyll out of the way).

## Credits

Game idea and design by [Vortitron](https://github.com/Vortitron). Code,
art (drawn in code) and sound (synthesised with WebAudio) written with
Claude Code. No third-party assets or libraries are used in the game.

Released under the MIT licence: see [LICENSE](LICENSE).

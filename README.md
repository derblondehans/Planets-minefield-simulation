# Planets Minefield Simulation

A Tampermonkey userscript for [planets.nu](https://planets.nu/) that draws
simulated minefield sizes on the star map. It does not change, save or send
any game data.

Desktop interface only.

## Install

1. Install the Tampermonkey browser extension.
2. Open the Tampermonkey dashboard, create a new script and replace its content
   with `planets-minefield-simulation.user.js`, then save.
3. Open a game on planets.nu. A **Minefields** button appears at the bottom left
   of the map.

## Use

1. **Location**: click *Pick on map* and then click on the map (a planet or ship
   under the mouse is used exactly), or enter a planet (id or name), a ship (id)
   or coordinates (`x, y`) and press *Set*.
2. **Existing minefields**: if minefields cover the location, the panel lists
   them. Choose the field to enlarge, or *Create a new field*. The field the
   host would grow (your closest own normal field) is preselected. An enlarged
   field keeps its center.
3. **Torpedo type**: the torpedoes of the game, with their mines per torpedo.
   Tick *Robots (4× mines)* to simulate the Robot bonus; it is off by default
   and never set automatically. The *max field size* is preset from your race
   and can be changed.
4. **Torpedoes**: either *all circles in steps of 10 torpedoes* (up to the max
   field size), or one circle for a given number of torpedoes.
5. Press **Draw**. Each simulation gets its own color; circles are dashed and
   labeled with torpedoes and radius. Remove simulations one by one or all at
   once.

Simulations are kept per game in the browser's `localStorage`. A simulation
that enlarges a field uses that field's mine count at the moment it was drawn.

## Rules used

Taken from the planets.nu client (`nu.js`, `LayMinefield`, `minefieldRadius`):

- mines per torpedo = torpedo id² (Mark 1 = 1, Mark 8 = 100)
- Robots lay 4× the mines
- radius = floor(√mines), at most 150 ly
- max mines per field: 10000 (100 ly), or 22500 (150 ly) with the race
  advantage *Lay Large Minefields*
- laying inside an existing field adds the mines to that field

Not simulated: hidden mines, mine decay over turns, `md*` friendly codes.

## When planets.nu changes

The script uses internal parts of the planets.nu client, not a public API. All
of them are in one place in the script (the *game adapter*). When a game opens,
the script checks that they are all there. If the client has changed, the panel
says what is missing and the simulation turns itself off instead of drawing
wrong circles.

## Versions

The changes in each version are in [CHANGELOG.md](CHANGELOG.md). Every version
is tagged in Git as `vX.Y.Z`. To see which version you have installed, look at
`@version` in the script in the Tampermonkey dashboard.

To release a new version:

1. Raise `@version` in the script's header.
2. Add the version with its date and changes at the top of `CHANGELOG.md`, and
   its compare link at the bottom.
3. Commit, then tag the commit: `git tag -a vX.Y.Z -m "<the version's notes>"`.
4. Push the commit and the tag: `git push && git push origin vX.Y.Z`.

## License

Licensed under the [Apache License, Version 2.0](LICENSE).

# Changelog

All notable changes to this userscript. The version is the `@version` in the
script's header; each version is tagged in Git as `vX.Y.Z`.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and versions follow [Semantic Versioning](https://semver.org/).

## [0.3.0] - 2026-11-21

### Added

- A field next to *All circles in steps of 10 torpedoes* for the maximum
  number of torpedoes, 250 by default. The circles stop there even when the
  field has not reached its max size. A maximum that is not a multiple of 10
  gets its own last circle.
- A color choice above the *Draw* button: *Random* (the default) or one of 10
  colors.

### Changed

- *Random* picks a palette color that no simulation uses yet, so two
  simulations no longer get the same color after one was removed.

### Security

- Every value written into the panel's HTML is escaped, also the color and id
  of a simulation and the torpedo id.
- Simulations loaded from the browser's storage are checked first: entries
  without the expected shape are dropped, and a color that is not a hex color
  is replaced by a palette color.

## [0.2.0] - 2026-11-21

### Fixed

- Picking a location on the map no longer lets the game act on the same
  click. The game treats the mouse release as the click, so the release could
  select the planet or ship under the mouse. The script now catches the press,
  the release and the click.
- A pick also finishes when the mouse button is released outside the map.
- Picking a planet or ship at the map's edge on a sphere map uses the real
  object, not its wrap-around copy.
- The object under the mouse is now found at the clicked point, the way the
  game does it, instead of from the last mouse move.

### Changed

- All access to the planets.nu client goes through one place in the script
  (the game adapter).
- When a game opens, the script checks that the parts of the client it needs
  are there. If the client has changed, the panel names what is missing and
  the simulation turns itself off instead of drawing wrong circles.

## [0.1.2] - 2026-11-20

### Fixed

- On sphere maps, the wrap-around copies of minefields at the map's edge are
  no longer listed as extra fields to enlarge.

## [0.1.1] - 2026-11-20

First published version.

### Added

- Draws simulated minefield sizes on the planets.nu star map, without changing
  or sending any game data.
- Location by picking on the map, or by planet (id or name), ship id or
  coordinates.
- Lists the minefields that cover the location; enlarge one of them (the field
  the host would grow is preselected) or create a new field.
- Torpedo type from the game, a *Robots (4× mines)* checkbox (off by default)
  and a max field size preset from the race advantage *Lay Large Minefields*.
- All circles in steps of 10 torpedoes, or one circle for a given number.
- Simulations are kept per game in the browser and can be removed one by one
  or all at once.

[0.3.0]: https://github.com/derblondehans/Planets-minefield-simulation/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/derblondehans/Planets-minefield-simulation/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/derblondehans/Planets-minefield-simulation/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/derblondehans/Planets-minefield-simulation/releases/tag/v0.1.1

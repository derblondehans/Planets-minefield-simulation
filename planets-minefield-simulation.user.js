// ==UserScript==
// @name         planets.nu Minefield Simulation
// @namespace    planets-minefield-simulation
// @version      0.2.0
// @description  Draws simulated minefield sizes on the planets.nu star map. Nothing is sent to the game.
// @license      Apache-2.0
// @match        https://planets.nu/*
// @run-at       document-idle
// @grant        none
// @noframes
// ==/UserScript==

/*
 * Rules taken from the planets.nu client (nu.js, LayMinefield / minefieldRadius):
 *   mines per torpedo = torpedo id ^ 2 (tech level squared)
 *   Robots lay 4x the mines
 *   radius = floor(sqrt(units)), at most 150
 *   max units per field: 10000 (100 ly), 22500 (150 ly) with "Lay Large Minefields"
 *   laying inside an existing field adds the units to that field (at its center)
 * The script only draws on the map. It never changes or saves game data.
 */
(function () {
    "use strict";

    const PLUGIN_NAME = "MinefieldSimulation";
    const STORAGE_PREFIX = "planets-minefield-simulation:";
    const ADV_LAY_LARGE_MINEFIELDS = 48;
    const COLORS = ["#ffcc00", "#00e5ff", "#ff5cf0", "#7cff5c", "#ff8a3d", "#b18cff"];

    let simulations = [];
    let pick = "off"; // "off" | "armed" (waiting for a press) | "pressed" (waiting for the release)
    let pickPoint = null; // map point of the caught press
    let swallowClickUntil = 0; // catch the browser's click event shortly after a caught release
    let compatible = true; // false when the client lacks something the script needs
    let panel = null;
    let currentLocation = null; // { x, y, label }

    // ---------- game adapter ----------
    // The only place that touches the planets.nu client (vgap). All of it is
    // the client's internal code, not a public API, so a client update may
    // change it. missingFeatures() names what the script needs and no longer
    // finds; the script then turns itself off instead of failing silently.
    // On sphere maps the client adds wrap-around copies of objects with the
    // negative id of the original (vgap.sphereClone); the adapter always
    // returns the originals.

    const isFn = (f) => typeof f === "function";

    const REQUIRED_FEATURES = [
        ["vgap.registerPlugin", () => isFn(vgap.registerPlugin)],
        ["vgap.map.draw", () => isFn(vgap.map.draw)],
        ["vgap.map.screenX / screenY", () => isFn(vgap.map.screenX) && isFn(vgap.map.screenY)],
        ["vgap.map.mapX / mapY", () => isFn(vgap.map.mapX) && isFn(vgap.map.mapY)],
        ["vgap.map.zoom", () => typeof vgap.map.zoom === "number"],
        ["vgap.map.ctx", () => !!vgap.map.ctx && isFn(vgap.map.ctx.arc)],
        ["vgap.map.canvas", () => vgap.map.canvas instanceof HTMLCanvasElement],
        ["vgap.minefields", () => Array.isArray(vgap.minefields)],
        ["vgap.torpedos", () => Array.isArray(vgap.torpedos)],
        ["vgap.planets", () => Array.isArray(vgap.planets)],
        ["vgap.getPlanet / getShip", () => isFn(vgap.getPlanet) && isFn(vgap.getShip)],
    ];

    const game = {
        // The client script has loaded and plugins can be registered.
        loaded() {
            return typeof vgap !== "undefined" && !!vgap && isFn(vgap.registerPlugin);
        },

        // A game is open and its map exists.
        ready() {
            return game.loaded() && !!vgap.map && !!vgap.map.ctx && !!vgap.player && vgap.player.id > 0;
        },

        missingFeatures() {
            return REQUIRED_FEATURES.filter(([, test]) => {
                try {
                    return !test();
                } catch (e) {
                    return true;
                }
            }).map(([name]) => name);
        },

        gameId() {
            return vgap.game && vgap.game.id ? vgap.game.id : null;
        },

        playerId() {
            return vgap.player.id;
        },

        registerPlugin(hooks, name) {
            vgap.registerPlugin(hooks, name);
        },

        redraw() {
            vgap.map.draw();
        },

        context() {
            return vgap.map.ctx;
        },

        zoom() {
            return vgap.map.zoom;
        },

        // Map coordinates (ly) to canvas pixels.
        toScreen(x, y) {
            return { x: vgap.map.screenX(x), y: vgap.map.screenY(y) };
        },

        // Mouse position to map coordinates, the way the client does it (map.showInfo).
        toMap(clientX, clientY) {
            return { x: Math.round(vgap.map.mapX(clientX)), y: Math.round(vgap.map.mapY(clientY)) };
        },

        isMapCanvas(target) {
            return target === vgap.map.canvas;
        },

        // The planet or ship the client would pick at this map point, or null.
        objectAt(x, y) {
            let hit = null;
            try {
                hit = isFn(vgap.map.checkForHit) ? vgap.map.checkForHit(x, y) : vgap.map.over;
            } catch (e) {
                hit = vgap.map.over;
            }
            if (!hit) return null;
            if (hit.isPlanet) return game.planet(Math.abs(hit.id));
            if (hit.hullid) return game.ship(Math.abs(hit.id));
            return null;
        },

        planet(id) {
            const p = vgap.getPlanet(id);
            return p ? { kind: "planet", id: p.id, name: p.name, x: p.x, y: p.y } : null;
        },

        planetByName(name) {
            const wanted = name.toLowerCase();
            const p = vgap.planets.find((pl) => pl.id > 0 && pl.name && pl.name.toLowerCase() === wanted);
            return p ? game.planet(p.id) : null;
        },

        ship(id) {
            const s = vgap.getShip(id);
            return s ? { kind: "ship", id: s.id, name: s.name, x: s.x, y: s.y } : null;
        },

        // Real minefields only: no sphere copies, no empty fields.
        minefields() {
            return vgap.minefields
                .filter((mf) => mf.id > 0 && mf.units > 0)
                .map((mf) => ({ id: mf.id, ownerid: mf.ownerid, x: mf.x, y: mf.y, units: mf.units, radius: mf.radius, isweb: !!mf.isweb }));
        },

        minefield(id) {
            return game.minefields().find((mf) => mf.id === id) || null;
        },

        torpedoes() {
            return vgap.torpedos.map((t) => ({ id: t.id, name: t.name })).sort((a, b) => a.id - b.id);
        },

        playerLabel(ownerId) {
            if (ownerId === vgap.player.id) return "you";
            const player = isFn(vgap.getPlayer) ? vgap.getPlayer(ownerId) : null;
            if (!player) return "player " + ownerId;
            const race = isFn(vgap.getRace) ? vgap.getRace(player.raceid) : null;
            return (race && race.shortname ? race.shortname : "player") + " (" + ownerId + ")";
        },

        hasLargeMinefields() {
            try {
                return isFn(vgap.advActive) && !!vgap.advActive(ADV_LAY_LARGE_MINEFIELDS);
            } catch (e) {
                return false;
            }
        },

        distance(x1, y1, x2, y2) {
            if (isFn(vgap.getSphereDistance)) return vgap.getSphereDistance(x1, y1, x2, y2);
            return Math.sqrt((x1 - x2) * (x1 - x2) + (y1 - y2) * (y1 - y2));
        },
    };

    // ---------- helpers ----------

    function storageKey() {
        return STORAGE_PREFIX + (game.gameId() || "unknown");
    }

    function loadSimulations() {
        try {
            const raw = localStorage.getItem(storageKey());
            simulations = raw ? JSON.parse(raw) : [];
        } catch (e) {
            simulations = [];
        }
    }

    function saveSimulations() {
        try {
            localStorage.setItem(storageKey(), JSON.stringify(simulations));
        } catch (e) {
            // Storage may be blocked; the simulations then last only for this page.
        }
    }

    function minefieldRadius(units) {
        return Math.min(150, Math.floor(Math.sqrt(units)));
    }

    function defaultMaxUnits() {
        return game.hasLargeMinefields() ? 22500 : 10000;
    }

    function objectLabel(obj) {
        return (obj.kind === "planet" ? "Planet " : "Ship ") + obj.id + " " + obj.name;
    }

    function escapeHtml(text) {
        return String(text).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    // Existing minefields that cover the point, and the one the host would grow:
    // the closest own field of the same kind that covers the point.
    function fieldsAt(x, y) {
        const fields = game.minefields()
            .map((mf) => ({ mf, dist: game.distance(x, y, mf.x, mf.y) }))
            .filter((f) => f.dist <= f.mf.radius);
        let hostChoice = null;
        for (const f of fields) {
            if (f.mf.ownerid === game.playerId() && !f.mf.isweb && (!hostChoice || f.dist < hostChoice.dist))
                hostChoice = f;
        }
        return { fields, hostChoice: hostChoice ? hostChoice.mf : null };
    }

    // ---------- simulation ----------

    function buildCircles(baseUnits, unitsPerTorp, maxUnits, torpCounts) {
        const cap = Math.max(maxUnits, baseUnits);
        const circles = [];
        for (const torps of torpCounts) {
            const wanted = baseUnits + torps * unitsPerTorp;
            const units = Math.min(cap, wanted);
            circles.push({ torps, units, radius: minefieldRadius(units), capped: wanted > cap });
            if (wanted >= cap) break;
        }
        return circles;
    }

    function stepCounts(baseUnits, unitsPerTorp, maxUnits) {
        const counts = [];
        const cap = Math.max(maxUnits, baseUnits);
        for (let torps = 10; torps <= 10000; torps += 10) {
            counts.push(torps);
            if (baseUnits + torps * unitsPerTorp >= cap) break;
        }
        return counts;
    }

    function createSimulation() {
        const msg = panel.querySelector("#mfs-message");
        msg.textContent = "";
        if (!currentLocation) {
            msg.textContent = "Choose a location first.";
            return;
        }
        const torpId = parseInt(panel.querySelector("#mfs-torp").value, 10);
        const robots = panel.querySelector("#mfs-robots").checked;
        const maxUnits = parseInt(panel.querySelector("#mfs-max").value, 10);
        const mode = panel.querySelector("input[name=mfs-mode]:checked").value;
        const unitsPerTorp = torpId * torpId * (robots ? 4 : 1);

        let base = null;
        const choice = panel.querySelector("input[name=mfs-field]:checked");
        if (choice && choice.value !== "new")
            base = game.minefield(parseInt(choice.value, 10));

        const baseUnits = base ? base.units : 0;
        const x = base ? base.x : currentLocation.x;
        const y = base ? base.y : currentLocation.y;

        let counts;
        if (mode === "steps") {
            counts = stepCounts(baseUnits, unitsPerTorp, maxUnits);
        } else {
            const torps = parseInt(panel.querySelector("#mfs-count").value, 10);
            if (!(torps > 0)) {
                msg.textContent = "Enter a torpedo count above 0.";
                return;
            }
            counts = [torps];
        }

        const torp = game.torpedoes().find((t) => t.id === torpId);
        simulations.push({
            id: Date.now(),
            x,
            y,
            color: COLORS[simulations.length % COLORS.length],
            label: currentLocation.label,
            torpName: torp ? torp.name : "Torpedo " + torpId,
            unitsPerTorp,
            baseUnits,
            baseFieldId: base ? base.id : null,
            circles: buildCircles(baseUnits, unitsPerTorp, maxUnits, counts),
        });
        saveSimulations();
        renderList();
        redraw();
    }

    // ---------- drawing ----------

    function redraw() {
        if (compatible && game.ready()) game.redraw();
    }

    function drawSimulations() {
        if (!compatible || !game.ready() || simulations.length === 0) return;
        const ctx = game.context();
        const zoom = game.zoom();
        ctx.save();
        ctx.font = "11px Arial, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        for (const sim of simulations) {
            const { x: sx, y: sy } = game.toScreen(sim.x, sim.y);
            ctx.strokeStyle = sim.color;
            ctx.fillStyle = sim.color;

            // center mark
            ctx.setLineDash([]);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(sx - 4, sy);
            ctx.lineTo(sx + 4, sy);
            ctx.moveTo(sx, sy - 4);
            ctx.lineTo(sx, sy + 4);
            ctx.stroke();

            ctx.setLineDash([5, 4]);
            for (const c of sim.circles) {
                const r = c.radius * zoom;
                if (r < 1) continue;
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2, false);
                ctx.stroke();
                if (r > 12)
                    ctx.fillText(c.torps + "T · " + c.radius + " ly" + (c.capped ? " (max)" : ""), sx, sy - r - 1);
            }
        }
        ctx.restore();
    }

    // ---------- location ----------

    function setLocation(x, y, label) {
        currentLocation = { x: Math.round(x), y: Math.round(y), label };
        panel.querySelector("#mfs-location").textContent = label + " (" + currentLocation.x + ", " + currentLocation.y + ")";
        renderFieldChoice();
    }

    function renderFieldChoice() {
        const box = panel.querySelector("#mfs-fields");
        if (!currentLocation) {
            box.innerHTML = "";
            return;
        }
        const { fields, hostChoice } = fieldsAt(currentLocation.x, currentLocation.y);
        if (fields.length === 0) {
            box.innerHTML = "<div class='mfs-hint'>No minefield at this location: a new field is simulated.</div>";
            return;
        }
        let html = "<div class='mfs-label'>Minefields at this location — enlarge one or create a new one:</div>";
        for (const f of fields) {
            const mf = f.mf;
            const checked = hostChoice && hostChoice.id === mf.id ? " checked" : "";
            html += "<label class='mfs-row'><input type='radio' name='mfs-field' value='" + escapeHtml(mf.id) + "'" + checked + ">" +
                "Field #" + escapeHtml(mf.id) + " of " + escapeHtml(game.playerLabel(mf.ownerid)) + (mf.isweb ? ", web" : "") +
                ": " + escapeHtml(mf.units) + " mines, " + escapeHtml(mf.radius) + " ly" +
                (hostChoice && hostChoice.id === mf.id ? " <i>(the host would grow this one)</i>" : "") + "</label>";
        }
        html += "<label class='mfs-row'><input type='radio' name='mfs-field' value='new'" + (hostChoice ? "" : " checked") + ">Create a new field</label>";
        box.innerHTML = html;
    }

    function locationFromInputs() {
        const msg = panel.querySelector("#mfs-message");
        msg.textContent = "";
        const kind = panel.querySelector("#mfs-loc-kind").value;
        const value = panel.querySelector("#mfs-loc-value").value.trim();
        if (kind === "planet") {
            const id = parseInt(value, 10);
            const planet = !isNaN(id) && String(id) === value ? game.planet(id) : game.planetByName(value);
            if (!planet) return (msg.textContent = "Planet not found.");
            setLocation(planet.x, planet.y, objectLabel(planet));
        } else if (kind === "ship") {
            const ship = game.ship(parseInt(value, 10));
            if (!ship) return (msg.textContent = "Ship not found.");
            setLocation(ship.x, ship.y, objectLabel(ship));
        } else {
            const parts = value.split(/[\s,;]+/).map((v) => parseInt(v, 10));
            if (parts.length !== 2 || parts.some(isNaN)) return (msg.textContent = "Enter coordinates as x, y.");
            setLocation(parts[0], parts[1], "Point");
        }
    }

    function setPickButton(active) {
        const button = panel.querySelector("#mfs-pick");
        button.textContent = active ? "Click on the map…" : "Pick on map";
        button.classList.toggle("mfs-active", active);
    }

    function startPick() {
        pick = "armed";
        setPickButton(true);
    }

    // A press already caught stays caught until its release (see onMapMouse).
    function stopPick() {
        if (pick === "armed") pick = "off";
        setPickButton(false);
    }

    function swallow(event) {
        event.stopPropagation();
        event.preventDefault();
    }

    // Takes one whole click on the map away from the game. The client treats a
    // mouseup near its mousedown as a click on the map (map.mouseup calls
    // map.click), so the press, the release and the browser's click event are
    // all caught before the game's handlers on the canvas see them; otherwise
    // the game would select the object under the mouse or start panning.
    function onMapMouse(event) {
        if (event.type === "mousedown") swallowClickUntil = 0;
        if (event.type === "click" && Date.now() < swallowClickUntil && !panel.contains(event.target)) {
            swallowClickUntil = 0;
            swallow(event);
            return;
        }
        if (pick === "off" || !compatible || !game.ready()) return;

        if (pick === "pressed") {
            // The release may happen outside the canvas; finish the pick anyway.
            if (event.type !== "mouseup") return;
            swallow(event);
            pick = "off";
            swallowClickUntil = Date.now() + 500;
            finishPick();
            return;
        }

        // pick === "armed"
        if (!game.isMapCanvas(event.target)) return;
        swallow(event);
        if (event.type === "mousedown" && event.button === 0) {
            pickPoint = game.toMap(event.clientX, event.clientY);
            pick = "pressed";
        }
    }

    function finishPick() {
        setPickButton(false);
        const obj = game.objectAt(pickPoint.x, pickPoint.y);
        if (obj) setLocation(obj.x, obj.y, objectLabel(obj));
        else setLocation(pickPoint.x, pickPoint.y, "Point");
    }

    // ---------- panel ----------

    function renderList() {
        const list = panel.querySelector("#mfs-list");
        if (simulations.length === 0) {
            list.innerHTML = "<div class='mfs-hint'>No simulations yet.</div>";
            return;
        }
        list.innerHTML = simulations.map((sim) => {
            const last = sim.circles[sim.circles.length - 1];
            const what = sim.circles.length > 1
                ? sim.circles.length + " circles up to " + last.torps + "T / " + last.radius + " ly"
                : last.torps + "T → " + last.units + " mines, " + last.radius + " ly";
            const base = sim.baseFieldId !== null ? ", adds to field #" + sim.baseFieldId : "";
            return "<div class='mfs-item'><span class='mfs-swatch' style='background:" + sim.color + "'></span>" +
                "<span>" + escapeHtml(sim.label) + ", " + escapeHtml(sim.torpName) + base + ": " + escapeHtml(what) + "</span>" +
                "<button data-remove='" + sim.id + "' title='Remove'>✕</button></div>";
        }).join("");
    }

    function fillTorpedoes() {
        const select = panel.querySelector("#mfs-torp");
        const previous = select.value;
        const list = game.torpedoes();
        select.innerHTML = list.map((t) => "<option value='" + t.id + "'>" + escapeHtml(t.name) + " (" + t.id * t.id + " mines/torp)</option>").join("");
        if (previous && list.some((t) => String(t.id) === previous)) select.value = previous;
        else if (list.length) select.value = String(list[list.length - 1].id);
    }

    // Turns the script off, with a notice in the panel, when the client lacks
    // something it needs (see the game adapter).
    function checkCompatibility() {
        const missing = game.missingFeatures();
        compatible = missing.length === 0;
        const notice = panel.querySelector("#mfs-compat");
        notice.style.display = compatible ? "none" : "block";
        notice.textContent = compatible ? "" :
            "The planets.nu client has changed: " + missing.join(", ") + " not found. The simulation is turned off until the script is updated.";
        for (const id of ["#mfs-pick", "#mfs-loc-set", "#mfs-draw"])
            panel.querySelector(id).disabled = !compatible;
        if (!compatible) {
            stopPick();
            console.warn("[" + PLUGIN_NAME + "] missing in the planets.nu client:", missing);
        }
        return compatible;
    }

    function resetForGame() {
        if (!checkCompatibility()) return;
        loadSimulations();
        fillTorpedoes();
        panel.querySelector("#mfs-max").value = String(defaultMaxUnits());
        currentLocation = null;
        panel.querySelector("#mfs-location").textContent = "none";
        renderFieldChoice();
        renderList();
    }

    function createPanel() {
        const style = document.createElement("style");
        style.textContent = `
#mfs-toggle { position: fixed; left: 10px; bottom: 10px; z-index: 10001; padding: 6px 10px; background: #1d2533; color: #ffcc00;
  border: 1px solid #ffcc00; border-radius: 4px; font: 12px Arial, sans-serif; cursor: pointer; }
#mfs-panel { position: fixed; left: 10px; bottom: 46px; z-index: 10001; width: 340px; max-height: 70vh; overflow-y: auto;
  background: rgba(20, 26, 36, 0.95); color: #ddd; border: 1px solid #556; border-radius: 6px; padding: 10px;
  font: 12px Arial, sans-serif; display: none; }
#mfs-panel h3 { margin: 0 0 8px; font-size: 14px; color: #ffcc00; }
#mfs-panel .mfs-section { margin-bottom: 10px; }
#mfs-panel .mfs-label { color: #aab; margin-bottom: 3px; }
#mfs-panel .mfs-row { display: block; margin: 2px 0; cursor: pointer; }
#mfs-panel .mfs-hint { color: #889; font-style: italic; }
#mfs-panel input[type=text], #mfs-panel input[type=number], #mfs-panel select { background: #0e131b; color: #eee;
  border: 1px solid #556; border-radius: 3px; padding: 2px 4px; font: 12px Arial, sans-serif; }
#mfs-panel button { background: #2a3445; color: #eee; border: 1px solid #667; border-radius: 3px; padding: 3px 8px; cursor: pointer; font: 12px Arial, sans-serif; }
#mfs-panel button:hover { background: #3a465c; }
#mfs-panel button.mfs-active { background: #ffcc00; color: #000; }
#mfs-panel .mfs-item { display: flex; align-items: center; gap: 6px; margin: 3px 0; }
#mfs-panel .mfs-item span:nth-child(2) { flex: 1; }
#mfs-panel .mfs-item button { padding: 0 5px; }
#mfs-panel .mfs-swatch { width: 10px; height: 10px; border-radius: 50%; flex: none; }
#mfs-panel button:disabled { opacity: 0.4; cursor: default; }
#mfs-message { color: #ff7b7b; min-height: 14px; }
#mfs-compat { display: none; color: #ff7b7b; border: 1px solid #ff7b7b; border-radius: 3px; padding: 4px; margin-bottom: 8px; }
`;
        document.head.appendChild(style);

        const toggle = document.createElement("button");
        toggle.id = "mfs-toggle";
        toggle.textContent = "Minefields";
        toggle.style.display = "none";
        document.body.appendChild(toggle);

        panel = document.createElement("div");
        panel.id = "mfs-panel";
        panel.innerHTML = `
<h3>Minefield simulation</h3>
<div id="mfs-compat"></div>
<div class="mfs-section">
  <div class="mfs-label">Location: <b id="mfs-location">none</b></div>
  <button id="mfs-pick">Pick on map</button>
  <div style="margin-top:4px">
    <select id="mfs-loc-kind">
      <option value="planet">Planet (id or name)</option>
      <option value="ship">Ship (id)</option>
      <option value="coords">Coordinates (x, y)</option>
    </select>
    <input type="text" id="mfs-loc-value" style="width:90px">
    <button id="mfs-loc-set">Set</button>
  </div>
  <div id="mfs-fields" style="margin-top:6px"></div>
</div>
<div class="mfs-section">
  <div class="mfs-label">Torpedo type</div>
  <select id="mfs-torp" style="width:100%"></select>
  <label class="mfs-row"><input type="checkbox" id="mfs-robots"> Robots (4× mines)</label>
  <label class="mfs-row">Max field size:
    <select id="mfs-max">
      <option value="10000">10000 mines (100 ly)</option>
      <option value="22500">22500 mines (150 ly, Lay Large Minefields)</option>
    </select>
  </label>
</div>
<div class="mfs-section">
  <div class="mfs-label">Torpedoes</div>
  <label class="mfs-row"><input type="radio" name="mfs-mode" value="steps" checked> All circles in steps of 10 torpedoes</label>
  <label class="mfs-row"><input type="radio" name="mfs-mode" value="manual"> Number of torpedoes:
    <input type="number" id="mfs-count" min="1" value="50" style="width:70px"></label>
</div>
<div class="mfs-section">
  <button id="mfs-draw">Draw</button>
  <button id="mfs-clear">Remove all</button>
  <div id="mfs-message"></div>
</div>
<div class="mfs-section">
  <div class="mfs-label">Simulations</div>
  <div id="mfs-list"></div>
</div>`;
        document.body.appendChild(panel);

        // Keep the game's keyboard shortcuts away from the panel's inputs.
        for (const type of ["keydown", "keyup", "keypress"])
            panel.addEventListener(type, (e) => e.stopPropagation());

        toggle.addEventListener("click", () => {
            const open = panel.style.display !== "block";
            panel.style.display = open ? "block" : "none";
            if (open && compatible && game.ready()) {
                fillTorpedoes();
                renderFieldChoice();
            }
            if (!open) stopPick();
        });
        panel.querySelector("#mfs-pick").addEventListener("click", () => (pick === "armed" ? stopPick() : startPick()));
        panel.querySelector("#mfs-loc-set").addEventListener("click", locationFromInputs);
        panel.querySelector("#mfs-loc-value").addEventListener("keydown", (e) => {
            if (e.key === "Enter") locationFromInputs();
        });
        panel.querySelector("#mfs-count").addEventListener("focus", () => {
            panel.querySelector("input[name=mfs-mode][value=manual]").checked = true;
        });
        panel.querySelector("#mfs-draw").addEventListener("click", createSimulation);
        panel.querySelector("#mfs-clear").addEventListener("click", () => {
            simulations = [];
            saveSimulations();
            renderList();
            redraw();
        });
        panel.querySelector("#mfs-list").addEventListener("click", (e) => {
            const id = e.target.getAttribute && e.target.getAttribute("data-remove");
            if (!id) return;
            simulations = simulations.filter((s) => String(s.id) !== id);
            saveSimulations();
            renderList();
            redraw();
        });

        for (const type of ["mousedown", "mouseup", "click"])
            document.addEventListener(type, onMapMouse, true);

        return toggle;
    }

    // ---------- start ----------

    function init() {
        if (!game.loaded()) {
            setTimeout(init, 500);
            return;
        }
        const toggle = createPanel();
        let loadedGame = null;

        const onGameShown = () => {
            if (!game.ready()) return;
            toggle.style.display = "block";
            const gameId = game.gameId();
            if (gameId !== loadedGame) {
                loadedGame = gameId;
                resetForGame();
            }
        };

        game.registerPlugin({
            processload: onGameShown,
            loadmap: onGameShown,
            showmap: onGameShown,
            draw: drawSimulations,
            showdashboard: () => {
                toggle.style.display = "none";
                panel.style.display = "none";
                stopPick();
            },
        }, PLUGIN_NAME);

        // The script may start after a game is already open.
        onGameShown();
    }

    init();
})();

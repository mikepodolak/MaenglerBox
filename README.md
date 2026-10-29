# MaenglerBox

A modular, generative music environment for IDM, built as an installable web app so it runs on iPad, iPhone and desktop.
Inspired by Max/MSP, BespokeSynth and the Dirtywave M8.

## Running it

```sh
npm install
npm run dev      # dev server, reachable from other devices on your network
npm test         # unit tests
npm run build    # production build in dist/
```

On iPad or iPhone, open the app in Safari and use **Share → Add to Home Screen**. It then runs full screen and works offline.
Patches are saved on the device (IndexedDB).

## How it's put together

- `src/patch/` is the patch model: modules, cables and params as plain data. Every edit is a pure function that returns a new patch, which keeps undo, saving and sharing simple.
- `src/engine/` turns a patch into sound. `PatchRuntime` keeps the Web Audio graph in step with the patch, and `Scheduler` is a lookahead clock that stamps gate events with exact audio times.
- `src/modules/` holds module types. Each one has a definition (ports and params) and a `create` function that builds its audio nodes.
- `src/dsp/` holds sample-level DSP that runs in AudioWorklets (the FM synth). It has no Web Audio dependencies, so it's unit-tested in Node.
- `src/ui/` is the interface: the patching canvas, the inspector panel and its step editor.

## Using the canvas

- **Edit / Play** switch in the toolbar. In Edit you move modules and patch cables. In Play the layout and cables are locked and tapping a module opens its settings. The ⚙ on each module opens settings in either mode.
- Drag empty space to pan, pinch (or ctrl+scroll) to zoom. **Fit** brings everything into view.
- In Edit, drag a module by its title bar; it snaps to the dot grid when dropped.
- The cable button (∿ / ⌐) switches between curved cables and tidy right-angle cables.
- Drag from a jack to another jack to patch a cable. Drag a cable off an input to unplug it. Tap a cable to select it, then tap the red × to delete it.
- Jack colours: orange is audio, teal is CV, yellow is gates and notes.
- In the sequencer's step grid, tap a step to select it and tap it again to turn it on or off. The fill shows its chance of playing.
- Undo and redo cover every edit (⌘Z / ⇧⌘Z on a keyboard).

Ports carry three kinds of signal: **audio**, **cv** (modulation) and **gate** (timed events like triggers and notes).
## Presets, patterns and randomizing

- Every module has 16 slots. Pick **Load**, **Save** or **Clear**, then tap a slot. A synth's presets live in a library shared by every patch on the device. A sequencer's slots are its pattern bank and are saved with the patch.
- **Randomize** sets every setting to a random value; **Mutate** nudges each one by the amount slider. Tap a padlock to keep that setting.
- In the sequencer, **Randomize pattern** and **Mutate pattern** rewrite the steps, keeping notes in the chosen scale. The **Keep** buttons protect a step field (notes, chance, …) from both.
- A step's **Preset** value makes the synth it plays play that note with the matching preset, so one FM voice can be a kick on step 1 and a snare on step 5.

## Tracker, conditions and parameter locks

- In the sequencer's settings, switch **Steps** between **Grid** and **Tracker**. The tracker shows one row per step: note, velocity, chance, ratchet, condition, preset and lock count. Tap a cell to put the cursor on it, then use **−− − + ++** to change it. Nudging the note of an empty row switches it on.
- **Conditions** decide which loops a step plays on: `1:2` plays on the first of every two loops, `3:4` on the third of four, **First loop**, **If prev played**, and **Fill** (follows the sequencer's Fill switch).
- **Parameter locks** override a setting of the synth for one step only. Pick one from **+ Lock a setting…**; the list shows the settings of the synth the sequencer's Notes output is patched to.

Audio and CV can be patched into each other; gates only connect to gates.

## Roadmap

1. Foundation: app shell, offline support, audio engine, patch model, on-device saving.
2. Patching canvas and first real modules: FM voice, probabilistic step sequencer.
3. M8-style tracker view with per-step detail and parameter locks.
4. Generative layer: Markov chains, mutation, more modules.

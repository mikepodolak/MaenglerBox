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

- Instruments and sequencers (FM voice, oscillator, envelope, Chance Sequencer, Tracker) have 16 slots, folded away under **Presets** / **Patterns** until you open them. Utilities like Output, VCA and Clock don't.
- Every slot panel works the same way. Pick **Load**, **Save** or **Clear**, then tap a slot. A synth's presets live in a library shared by every patch on the device. A sequencer's slots are its pattern bank and are saved with the patch.
- **Randomize** sets every setting to a random value; **Mutate** nudges each one by the amount slider. Tap a padlock to keep that setting.
- In the sequencer, **Randomize pattern** and **Mutate pattern** rewrite the steps, keeping notes in the chosen scale. The **Keep** buttons protect a step field (notes, chance, …) from both.
- A step's **Preset** value makes the synth it plays play that note with the matching preset, so one FM voice can be a kick on step 1 and a snare on step 5.

## Tracker, conditions and parameter locks

- The sequencer's **Play** setting picks the direction: forward, backward, ping-pong, random, or drunk (one step either way).
- In the sequencer's settings, switch **Steps** between **Grid** and **Tracker**. The tracker shows one row per step: note, velocity, chance, ratchet, condition, preset and lock count. Tap a cell to put the cursor on it, then use **−− − + ++** to change it. Nudging the note of an empty row switches it on.
- Tap **What the columns mean** above the tracker for a key to the column letters.
- **Conditions** decide which loops a step plays on: `1:2` plays on the first of every two loops, `3:4` on the third of four, **First loop**, **If prev played**, and **Fill** (follows the sequencer's Fill switch).
- **Parameter locks** override a setting of the synth for one step only. Pick one from **+ Lock a setting…**; the list shows the settings of the synth the sequencer's Notes output is patched to.

## The Tracker module

**+ Module → Tracker** adds an M8-style tracker: eight tracks on one clock, each with its own **Track** output to patch to its own voice. Every track has the Chance Sequencer's per-step chance, ratchets, conditions, presets and parameter locks.

- In **Tracker** view all eight tracks sit side by side. Tap a cell to edit that step below; the bar nudges its note. Tap a track number at the top to mute or unmute it. Small dots mark steps with a condition (yellow) or parameter locks (teal).
- In **Grid** view, pick a track with the 1–8 buttons and edit it like a Chance Sequencer.
- Parameter locks on a track offer the settings of the synth patched to that track's output.

Audio and CV can be patched into each other; gates only connect to gates.

## Generative modules

The module menu is grouped into Sequencing, Generative, Sound, Modulation and Utility.

- **Chance Gate**: each incoming gate or note goes out A with the set chance, otherwise out B.
- **Probability**: each trigger picks one of four outs by weight. Its Notes out carries the pick as a preset number, so a single FM Voice can act as a random kit.
- **Markov Chain**: a grid of transition weights of up to 16×16. Each row is a state (a note), and its cells set where the chain can go next. Tap a cell to cycle its weight. Each state can repeat or rest.
- **Bouncing Balls**: balls under gravity. Floor hits play notes picked by where the ball lands. Wall and ball-to-ball hits fire their own gates, and ball 1's position comes out as X/Y CV. A gate into Kick throws the balls back up.
- **Game of Life**: Conway's rules on a 16×12 grid you draw. A scan line plays the live cells it crosses, with higher rows playing higher notes. Births and deaths fire gates, and the population is sent out as CV. A stuck grid reseeds itself.
- **Euclidean**: four concentric rings, each spreading its hits evenly over its own loop at its own speed. Each ring has its own output, and Notes plays all four rings with their own pitches.
- **Turing Machine**: a looping random melody that mutates by a chosen amount. It is drawn as a lit pad grid, one column per step.
- **Sample & Hold**: random or drunk-walk values, sent out as CV and as notes.

Every module has a **?** button that opens its help. The help covers what each jack carries, what the main settings do, and example patches you can add in one tap. Visual modules (Balls, Life, Euclidean, Turing, Markov, Probability, Chance Gate, Sample & Hold) can be resized from their corner in Edit mode. In Play mode they show only their drawing; tap the drawing to show the jacks and controls. The Markov grid stays playable on the card in both modes: tap a dial to step its weight, drag up or down to set it, and long-press it in Play mode to show the jacks.

**Patches and recording.** Patches lets you open, rename and delete patches, and **Export** / **Import** them as `.maengler.json` files, so a patch can move between a computer and an iPad (AirDrop, Files, iCloud, email). An exported patch carries the library presets its synths use; on import they fill empty preset slots and never overwrite yours. **Examples** opens ready-made patches, starting with an Autechre-style starter. **● Rec** records the audio output as a 24-bit stereo WAV. When you stop, you can play the recording back, download it, or on iPad share it or save it to Files.

**Any output into any input.** As in VCV Rack, a gate patched into a CV input becomes a level that is high while the note plays. A CV or audio signal patched into a gate input fires a gate each time it rises past 0.5, for example a bouncing ball's height clocking a Markov chain.

## Modulating any setting

Every setting of every module can take a cable. In Edit mode, drag an output (an LFO's Out, a Sample & Hold, even a sequencer's notes) and drop it on any slider, on a card or in the settings panel. The setting gets a `~` jack on its card and the cable plugs into it. The slider's thumb stays where you set it, and a teal dot shows where the cable is moving it right now.

In the settings panel, **Modulation** lists each patched setting with an Amount per cable (negative turns it the other way), lets you unplug or remove a jack, and can add a jack for any setting from a list. The signal is added along the slider's travel, so exponential settings sweep evenly; choice settings step through their options.

The **LFO** module (Modulation) is the usual source: seven shapes, Free rate or synced to a clock (one cycle every so many ticks), a Reset input, and −1..1 or 0..1 range.

## Mixing and monitoring

- **Mixer**: six channels with level, pan, mute and solo into a stereo pair, with a meter per channel and for L/R on its card. Tap S or M under a meter, in Edit or Play mode, to hear one module on its own.
- **Meter**: patch any audio through it to see its level (average, peaks, peak hold, clip lamp, dB readout).
- **Light**: a lamp that flashes for gates and notes, or glows with a signal's level. Both pass through, so it can sit inline.
- **Filter**: low/high/band pass and notch, 12 or 24 dB, with resonance; the card draws the response and follows any cable on Cutoff.
- **EQ**: low shelf, sweepable mid, high shelf, ±15 dB, with the curve drawn on the card.

## Autechre-style setup

- **FM Lead**: a 2-operator FM voice with a resonant low-pass and its own filter envelope, in the spirit of a Nord Lead patch.
- **Pluck**: a Karplus-Strong string: decay, brightness, pluck tone and position.
- **Matrix**: routes 8 gate inputs to 8 outputs. Each crossing is a chance, tapped or dragged right on the card. In **Pick one** mode each note goes to exactly one output, with the row as odds.
- **Conductor**: one per patch. Sets the key, scale and overall chance for every voice: notes going into any synth or effect are transposed, moved into the key and thinned, wherever they come from. Patch an LFO onto Chance to make the whole patch breathe.
- **Preset morphing**: synths with a preset library get a **Morph** section under their presets. Pick From (a slot or the current settings) and To, then move Morph to blend every setting between them, or drop an LFO on Morph to sweep it.

## Drums, pads and textures

- **FM Drum**: a swept sine body, a fast FM modulator and a burst of noise. Kicks, snares, hats, metal and blips; its presets make a whole kit for Probability or step presets to pick from.
- **Pad**: three drifting, detuned oscillators and a sub through a slow resonant filter.
- **Texture**: each note becomes a cloud of sine or noise grains scattered around its pitch: glitter, breath, static and drones.

**Factory presets.** The synths (FM Voice, FM Drum, FM Lead, Pluck, Pad, Texture) start with presets in an IDM palette: sub and click kicks, FM snares, hats and metal ticks, cold bells, acid FM bass, detuned pads, granular choirs. They go into empty library slots once per device and never replace your own.

## Effects

- **Tape Delay**: darkening, saturating repeats with wow and flutter; patch a clock in to sync the echo time.
- **Reverb**: stereo room from small to huge, with damping and pre-delay (mono Out, plus L and R).
- **Phaser**: 4, 6 or 8 swept all-pass stages.
- **Flanger**: a tiny swept delay with positive or negative feedback.
- **Comb**: rings at a pitch; patch notes in and it follows the melody (a resonator, or Karplus-style plucks from drums or clicks).
- **Ring Mod**: multiplies by a built-in carrier or any audio patched into Carrier.
- **Glitch**: on each clock tick it may stutter the slice it just heard, sometimes backwards, with bit and sample-rate crushing.

The flanger and comb run on a per-sample delay line in a worklet, because Web Audio's own delay can't feed back faster than 128 samples.

## Roadmap

1. Foundation: app shell, offline support, audio engine, patch model, on-device saving.
2. Patching canvas and first real modules: FM voice, probabilistic step sequencer.
3. M8-style tracker view with per-step detail and parameter locks.
4. Generative layer: Markov chains, mutation, more modules.

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
- `src/ui/` is the interface. Right now it's a simple list editor; the patching canvas replaces it next.

Ports carry three kinds of signal: **audio**, **cv** (modulation) and **gate** (timed events like triggers and notes).
Audio and CV can be patched into each other; gates only connect to gates.

## Roadmap

1. Foundation: app shell, offline support, audio engine, patch model, on-device saving.
2. Patching canvas and first real modules: FM voice, probabilistic step sequencer.
3. M8-style tracker view with per-step detail and parameter locks.
4. Generative layer: Markov chains, mutation, more modules.

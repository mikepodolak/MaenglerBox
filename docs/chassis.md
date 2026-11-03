# Chassis as a design reference

Mike pointed us at the manual for **Chassis** by Lux Cache (https://luxcache.com/chassis/manual), a semi-modular synth that ships as an instrument plugin and an effect plugin (standalone, VST3, AU). It is a design reference only: MaenglerBox modules inspired by it are original implementations, with our own DSP, names and pattern data.

The online manual stops partway through its sequencing chapters, so the effects, mixing and utility modules below are known only from one-line descriptions.

## Principles worth keeping

1. **One curated set, many modes.** A fixed set of modules designed to work together, each with several modes, rather than an endless library. Good guidance for which modules we add: each should earn its place and combine well with the rest.
2. **Any output into any input.** Audio and control share jacks, so audio used as control is audio-rate modulation, and feedback loops are encouraged (a reverb steering an oscillator's pitch, a follower on the mix driving the sequencer that made it). We already let audio and CV patch into each other and convert gates both ways.
3. **Inputs sum.** Several cables into one input add up like a small mixer.
4. **Shaping on the cable.** Every cable has an attenuator (−2..2, negative inverts), an offset and a slew with a rise/fall shape. We have a per-cable amount; offset and slew are a backlog item.
5. **Invisible shared buses.** Transport, scale, notes and room audio are buses any module follows until a cable overrides it, shown with a link mark. Our Conductor is our scale bus; a transport bus (follow the patch clock without a cable) is a backlog item.
6. **Randomise by intent.** The dice has modes (full random, synth voice, fx web, percussion factory, feedback bloom, fm chaos, vast minimal, mutate…) and can keep key, tempo, patterns and held modules. Our randomize/mutate with padlocks is the start of this.
7. **Signals you can see.** Point at a jack to see a 2-second scope; cables move with their signal (audio shivers, envelopes sag, silence hangs still).
8. **Small-screen-friendly controls.** Stepped controls advance on tap and scrub on drag; values can be typed in their own units (Hz, ms, note names); every action is one undo step.

## Module map, and what we take from each

| Chassis | What it is | MaenglerBox |
|---|---|---|
| grille | 4-lane drum generator reading patterns from an X/Y map, density per lane, chaos, fills, seed lock | **Drum Map** (this PR) |
| atelier | 11 two-input operators: logic, routing, sample and hold | **Logic** (gates) and **Math** (CV) (this PR) |
| quatre | 4 macros, each a playhead over painted lanes | **Lanes** (this PR) |
| sillage | follows how loud a sound is | **Follower** (this PR) |
| frappe | mallet on a tiled resonant object: body, pitch, decay, material, dispersion, bend, exciter, position | **Modal Perc** (this PR) |
| scie | polyphonic supersaw: voices, detune, blend, width, sub, drift | **Supersaw** (this PR) |
| biais | frequency shifter (shifts every partial by the same Hz) | **Freq Shifter** (this PR) |
| fracas | 4 FM percussion voices with pitch sweep, feedback, ratio | covered by FM Drum |
| ton | four-waveform oscillator, sections double as LFOs | covered by Oscillator / LFO |
| corde | wave-field (quantum-ish) wavetable voice | later: a wave-terrain voice |
| clavier | keyboard, arpeggiator, chord, phrase sequencer | later: Arp + Chord modules |
| volet | 8-channel gate wheel with per-step envelopes, slew, shift | later |
| xtrack / xarrange | 8-track tracker; 16 scene slots with quantised, chained scene changes | we have the Tracker; scenes = song mode on the roadmap |
| qmod / qmod+ | 16 slots of LFO / sampled random / drift / trigger | partly LFO + S&H; later: a multi-slot modulator |
| qmap | applies a CV to a learned knob | we have: any setting takes a cable |
| coupe / bac | 8-head sampler with recording; file browser ranked by similarity | later: sampler |
| presse | 3-band up/down compressor | later |
| crible | filter bank, vocoder, scale-keeping filter | later |
| pli | stereo overdrive with noise inside | later |
| essaim | moving group of resonances | later |
| nef | reverb | covered by Reverb |
| trame | 16 spectral effects on one FFT | later |
| foudre | dual filter, drive inside the loop, self-oscillates | later |
| ruban | bucket-brigade echo, one knob for time and tone | covered by Tape Delay |
| tresse | 8-channel mixer placed as a room around a listener | later: a spatial mode for Mixer |
| brin / envoi / sortie | channel strip, send/return, master + recorder | partly Mixer and Rec |
| gamme | moves 8 lanes onto the shared scale | covered by Conductor |
| liasse | control several modules as a group | relates to "fences" / subpatches on the roadmap |
| vanne | 8 stereo rows with modes and a sum | later |

## Backlog from this review

- Per-cable offset and slew (with rise/fall shape), next to the existing amount.
- A transport bus: modules that need a clock follow the patch clock when nothing is patched.
- Dice modes for patch-wide randomise, keeping key, tempo and padlocked modules.
- Jack scope: hold a jack to see its last two seconds.
- Next modules: Arp/Chord, multi-slot modulator, gate wheel, sampler, filter bank, spectral FX, self-oscillating drive filter, spatial mixer.

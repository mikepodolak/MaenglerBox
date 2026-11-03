/**
 * Help for each module: what it does, what each jack carries, what the main
 * settings change, and patches to try. A recipe can be added to the patch in
 * one tap, wired up and ready to play.
 */

export interface RecipeModule {
  type: string;
  params?: Record<string, number>;
  /** Use a module of this type already in the patch (a clock, the output) instead of adding one. */
  reuse?: boolean;
}

export interface Recipe {
  /** Modules by a short key. `self` is the module the help is about. */
  modules: Record<string, RecipeModule>;
  /** Cables as 'from.port > to.port', using the keys above. */
  cables: string[];
}

export interface HelpIdea {
  title: string;
  text: string;
  recipe?: Recipe;
}

export interface ModuleHelp {
  /** How it works, in a sentence or three. */
  about: string;
  inputs?: Record<string, string>;
  outputs?: Record<string, string>;
  settings?: Record<string, string>;
  ideas?: HelpIdea[];
}

// Building blocks most recipes share: the patch's clock and output, and a fresh FM voice to hear things.
const CLOCK: RecipeModule = { type: 'clock', reuse: true };
const OUT: RecipeModule = { type: 'output', reuse: true };
const FM: RecipeModule = { type: 'fm' };
const toSpeakers = ['fm.out > out.left', 'fm.out > out.right'];

const PORT_KINDS =
  'Yellow jacks carry gates (timed notes and triggers), teal jacks carry CV (a level that moves), orange jacks carry audio. Any output can go into any input: a gate into a CV input becomes a level that is high while the note plays; CV into a gate input fires each time it rises past halfway. Every setting can take a cable too: in Edit mode drag an output onto any slider (on the card or in its settings) and that setting gets a ~ jack and moves with the signal. Set how far in the settings panel, under Modulation.';

export const PATCHING_TIP = PORT_KINDS;

export const HELP: Record<string, ModuleHelp> = {
  clock: {
    about: 'The heartbeat. It sends a steady stream of gate pulses at the tempo and rate you set. Almost every sequencer and generator needs one patched into its Clock input.',
    outputs: { out: 'A gate pulse on every tick.' },
    settings: { bpm: 'Tempo in beats per minute.', division: 'How many ticks per beat: 1/16 gives four ticks per beat.', running: 'Stop or start the clock.' },
    ideas: [
      { title: 'Two speeds', text: 'Add a second Clock at 1/8 to drive a slower sequencer against a fast one, so parts drift in and out of phase if the tempos differ slightly.' },
    ],
  },
  sequencer: {
    about: 'A step sequencer where every step has its own chance of playing, ratchets, velocity, length, trig condition and parameter locks. Notes stay in the chosen scale.',
    inputs: { clock: 'Advances one step per gate.', reset: 'Jumps back to step 1.' },
    outputs: { out: 'Notes, carrying pitch, velocity, a preset number and parameter locks for the synth it plays.' },
    settings: {
      density: 'Scales every step’s chance: at 0.5 everything plays half as often.',
      pitchRandom: 'Random pitch wander, in semitones, snapped to the scale.',
      direction: 'Forward, backward, ping-pong, random or drunk (one step either way).',
      fill: 'Turns on steps whose condition is Fill.',
    },
    ideas: [
      {
        title: 'A whole kit from one sequencer',
        text: 'A new sequencer’s Patterns start with starter patterns. Load a “Kit” one: each step calls up an FM Drum preset (kick, snare, hats, metal), so one sequencer into one FM Drum plays a full broken beat. Load Acid bass or Minor drift into a second sequencer for a line.',
        recipe: { modules: { clock: CLOCK, self: { type: 'sequencer' }, drum: { type: 'drum' }, out: OUT }, cables: ['clock.out > self.clock', 'self.out > drum.gate', 'drum.out > out.left', 'drum.out > out.right'] },
      },
      { title: 'Probability groove', text: 'Leave the downbeats at 100% and set the in-between steps to 30–60%. The pattern changes every bar but keeps its shape.' },
      { title: 'Euclid resets it', text: 'Patch a Euclidean Hits output into Reset so the melody restarts on an uneven cycle.' },
    ],
  },
  tracker: {
    about: 'Eight step sequencers on one clock, M8 style. Each track has its own Notes output, so each can play its own synth. Edit a track in the grid or the tracker view; mute tracks from the overview.',
    inputs: { clock: 'Advances all tracks.', reset: 'Back to step 1 on every track.' },
    outputs: { out1: 'Track 1’s notes (likewise Track 2–8).' },
    ideas: [
      { title: 'IDM band', text: 'Load the IDM band pattern. Tracks 1–4 are kick, snare, hats and metal: patch each to an FM Drum and load the matching preset (Sub kick, FM snare, Closed hat, Metal tick). Track 5 is an acid bass line for an FM Lead, track 6 sparse bells for an FM Voice.' },
    ],
  },
  euclid: {
    about: 'Four Euclidean rhythms on one clock, drawn as rings. Each ring spreads a number of hits as evenly as possible over its own loop of steps: 3 hits in 8 steps is the tresillo, 5 in 8 the cinquillo. Give rings different lengths and they drift against each other (polymeter); the coloured hands show where each ring is.',
    inputs: { clock: 'Advances every ring (by its own speed).', reset: 'All rings back to step 1.' },
    outputs: {
      out: 'Ring 1’s hits (likewise Ring 2–4). The first hit of each loop is full velocity, the rest softer by Accent.',
      notes: 'Every ring’s hits together, each with its ring’s Note and ring number as the preset number: one FM Voice plays all four rings as a kit.',
      off: 'Ring 1’s rests, for an interlocking second rhythm.',
    },
    settings: {
      steps: 'Ring length.',
      hits: 'How many hits are spread over it.',
      rotate: 'Turns the pattern so it starts elsewhere.',
      speed: 'Steps per clock: ×2 runs the ring twice as fast, ÷2 half as fast.',
      note: 'Pitch this ring plays on the Notes output.',
      on2: 'Rings 2–4 can be switched off; ring 1 is always on.',
    },
    ideas: [
      {
        title: 'Four-ring kit',
        text: 'Euclidean Notes into one FM Voice. Save a kick, snare, hat and tom in the voice’s preset slots 1–4: each ring plays its own sound. Turn rings 3 and 4 on in the settings.',
        recipe: { modules: { clock: CLOCK, self: { type: 'euclid', params: { on3: 1, on4: 1 } }, fm: FM, out: OUT }, cables: ['clock.out > self.clock', 'self.notes > fm.gate', ...toSpeakers] },
      },
      {
        title: 'Rhythm gates a melody',
        text: 'Patch Ring 1 into a Turing Machine’s Clock: the melody only moves on the ring’s hits.',
        recipe: { modules: { clock: CLOCK, self: { type: 'euclid', params: { steps: 16, hits: 7 } }, tm: { type: 'turing' }, fm: FM, out: OUT }, cables: ['clock.out > self.clock', 'self.out > tm.clock', 'tm.notes > fm.gate', ...toSpeakers] },
      },
    ],
  },
  turing: {
    about: 'A looping random melody, after the Eurorack Turing Machine. A 16-bit loop of 1s and 0s turns once per clock; the first eight bits read as a number that picks a note in the scale. Change sets how often a bit flips as it comes round: 0 locks the loop, 1 is pure randomness, and small values make a melody that slowly evolves.',
    inputs: { clock: 'Turns the loop one step.' },
    outputs: { notes: 'The melody, in the scale.', gate: 'A gate whenever the first bit is 1: a rhythm that loops with the melody.', cv: 'The same number as a level, 0..1.' },
    settings: { change: 'Chance a bit flips each time round. Try 0.05 for a slowly evolving line.', length: 'Loop length in steps (2–16).', density: 'Thins the notes out, in a way that loops too.', range: 'How many octaves the melody spans.' },
    ideas: [
      {
        title: 'Evolving bassline',
        text: 'Turing Machine at Change 0.05 and Range 1 into an FM Voice: a riff that repeats but shifts a note every few bars. Set Change to 0 when you like what you hear to lock it.',
        recipe: { modules: { clock: CLOCK, self: { type: 'turing', params: { change: 0.05, range: 1, octave: 2 } }, fm: FM, out: OUT }, cables: ['clock.out > self.clock', 'self.notes > fm.gate', ...toSpeakers] },
      },
    ],
  },
  chance: {
    about: 'A coin toss for every gate or note that comes in: with the set chance it goes out A, otherwise out B. Notes pass through untouched, pitch and all.',
    inputs: { in: 'Any gate or notes.' },
    outputs: { a: 'Events that won the toss.', b: 'Events that lost it.' },
    settings: { chance: 'Chance of going out A, 0..1.' },
    ideas: [
      {
        title: 'Two voices share a line',
        text: 'Put a Chance Gate between a sequencer and two FM Voices with different presets: each note is played by one or the other at random, like a call and response.',
        recipe: { modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'chance' }, fm: FM, fm2: { type: 'fm', params: { algorithm: 5 } }, out: OUT }, cables: ['clock.out > seq.clock', 'seq.out > self.in', 'self.a > fm.gate', 'self.b > fm2.gate', ...toSpeakers, 'fm2.out > out.left', 'fm2.out > out.right'] },
      },
      { title: 'Thin a clock', text: 'Clock into a Chance Gate at 0.3, A out into a Bouncing Balls Kick: the balls get kicked now and then.' },
    ],
  },
  random: {
    about: 'Each trigger picks one of four outcomes by weight, like loaded dice. The chosen out fires, and Notes passes the trigger on carrying the pick as a preset number (1–4), so an FM Voice with presets in slots 1–4 becomes a random kit.',
    inputs: { trig: 'Each gate rolls the dice.' },
    outputs: { out1: 'Fires when outcome 1 is picked (likewise 2–4).', notes: 'The incoming note, tagged with preset 1–4.', value: 'The pick as a level: 0, ⅓, ⅔ or 1.' },
    settings: { w1: 'How likely outcome 1 is, relative to the others (likewise Weight 2–4).' },
    ideas: [
      {
        title: 'Random drum kit',
        text: 'Save a kick, snare, hat and tom in an FM Voice’s preset slots 1–4. Then sequencer → Probability → that voice: every step plays one of the four sounds, weighted.',
        recipe: { modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'random' }, fm: FM, out: OUT }, cables: ['clock.out > seq.clock', 'seq.out > self.trig', 'self.notes > fm.gate', ...toSpeakers] },
      },
      { title: 'Branching', text: 'Patch out1–out4 to four different modules’ inputs (a Reset, a Kick, a voice) so each roll triggers a different thing.' },
    ],
  },
  markov: {
    about: 'A first-order Markov chain, like the Max matrixctrl → prob patches. Each row of the dial grid is a state; the circles in that row are the odds of moving to each column’s state next (bigger = likelier). On every clock the chain moves and plays the new state: its note, velocity and length, with its own chance of sounding. Each state can also fire one of eight Trig outputs, so the chain can route its states to different synths, like the TRIG column in the Max patch. You can play the grid right on the card: tap a dial to step its weight or drag it up and down; in Play mode, long-press to show the jacks.',
    inputs: { clock: 'Takes one step through the chain.', reset: 'Back to state 1.' },
    outputs: {
      notes: 'Every state that sounds, with its note and velocity. It also carries the state number as a preset number, so states can pick FM presets.',
      state: 'Which state it is on, as a level 0..1.',
      trig1: 'Fires when a state routed to Trig 1 sounds (likewise Trig 2–8).',
    },
    settings: {
      size: 'How many states are in play (2–16).',
      gate: 'Scales every state’s length.',
      chance: 'Scales every state’s chance of sounding: one knob to thin the whole chain out.',
      transpose: 'Shifts every note.',
    },
    ideas: [
      {
        title: 'A melody with habits',
        text: 'Start with Walk (each state goes to the next), then add a few side circles: from 4 back to 1, from 6 to 3. The tune follows the walk but takes your detours now and then.',
        recipe: { modules: { clock: CLOCK, self: { type: 'markov' }, fm: FM, out: OUT }, cables: ['clock.out > self.clock', 'self.notes > fm.gate', ...toSpeakers] },
      },
      {
        title: 'One chain, two synths',
        text: 'Out of the box, odd states fire Trig 1 and even states Trig 2. Patch each Trig to its own FM Voice and the chain hands the melody between two sounds. Tap a row number to route that state elsewhere.',
        recipe: { modules: { clock: CLOCK, self: { type: 'markov' }, fm: FM, fm2: { type: 'fm', params: { algorithm: 5 } }, out: OUT }, cables: ['clock.out > self.clock', 'self.trig1 > fm.gate', 'self.trig2 > fm2.gate', ...toSpeakers, 'fm2.out > out.left', 'fm2.out > out.right'] },
      },
      { title: 'Balls drive it', text: 'Patch Bouncing Balls Floor into Clock: the chain only moves when a ball hits the floor.' },
    ],
  },
  matrix: {
    about: 'A routing matrix, like the grid between the sequencers and synths in Autechre-style Max patches. Each row is an input and each column an output; the dial where they cross is the chance that a gate from that input reaches that output. It starts straight through (In 1 to Out 1 and so on). Tap a dial to step its chance or drag it up and down; in Play mode, long-press to show the jacks.',
    inputs: { in1: 'Gates and notes for row 1 (likewise In 2–8).' },
    outputs: { out1: 'Whatever rows reach column 1 (likewise Out 2–8).' },
    settings: { mode: 'Each by chance: every crossing in a row rolls its own chance, so one note can reach several outputs. Pick one: each note goes to exactly one output, chosen by the row’s dials as odds.' },
    ideas: [
      {
        title: 'One line, two voices',
        text: 'A sequencer into In 1, with Out 1 on an FM Lead and Out 2 on a Pluck. Turn up row 1’s second dial and set Mode to Pick one: each note goes to one voice or the other.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'matrix', params: { mode: 1 } }, lead: { type: 'lead' }, pl: { type: 'pluck' }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > self.in1', 'self.out1 > lead.gate', 'self.out2 > pl.gate', 'lead.out > out.left', 'pl.out > out.right'],
        },
      },
      { title: 'Shuffle the band', text: 'Patch four sequencers into In 1–4 and four voices onto Out 1–4, then move dials during the set to swap which part each voice plays.' },
    ],
  },
  balls: {
    about: 'Balls fall under gravity inside a box and bounce off the walls, the floor and each other. Every bounce is an event you can patch: floor hits play notes picked by where the ball lands (left = low, right = high), wall and ball-to-ball collisions fire their own gates, and ball 1’s position comes out as X and Y CV. It runs on its own; it needs no clock.',
    inputs: { kick: 'Throws every ball upward. Patch a slow clock or a Chance Gate here to keep things moving.', reset: 'Drops the balls again from new spots.' },
    outputs: {
      floor: 'A note each time a ball lands, louder for harder hits.',
      wall: 'A note when a ball hits a side wall or the ceiling, pitched by height.',
      hit: 'A note when two balls collide.',
      x: 'Ball 1’s horizontal position, 0 (left) to 1 (right).',
      y: 'Ball 1’s height, 0 (floor) to 1 (top).',
    },
    settings: {
      count: 'How many balls (1–8).',
      gravity: 'How strongly they fall. 0 makes them drift like billiard balls.',
      bounce: 'Speed kept on each bounce. At 1 they bounce forever, each at its own steady rate: a polyrhythm. Below 1 they settle; above 1 they gain energy.',
      speed: 'Runs the whole simulation faster or slower.',
      size: 'Bigger balls collide with each other more.',
    },
    ideas: [
      {
        title: 'Bouncing polyrhythm',
        text: 'Three balls at Bounce 1 into an FM Voice: each ball hits the floor at its own rate, so the rhythm is a shifting polyrhythm.',
        recipe: { modules: { self: { type: 'balls' }, fm: FM, out: OUT }, cables: ['self.floor > fm.gate', ...toSpeakers] },
      },
      {
        title: 'Settle and kick',
        text: 'Bounce 0.85 so the balls settle, and a Euclidean pattern on Kick to throw them back up: phrases that accelerate and die away.',
        recipe: { modules: { clock: CLOCK, eu: { type: 'euclid', params: { steps: 32, hits: 1 } }, self: { type: 'balls', params: { bounce: 0.85 } }, fm: FM, out: OUT }, cables: ['clock.out > eu.clock', 'eu.out > self.kick', 'self.floor > fm.gate', ...toSpeakers] },
      },
      { title: 'Height as a clock', text: 'Patch Y into a Markov Chain’s Clock: it steps every time ball 1 rises past halfway.' },
    ],
  },
  life: {
    about: 'Conway’s Game of Life. Each cell lives or dies by its neighbours: a live cell with 2 or 3 live neighbours survives, an empty cell with exactly 3 comes alive. A scan line sweeps the columns, one per clock, and plays the live cells it crosses (higher rows, higher notes). Draw the starting cells in the settings panel.',
    inputs: { clock: 'Moves the scan line one column.', reset: 'Goes back to your drawing.' },
    outputs: { notes: 'Notes for the live cells under the scan line, up to Max notes at once.', births: 'A gate when new cells are born, louder for more.', deaths: 'A gate when cells die.', pop: 'How full the grid is, 0..1.' },
    settings: { evolve: 'Each pass: the grid changes once per sweep. Each step: it changes on every clock, so the scan line plays a moving target.', voices: 'Most notes played at once from a column.', reseed: 'When the grid dies out or freezes, throw in new random life.', density: 'How full a reseed is.' },
    ideas: [
      {
        title: 'Cellular chords',
        text: 'Game of Life into an FM Voice with a slow attack: each column is a chord that changes as the colony grows.',
        recipe: { modules: { clock: CLOCK, self: { type: 'life' }, fm: FM, out: OUT }, cables: ['clock.out > self.clock', 'self.notes > fm.gate', ...toSpeakers] },
      },
      { title: 'Births as drums', text: 'Patch Births into a second FM Voice set up as a snare: it fires when the colony grows, so busy generations get busy drums.' },
    ],
  },
  fm: {
    about: 'A 4-operator FM synth, six voices of polyphony. Operators modulate each other in one of 8 algorithms. Presets live in a shared library, and a note carrying a preset number (from a sequencer step or Probability) plays with that preset’s sound.',
    inputs: { gate: 'Notes to play.' },
    outputs: { out: 'Audio. Patch it to the Output.' },
    settings: { algorithm: 'Which operators modulate which.', feedback: 'Operator 4 modulates itself: from bright to noisy.', transpose: 'Shifts every note.' },
  },
  oscillator: {
    about: 'A plain oscillator that runs all the time, with a frequency modulation input. Useful as a drone or a test tone.',
    inputs: { fm: 'CV or audio that bends the pitch, scaled by FM depth.' },
    outputs: { out: 'Audio.' },
  },
  envelope: {
    about: 'A shape that rises and falls each time a gate arrives. ADSR holds at the sustain level while the note is held; ADR falls all the way while it is held, like a drum.',
    inputs: { gate: 'Starts the envelope.' },
    outputs: { out: 'The envelope as CV, 0..1, scaled by note velocity.' },
    ideas: [{ title: 'Shape a drone', text: 'Oscillator → VCA → Output, and Envelope Out into the VCA’s CV: the drone now plays as notes.' }],
  },
  sh: {
    about: 'Sample & Hold: each trigger holds a new random value until the next one. In Walk mode each value is a small random step from the last, so it drifts instead of jumping. Out as CV and as notes in a scale.',
    inputs: { trig: 'Takes a new value.' },
    outputs: { cv: 'The held value, 0..1.', notes: 'The incoming note re-pitched to the held value.' },
    settings: { mode: 'Random jumps anywhere; Walk drifts.', step: 'How far each Walk step can go.' },
    ideas: [
      {
        title: 'Drunk melody',
        text: 'Clock → Sample & Hold in Walk mode → FM Voice: a melody that wanders up and down the scale.',
        recipe: { modules: { clock: CLOCK, self: { type: 'sh', params: { mode: 1, step: 0.12 } }, fm: FM, out: OUT }, cables: ['clock.out > self.trig', 'self.notes > fm.gate', ...toSpeakers] },
      },
    ],
  },
  lfo: {
    about: 'A low-frequency oscillator: a slow, repeating wave for moving settings. In Edit mode, drag its Out onto any slider, on a card or in a settings panel, and that setting rides the wave. The slider keeps your value; a teal dot shows where the LFO has moved it. In the settings panel, Modulation sets how far each cable moves its setting, and a negative amount moves it the other way.',
    inputs: { clock: 'In Sync mode, the clock the LFO follows: one cycle every Cycle ticks.', reset: 'Starts the cycle again from the top.' },
    outputs: { out: 'The wave, −1 to 1 (or 0 to 1 with Range set that way).' },
    settings: {
      shape: 'Sine and Triangle swing smoothly; Ramps rise or fall then jump back; Square flips; Random holds a new value each cycle; Smooth random glides between them.',
      mode: 'Free runs at Rate. Sync to clock follows the Clock input.',
      rate: 'Cycles per second in Free mode.',
      sync: 'In Sync mode, how many clock ticks one cycle lasts.',
      polarity: '−1 to 1 swings the setting both ways around where you set it; 0 to 1 only pushes it up.',
      level: 'Scales the whole wave.',
    },
    ideas: [
      {
        title: 'Breathing FM',
        text: 'An LFO on the FM Voice’s operator 2 ratio and level makes each note’s tone shift over time.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'lfo', params: { rate: 0.25 } }, fm: FM, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'self.out > fm.@op2Ratio', 'self.out > fm.@op2Level', ...toSpeakers],
        },
      },
      {
        title: 'Wobble in time',
        text: 'Set Timing to Sync to clock and Cycle to 16 clocks: Feedback opens and closes once a bar, locked to the beat.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'lfo', params: { mode: 1, sync: 9, shape: 1 } }, fm: FM, out: OUT },
          cables: ['clock.out > seq.clock', 'clock.out > self.clock', 'seq.out > fm.gate', 'self.out > fm.@feedback', ...toSpeakers],
        },
      },
    ],
  },
  meter: {
    about: 'A level meter. Patch any audio into it, a synth or VCA output or a mixer, to see how loud it is. The solid bar is the average level, the faint bar the peaks, the white line the recent peak, and the lamp on top turns red if the signal clips. Audio passes straight through Thru, so it can sit inline.',
    inputs: { in: 'Audio to measure.' },
    outputs: { out: 'The same audio, untouched.' },
    ideas: [
      {
        title: 'Watch a voice',
        text: 'Put a Meter between the FM Voice and the Output to see each note.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'meter' }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right'],
        },
      },
    ],
  },
  light: {
    about: 'A lamp. It flashes for every gate or note that comes into Gate, and glows with the level of anything in Signal (audio or CV). Both pass straight through, so put it inline to see what a module is sending.',
    inputs: { gate: 'Gates or notes; each one lights the lamp for its length.', in: 'Audio or CV; the lamp glows with its level.' },
    outputs: { gateOut: 'The gates, untouched.', out: 'The signal, untouched.' },
    settings: { color: 'Lamp colour, to tell several apart.' },
    ideas: [
      {
        title: 'See the hits',
        text: 'Sequencer → Light → FM Voice: the lamp blinks on every step that plays.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'light' }, fm: FM, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > self.gate', 'self.gateOut > fm.gate', ...toSpeakers],
        },
      },
    ],
  },
  mixer: {
    about: 'Six channels into a stereo pair. Each channel has a level, a pan, a mute and a solo, and its own meter on the card (dimmed when silent). Tap S or M under a meter, in either mode: soloing one or more channels silences the rest, so you can hear one module on its own. L and R go to the Output. Every setting can take a cable, so an LFO on a pan swings that channel around.',
    inputs: { in1: 'Channel 1 audio (and so on for 2–6).' },
    outputs: { left: 'Left of the mix.', right: 'Right of the mix.' },
    settings: { level1: 'Channel volume.', pan1: 'Left to right.', mute1: 'Silence the channel.', solo1: 'Hear only the soloed channels. Solo wins over mute.', master: 'Volume of the whole mix.' },
    ideas: [
      {
        title: 'Two voices, panned',
        text: 'Two FM Voices into channels 1 and 2, panned apart.',
        recipe: {
          modules: {
            clock: CLOCK,
            seq: { type: 'sequencer' },
            fm: FM,
            fm2: { type: 'fm', params: { algorithm: 5, transpose: 12 } },
            self: { type: 'mixer', params: { pan1: -0.6, pan2: 0.6 } },
            out: OUT,
          },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'seq.out > fm2.gate', 'fm.out > self.in1', 'fm2.out > self.in2', 'self.left > out.left', 'self.right > out.right'],
        },
      },
    ],
  },
  filter: {
    about: 'A resonant filter. Low pass keeps the lows and darkens the sound; high pass thins it; band pass keeps a slice; notch cuts one out. 24 dB is steeper than 12. The card draws the response, and it moves when a cable moves Cutoff.',
    inputs: { in: 'Audio to filter.' },
    outputs: { out: 'Filtered audio.' },
    settings: { type: 'Which part of the sound to keep.', cutoff: 'Where the filter starts working.', resonance: 'A peak at the cutoff; high values whistle.', slope: '12 or 24 dB per octave.' },
    ideas: [
      {
        title: 'Swept filter',
        text: 'An LFO on Cutoff opens and closes the filter on a voice.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'filter', params: { resonance: 6 } }, lfo: { type: 'lfo', params: { rate: 0.2 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'lfo.out > self.@cutoff', 'self.out > out.left', 'self.out > out.right'],
        },
      },
    ],
  },
  eq: {
    about: 'A three-band EQ: a low shelf, a mid band you can sweep and narrow, and a high shelf, each ±15 dB. The card draws the curve.',
    inputs: { in: 'Audio to shape.' },
    outputs: { out: 'Shaped audio.' },
    settings: { lowGain: 'Boost or cut the lows.', lowFreq: 'Where the lows end.', midGain: 'Boost or cut the mid band.', midFreq: 'Centre of the mid band.', midQ: 'How narrow the mid band is.', highGain: 'Boost or cut the highs.', highFreq: 'Where the highs begin.' },
    ideas: [
      {
        title: 'Telephone voice',
        text: 'Cut the lows and highs and boost the mids.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'eq', params: { lowGain: -15, midGain: 10, highGain: -15 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right'],
        },
      },
    ],
  },
  lead: {
    about: 'A two-operator FM voice through a resonant low-pass filter, after the Nord Lead 2’s FM: a modulator (with its own envelope and feedback) bends a sine carrier, then the filter, opened by its own decaying envelope, shapes it. Good for punchy basses, plucky leads and bells. Plays notes, presets and parameter locks like the FM Voice.',
    inputs: { gate: 'Notes to play (6 at once).' },
    outputs: { out: 'Audio.' },
    settings: {
      ratio: 'Modulator pitch against the note; whole numbers are harmonic, halves add a sub.',
      index: 'How much FM: from a sine to a buzz.',
      feedback: 'The modulator modulating itself: grit and noise.',
      modDecay: 'How fast the FM fades after the attack; short makes a pluck, long a growl.',
      cutoff: 'Filter brightness.',
      resonance: 'A peak at the cutoff.',
      filterEnv: 'How far each note opens the filter (negative closes it).',
      filterDecay: 'How fast the filter closes again.',
      attack: 'Amp attack.',
      release: 'Amp release.',
    },
    ideas: [
      {
        title: 'FM bass',
        text: 'Low notes with a quick filter snap.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: { type: 'lead', params: { transpose: -24, ratio: 1, index: 0.6, cutoff: 400, filterEnv: 3, filterDecay: 0.15, resonance: 4 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', ...toSpeakers],
        },
      },
    ],
  },
  pluck: {
    about: 'A plucked string by the Karplus-Strong method: a burst of noise rings round a delay tuned to the note and fades as it goes. Guitars, harps, kalimbas, and stranger clangs with low Brightness or short Decay.',
    inputs: { gate: 'Notes to play (6 at once).' },
    outputs: { out: 'Audio.' },
    settings: {
      decay: 'How long the string rings.',
      brightness: 'How bright the ringing stays; low is muted and woody.',
      pluck: 'How bright the pluck itself is (a pick against a thumb).',
      position: 'Where the string is plucked; near the middle sounds hollow.',
      release: 'How quickly it stops once the note ends.',
    },
    ideas: [
      {
        title: 'Harp from a Markov chain',
        text: 'A Markov Chain playing a Pluck: a wandering harp line.',
        recipe: {
          modules: { clock: CLOCK, self: { type: 'pluck', params: { decay: 3 } }, mk: { type: 'markov' }, out: OUT },
          cables: ['clock.out > mk.clock', 'mk.notes > self.gate', 'self.out > out.left', 'self.out > out.right'],
        },
      },
    ],
  },
  conductor: {
    about: 'Sets the key, scale and overall note chance for the whole patch. Every note on its way into a synth or effect is transposed, moved to the nearest note of the scale, and let through only with Chance, wherever it came from. One per patch is enough. Patch an LFO or a Turing Machine onto Key or Chance (from its settings) to change key or density as it plays.',
    settings: {
      enabled: 'Off lets every note through untouched.',
      root: 'The key.',
      scale: 'The scale every note is moved into.',
      chance: 'The chance each note reaches its voice: lower it to thin out the whole patch at once.',
      transpose: 'Shifts every note before it is put in key.',
    },
    ideas: [
      { title: 'Everything in key', text: 'Add a Conductor to a patch with a Turing Machine and a Markov Chain playing different voices. Pick Minor pentatonic: random notes from anywhere now agree.' },
      { title: 'Breathing density', text: 'Patch a slow LFO onto Chance: the whole patch thins out and fills back in.' },
    ],
  },
  delay: {
    about: 'Tape-style echo. Each repeat gets a little darker and, pushed hard, saturates like tape instead of blowing up. Wow wobbles the time like a worn machine. Patch a clock into Clock and choose a Sync to lock the echoes to the beat.',
    inputs: { in: 'Audio to echo.', clock: 'A clock to sync the echo time to.' },
    outputs: { out: 'Processed audio.' },
    settings: { time: 'Echo time when not synced.', sync: 'Echo every so many clock ticks (needs the Clock input).', feedback: 'How many repeats; near the top it runs away into a wash.', tone: 'Darkens each repeat.', wow: 'Tape wobble.', mix: 'Dry to wet.' },
    ideas: [
      {
        title: 'Dotted echoes',
        text: 'Sync the echoes to ¾ of a clock for the classic dotted bounce.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'delay', params: { sync: 3, feedback: 0.55 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right', 'clock.out > self.clock'],
        },
      },
    ],
  },
  reverb: {
    about: 'A stereo room. Size sets how long the tail lasts, Damping how quickly it darkens, Pre-delay the gap before it starts. Out is mono; L and R give the stereo tail with the dry sound in the middle.',
    inputs: { in: 'Audio to process.' },
    outputs: { out: 'Mono mix.', left: 'Left of the stereo mix.', right: 'Right of the stereo mix.' },
    settings: { size: 'Tail length.', damping: 'How quickly the tail darkens.', predelay: 'Gap before the room answers.', mix: 'Dry to wet.' },
    ideas: [
      {
        title: 'Big space',
        text: 'A long, dark tail behind a voice, in stereo.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'reverb', params: { size: 6, damping: 0.7, mix: 0.45 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.left > out.left', 'self.right > out.right'],
        },
      },
    ],
  },
  phaser: {
    about: 'Sweeping notches that swirl through the sound, from a chain of all-pass filters moved by a built-in LFO. More stages make a deeper swirl.',
    inputs: { in: 'Audio to process.' },
    outputs: { out: 'Processed audio.' },
    settings: { rate: 'Sweep speed.', depth: 'Sweep width.', center: 'Where the sweep sits.', resonance: 'Sharper notches.', stages: '4, 6 or 8 stages.', mix: '50% is the classic phaser.' },
    ideas: [
      {
        title: 'Slow swirl',
        text: 'A slow phaser on a voice.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'phaser', params: { rate: 0.15, depth: 0.9 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right'],
        },
      },
    ],
  },
  flanger: {
    about: 'A tiny delay swept back and forth and fed back on itself: the jet-plane sweep. Negative feedback sounds hollow, positive metallic.',
    inputs: { in: 'Audio to process.' },
    outputs: { out: 'Processed audio.' },
    settings: { rate: 'Sweep speed.', depth: 'Sweep width.', delay: 'Shortest delay; lower is brighter.', feedback: 'Strength and colour of the sweep.', mix: 'Dry to wet.' },
    ideas: [
      {
        title: 'Jet',
        text: 'A strong flange on a voice.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'flanger', params: { feedback: 0.85, depth: 0.9 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right'],
        },
      },
    ],
  },
  comb: {
    about: 'Makes anything ring at a pitch: a delay tuned to the note and fed back. Patch notes into Notes and the ringing follows the melody, a resonator. Feed it drums or clicks for Karplus-style plucks.',
    inputs: { in: 'Audio to make ring.', notes: 'Notes retune the comb to each pitch.' },
    outputs: { out: 'Processed audio.' },
    settings: { freq: 'Pitch it rings at (until notes arrive).', feedback: 'How long it rings; negative rings an octave lower and hollower.', damp: 'Darkens the ringing.', mix: 'Dry to wet.' },
    ideas: [
      {
        title: 'Resonator',
        text: 'The sequencer’s notes tune the comb, so the voice gets a ringing body that follows the melody.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'comb', params: { feedback: 0.92 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right', 'seq.out > self.notes'],
        },
      },
    ],
  },
  ringmod: {
    about: 'Multiplies the sound by a carrier wave: metallic, bell-like, robotic. Low Freq values make tremolo. Turn Own carrier off and patch any audio into Carrier to multiply two sounds together.',
    inputs: { in: 'Audio to modulate.', carrier: 'Any audio to multiply by instead.' },
    outputs: { out: 'Processed audio.' },
    settings: { freq: 'Carrier pitch.', wave: 'Carrier shape.', osc: 'Use the built-in carrier, or only the Carrier input.', mix: 'Dry to wet.' },
    ideas: [
      {
        title: 'Bells',
        text: 'A ring modulator at an odd frequency turns a voice into bells.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'ringmod', params: { freq: 733, mix: 0.9 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right'],
        },
      },
    ],
  },
  glitch: {
    about: 'Stutters, reverses and crushes. On each clock tick it may (by Chance) grab the slice it just heard and repeat it, sometimes backwards. Bits and Downsample crush the sound all the time. It needs a clock in Clock to stutter.',
    inputs: { in: 'Audio to glitch.', clock: 'Each tick may start a stutter.' },
    outputs: { out: 'Processed audio.' },
    settings: { chance: 'How often a tick starts a stutter.', slice: 'How long a slice is, in clock ticks.', repeats: 'How many times a slice repeats.', reverse: 'How often a stutter plays backwards.', bits: 'Fewer bits, grittier (16 is clean).', downsample: 'Lower sample rate, more aliasing (1 is clean).', mix: 'Dry to wet.' },
    ideas: [
      {
        title: 'Broken beat',
        text: 'Stutters on the clock, with a little crushing.',
        recipe: {
          modules: { clock: CLOCK, seq: { type: 'sequencer' }, fm: FM, self: { type: 'glitch', params: { chance: 0.35, bits: 8, downsample: 3 } }, out: OUT },
          cables: ['clock.out > seq.clock', 'seq.out > fm.gate', 'fm.out > self.in', 'self.out > out.left', 'self.out > out.right', 'clock.out > self.clock'],
        },
      },
    ],
  },
  drum: {
    about: 'FM percussion. A sine body starts high and sweeps down to Pitch (Sweep and Sweep time), an FM modulator at Ratio roughens it for a moment (FM amount, FM decay), and a burst of band-passed noise adds snap. Low ratios and long sweeps give kicks and toms; odd high ratios with feedback and noise give hats and metal. Each hit rings out whatever the note length. Its presets make a kit: patch Probability or a sequencer step’s Preset into it and one drum plays them all.',
    inputs: { gate: 'Hits. With Follow notes up, the note sets the pitch too.' },
    outputs: { out: 'Audio.' },
    settings: {
      pitch: 'Body pitch once the sweep has fallen.',
      track: 'How much the note moves the pitch: 0 is a fixed drum, 1 plays in tune.',
      sweep: 'How far above Pitch the hit starts.',
      sweepTime: 'How fast it falls: short is a click, long is a zap.',
      ratio: 'Modulator pitch against the body. Whole numbers are tonal, odd ones metallic.',
      fm: 'How hard the modulator bends the body.',
      fmDecay: 'How long the FM lasts.',
      noise: 'Noise level.',
      noiseTone: 'Centre of the noise band: low is a thud, high is a hiss.',
      decay: 'Body length.',
      drive: 'Saturation, from warm to crushed.',
    },
    ideas: [
      {
        title: 'One-voice kit',
        text: 'Probability into an FM Drum: each trigger plays one of the first four presets (Sub kick, Click kick, FM snare, Rim), weighted by its bars.',
        recipe: { modules: { clock: CLOCK, prob: { type: 'random' }, self: { type: 'drum' }, out: OUT }, cables: ['clock.out > prob.trig', 'prob.notes > self.gate', 'self.out > out.left', 'self.out > out.right'] },
      },
      { title: 'Hats from Euclid', text: 'Load Closed hat and patch a fast Euclidean ring into it. Put an LFO on Decay for hats that open and close.' },
    ],
  },
  pad: {
    about: 'Three oscillators, detuned around each note and drifting slowly, plus a sine an octave down, through a resonant low-pass that opens with its own slow envelope. Long attacks and releases make it swell and hang; Shape moves from soft saw to hollow square.',
    inputs: { gate: 'Notes, six at once.' },
    outputs: { out: 'Audio.' },
    settings: {
      shape: 'Saw (0) to square (1).',
      detune: 'How far apart the three oscillators are: chorus to sour.',
      sub: 'Octave-down sine, for weight.',
      drift: 'Slow, random pitch wander, like old analog.',
      cutoff: 'Filter cutoff before the envelope.',
      filterEnv: 'How far the envelope opens the filter.',
      filterAttack: 'How slowly the filter opens.',
      attack: 'How slowly the note fades in.',
      release: 'How long it hangs after the note ends.',
    },
    ideas: [
      {
        title: 'Slow chords',
        text: 'A slow sequencer with long steps into a Pad, through a Reverb. Lower the clock rate for slower changes.',
        recipe: { modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'pad' }, rev: { type: 'reverb' }, out: OUT }, cables: ['clock.out > seq.clock', 'seq.out > self.gate', 'self.out > rev.in', 'rev.left > out.left', 'rev.right > out.right'] },
      },
    ],
  },
  texture: {
    about: 'Each note becomes a cloud of tiny grains scattered around its pitch. Every grain is a sine or a band of noise; Density sets how many fall each second and Grain how long each lasts. Sparse and pitched it glitters like rain on glass; dense and noisy it breathes and hisses. Hold notes for drones.',
    inputs: { gate: 'Notes. The cloud lasts as long as the note, then Release.' },
    outputs: { out: 'Audio.' },
    settings: {
      density: 'Grains per second.',
      grain: 'Length of each grain: short clicks to long tones.',
      scatter: 'How far grains wander from the note, in semitones.',
      harmonic: '0 lets grains land anywhere; 1 puts them on octaves and fifths.',
      noise: 'Sine grains (0) to noise grains (1).',
      focus: 'How narrow the noise bands are: low is a hiss, high whistles.',
    },
    ideas: [
      {
        title: 'Drone bed',
        text: 'A Turing Machine with long gates into a Texture: a shifting cloud under everything. Try the Wind drone or Granular choir presets.',
        recipe: { modules: { clock: CLOCK, tm: { type: 'turing' }, self: { type: 'texture' }, out: OUT }, cables: ['clock.out > tm.clock', 'tm.notes > self.gate', 'self.out > out.left', 'self.out > out.right'] },
      },
    ],
  },
  drummap: {
    about: 'Four drum lanes (kick, snare, hat, aux) read from a map of patterns, inspired by the grille module in Chassis. Drag the dot on the card: left to right goes from straight to broken beats, bottom to top from sparse to busy, and everywhere in between is a blend. Density decides how faint a step can be and still play, so each lane thins out or fills in on its own. Chaos wobbles steps in and out; Lock decides whether that wobble repeats every bar or changes.',
    inputs: { clock: 'One step per gate; 32 steps make a bar.', reset: 'Back to step 1.', fill: 'Fills the next eight steps.' },
    outputs: {
      kick: 'Kick hits.',
      snare: 'Snare hits.',
      hat: 'Hat hits.',
      aux: 'The fourth lane: percussion, rims, clicks.',
      notes: 'All four lanes as notes with preset numbers 1–4, so one FM Drum with a kit loaded plays everything.',
    },
    settings: {
      x: 'Straight (left) to broken (right). Patch a slow LFO here to wander.',
      y: 'Sparse (bottom) to busy (top).',
      dens1: 'How many kick steps play.',
      chaos: 'How much steps wobble in and out.',
      lock: 'At 1 the wobble repeats every bar; at 0 it is new every bar.',
      fillEvery: 'Busier last half-bar every so many bars.',
      fillAmount: 'How much busier fills get.',
      swing: 'Pushes every second step late.',
    },
    ideas: [
      {
        title: 'One-drum kit',
        text: 'Kit notes into an FM Drum: the kick, snare, hat and aux lanes play its presets 1–4 (Sub kick, Click kick, FM snare, Rim).',
        recipe: { modules: { clock: CLOCK, self: { type: 'drummap' }, drum: { type: 'drum' }, out: OUT }, cables: ['clock.out > self.clock', 'self.notes > drum.gate', 'drum.out > out.left', 'drum.out > out.right'] },
      },
      {
        title: 'Wandering beat',
        text: 'A slow LFO on X drifts the beat between straight and broken. Drag the LFO Out onto the X slider in Edit mode.',
        recipe: { modules: { clock: CLOCK, self: { type: 'drummap' }, lfo: { type: 'lfo', params: { rate: 0.05 } }, drum: { type: 'drum' }, out: OUT }, cables: ['clock.out > self.clock', 'lfo.out > self.@x', 'self.notes > drum.gate', 'drum.out > out.left', 'drum.out > out.right'] },
      },
    ],
  },
  logic: {
    about: 'Combines two gate rhythms, inspired by the atelier operators in Chassis. AND plays when both inputs are high at once, OR when either is, XOR when only one is, A not B when A plays and B does not. Toggle lets every other A through; Divide lets every Nth A through, and B restarts the count. Every gate that does not pass goes out Else, so nothing is lost.',
    inputs: { a: 'First rhythm.', b: 'Second rhythm, or a reset for Toggle and Divide.' },
    outputs: { out: 'Gates that pass.', else: 'Gates that do not.' },
    settings: { op: 'Which rule.', divide: 'For Divide: pass one A in this many.' },
    ideas: [
      {
        title: 'Two Euclids, one groove',
        text: 'Two Euclidean rings into A and B with XOR: hits where only one ring plays. Else carries the rest to a second drum.',
        recipe: { modules: { clock: CLOCK, eu: { type: 'euclid' }, self: { type: 'logic', params: { op: 2 } }, drum: { type: 'drum' }, out: OUT }, cables: ['clock.out > eu.clock', 'eu.out > self.a', 'eu.out2 > self.b', 'self.out > drum.gate', 'drum.out > out.left', 'drum.out > out.right'] },
      },
    ],
  },
  math: {
    about: 'Two signals in, one out, inspired by the atelier operators in Chassis. Add, subtract or multiply two LFOs into a new shape; Min and Max pick the lower or higher; A > B gives 1 or 0; |A| rectifies, Fold A folds it back on itself (Amount sets how hard), Slew A smooths jumps (Amount is the time), Steps A quantises to a few levels. Gains go negative to invert.',
    inputs: { a: 'First signal.', b: 'Second signal.' },
    outputs: { out: 'The result, plus Offset.' },
    settings: { op: 'Which operator.', gainA: 'Scales A first; negative inverts.', gainB: 'Scales B first.', offset: 'Added at the end.', amount: 'Fold depth, slew time or step count, for the operators that use it.' },
    ideas: [
      {
        title: 'Two LFOs, one odd shape',
        text: 'Multiply a slow and a fast LFO for a wobble that swells and fades, then drag Out onto a filter cutoff.',
        recipe: { modules: { a: { type: 'lfo', params: { rate: 0.1 } }, b: { type: 'lfo', params: { rate: 3 } }, self: { type: 'math', params: { op: 2 } } }, cables: ['a.out > self.a', 'b.out > self.b'] },
      },
    ],
  },
  lanes: {
    about: 'Four lanes of values you paint with a finger, inspired by the quatre macros in Chassis. A clock moves a playhead through each lane, and each lane has its own length, so a 16, a 12 and a 7 drift against each other into long, slowly repeating movement. Each lane sends its value out as CV: drag an output onto any setting to move it. Glide smooths the steps into slopes.',
    inputs: { clock: 'Moves the playheads.', reset: 'Back to the start of every lane.' },
    outputs: { out1: 'Lane 1 value, 0 to 1.', out2: 'Lane 2.', out3: 'Lane 3.', out4: 'Lane 4.' },
    settings: { len1: 'Steps in lane 1 before it loops.', rate: 'Steps per clock: ×2 is two, ÷4 is one every four.', smooth: 'Glide between steps: 0 jumps, 1 slides all the way.' },
    ideas: [
      {
        title: 'Painted filter',
        text: 'Lane 1 into a Filter cutoff over a sequenced FM Voice. Paint the lane and hear the filter follow.',
        recipe: { modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'lanes' }, fm: FM, flt: { type: 'filter' }, out: OUT }, cables: ['clock.out > seq.clock', 'clock.out > self.clock', 'seq.out > fm.gate', 'fm.out > flt.in', 'self.out1 > flt.@cutoff', 'flt.out > out.left', 'flt.out > out.right'] },
      },
    ],
  },
  follower: {
    about: 'Follows how loud a sound is, inspired by the sillage module in Chassis. Level comes out as CV: patch it onto a setting so one sound shapes another, like a kick opening a pad’s filter or ducking its level. Gate fires each time the level rises past the threshold, so a sound can trigger another voice. Audio passes through unchanged.',
    inputs: { in: 'The sound to follow.' },
    outputs: { env: 'Its level as CV.', gate: 'A gate each time the level crosses the threshold.', thru: 'The same audio, unchanged.' },
    settings: { attack: 'How fast it rises.', release: 'How fast it falls.', gain: 'Scales the level up or down.', threshold: 'The level where Gate fires (the white mark on the card).' },
    ideas: [
      {
        title: 'Drums trigger a bell',
        text: 'Follow an FM Drum and play a Modal Perc from its Gate, so every loud hit rings a bell.',
        recipe: { modules: { clock: CLOCK, prob: { type: 'random' }, drum: { type: 'drum' }, self: { type: 'follower' }, bell: { type: 'modal', params: { body: 4 } }, out: OUT }, cables: ['clock.out > prob.trig', 'prob.notes > drum.gate', 'drum.out > self.in', 'self.thru > out.left', 'self.gate > bell.gate', 'bell.out > out.right'] },
      },
    ],
  },
  shifter: {
    about: 'Moves every frequency by the same number of hertz, inspired by the biais module in Chassis. Unlike pitch shifting, the gaps between partials stay the same, so harmonic sounds turn inharmonic: a few hertz gives slow swirling phase, tens give a seasick shimmer, hundreds turn notes into bells and metal. Feedback sends the result round again for spirals.',
    inputs: { in: 'Audio to shift.' },
    outputs: { out: 'Shifted audio.' },
    settings: { shift: 'Hertz to move by; negative moves down.', fine: 'Small extra shift, for slow phasing.', side: 'Up, down, or both together (ring-mod-like).', feedback: 'Sends the output back in.', mix: 'Dry to shifted.' },
    ideas: [
      {
        title: 'Metal pluck',
        text: 'A Pluck through the shifter at about 150 Hz: strings become clanging metal.',
        recipe: { modules: { clock: CLOCK, seq: { type: 'sequencer' }, pl: { type: 'pluck' }, self: { type: 'shifter', params: { shift: 150 } }, out: OUT }, cables: ['clock.out > seq.clock', 'seq.out > pl.gate', 'pl.out > self.in', 'self.out > out.left', 'self.out > out.right'] },
      },
    ],
  },
  modal: {
    about: 'A strike on a resonant object, inspired by the frappe module in Chassis and built as a bank of tuned resonators, one per vibration mode. Body picks the object (skin, tom, bar, plate, bell, chime, box, glass, tine); notes set its pitch. Material decides how long high modes ring (wood is soft, metal and glass are hard), Stretch spreads the modes apart, and Position moves where it is struck. Exciter and Hardness shape the strike itself.',
    inputs: { gate: 'Hits; the note sets the pitch.' },
    outputs: { out: 'Audio.' },
    settings: {
      body: 'The object being struck.',
      decay: 'How long the lowest mode rings.',
      material: 'Soft (high modes die quickly) to hard (they ring on).',
      stretch: 'Squeezes (−) or spreads (+) the modes: stiffer, more bell-like as it rises.',
      position: 'Edge to centre. The centre hollows out some modes.',
      bend: 'Starts sharp and falls, like a tom.',
      exciter: 'Tap, soft Mallet, Noise burst, or Brush.',
      hardness: 'Soft mallet to hard stick: brighter and shorter contact.',
      damp: 'How fast it is choked once the note ends.',
    },
    ideas: [
      {
        title: 'Marimba melody',
        text: 'A Turing Machine into Modal Perc with the Marimba preset, through a Reverb.',
        recipe: { modules: { clock: CLOCK, tm: { type: 'turing' }, self: { type: 'modal', params: { body: 2, exciter: 1, decay: 0.9, material: 0.25 } }, rev: { type: 'reverb' }, out: OUT }, cables: ['clock.out > tm.clock', 'tm.notes > self.gate', 'self.out > rev.in', 'rev.left > out.left', 'rev.right > out.right'] },
      },
      { title: 'Percussion map', text: 'Drum Map Aux into a Modal Perc on Glass or Box for clicks and knocks around the beat.' },
    ],
  },
  supersaw: {
    about: 'A stack of up to nine saws per note, spread in pitch, inspired by the scie module in Chassis. Detune sets how far apart they are, Blend balances the centre saw against the outer ones, and Sub adds weight an octave down. A low-pass with its own envelope tames or bites.',
    inputs: { gate: 'Notes, six at once.' },
    outputs: { out: 'Audio.' },
    settings: {
      voices: 'Saws per note. One is a plain saw.',
      detune: 'Spread: subtle chorus at the bottom, sour at the top.',
      blend: 'Centre saw (0) to outer saws (1).',
      sub: 'A rounded saw an octave down.',
      drift: 'Each saw wanders slowly in pitch.',
      cutoff: 'Filter cutoff before its envelope.',
      filterEnv: 'How far each note opens the filter.',
    },
    ideas: [
      {
        title: 'Rave stabs',
        text: 'A sparse sequencer into Supersaw (Rave stab preset) and a Tape Delay synced to the clock.',
        recipe: { modules: { clock: CLOCK, seq: { type: 'sequencer' }, self: { type: 'supersaw' }, dl: { type: 'delay' }, out: OUT }, cables: ['clock.out > seq.clock', 'clock.out > dl.clock', 'seq.out > self.gate', 'self.out > dl.in', 'dl.out > out.left', 'dl.out > out.right'] },
      },
    ],
  },
  vca: {
    about: 'An amplifier: its gain is Level plus whatever comes into CV. With Level at 0 it is silent until CV opens it.',
    inputs: { in: 'Audio to amplify.', cv: 'Opens the gain. A gate here opens it fully for the length of each note.' },
    outputs: { out: 'Audio.' },
  },
  output: {
    about: 'Sends audio to the speakers (and to the recorder). Patch any audio into L and R.',
    inputs: { left: 'Left channel.', right: 'Right channel.' },
  },
};

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
  'Yellow jacks carry gates (timed notes and triggers), teal jacks carry CV (a level that moves), orange jacks carry audio. Any output can go into any input: a gate into a CV input becomes a level that is high while the note plays; CV into a gate input fires each time it rises past halfway.';

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
      { title: 'Probability groove', text: 'Leave the downbeats at 100% and set the in-between steps to 30–60%. The pattern changes every bar but keeps its shape.' },
      { title: 'Euclid resets it', text: 'Patch a Euclidean Hits output into Reset so the melody restarts on an uneven cycle.' },
    ],
  },
  tracker: {
    about: 'Eight step sequencers on one clock, M8 style. Each track has its own Notes output, so each can play its own synth. Edit a track in the grid or the tracker view; mute tracks from the overview.',
    inputs: { clock: 'Advances all tracks.', reset: 'Back to step 1 on every track.' },
    outputs: { out1: 'Track 1’s notes (likewise Track 2–8).' },
    ideas: [{ title: 'A kit', text: 'Patch tracks 1–3 to three FM Voices, each with a different preset: kick, snare, hat.' }],
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
    about: 'A first-order Markov chain, like the Max matrixctrl → prob patches. Each row of the dial grid is a state; the circles in that row are the odds of moving to each column’s state next (bigger = likelier). On every clock the chain moves and plays the new state: its note, velocity and length, with its own chance of sounding. Each state can also fire one of eight Trig outputs, so the chain can route its states to different synths, like the TRIG column in the Max patch.',
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

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces run from the page background up to a raised card. Kept as
        // named steps rather than raw greys so a later theme pass changes one
        // file instead of every component.
        //
        // `page` and not `base`. Tailwind ships a font size called base, and a
        // colour of the same name makes it generate `.text-base` twice: once
        // setting font-size, once setting colour. Both rules match, so every
        // `text-base` in the codebase was also painting its text #0a0d0c on
        // whatever it sat on -- which is how the action buttons ended up with
        // near-black labels at 1.38:1. No colour here may share a name with a
        // font size; check-classes.mjs now fails the build if one does.
        page: "#0a0d0c",
        surface: "#121614",
        raised: "#1a201d",
        line: "#2a322e",

        // The table itself. Deliberately desaturated: a saturated casino green
        // fights with the correct/wrong feedback colours, which are the two
        // things on screen that actually have to be read instantly.
        felt: "#16352a",
        "felt-rail": "#0e2019",

        // The three actions, as they appear on the range grid. Raise is the
        // felt green, call is blue, fold is just the empty cell. Distinct in
        // hue rather than only in lightness, so the shapes stay legible.
        "zone-raise": "#1f5c43",
        "zone-call": "#27506b",

        // Buttons.
        //
        // Everything above is a surface you look at and can be as dark as the
        // mood wants. These are surfaces you press, and they are the one part
        // of the theme with a floor to clear rather than a feel to match: a
        // control has to stand off the page by 3:1 (WCAG 1.4.11) and still
        // carry its label at 4.5:1 (1.4.3). Those two pull in opposite
        // directions -- a lighter fill is easier to find and harder to read on
        // -- which leaves a band about 3.0:1 to 3.6:1 wide against this page
        // colour, and every value here was picked inside it. contrast.test.ts
        // holds them there, because the failure is silent otherwise: the old
        // buttons measured 1.18:1 and nothing anywhere said so.
        //
        // The hues follow the range grid rather than inventing a second
        // language, so the colour you pressed is the colour that hand is drawn
        // in when the grid appears afterwards.
        "act-fold": "#252d29",
        "act-fold-hi": "#333c37",
        "act-fold-edge": "#5b6763",
        "act-call": "#326385",
        "act-call-hi": "#386e94",
        "act-call-edge": "#63a0cc",
        "act-bet": "#256f50",
        "act-bet-hi": "#287756",
        "act-bet-edge": "#48b287",

        ink: "#e8ece9",
        muted: "#8b978f",

        // Feedback. These two never get used for decoration anywhere else.
        correct: "#3fb950",
        wrong: "#f85149",

        accent: "#d4a72c",
      },
      fontFamily: {
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces run from the page background up to a raised card. Kept as
        // named steps rather than raw greys so a later theme pass changes one
        // file instead of every component.
        base: "#0a0d0c",
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

# Contributing to Blorp Engine

Thank you for helping make engineering calculations open and correct. Contributions of every size are welcome — from a corrected sign to a new model.

## The most useful contributions

1. **Mistakes with a source.** A wrong formula, sign, unit, factor or validity range. Open an issue that names the file and function, shows the correct form and cites the standard, textbook page or paper.
2. **Published worked examples.** A tool marked *Concept* becomes *Validated* only when a test reproduces a published worked example (a standard's annex, a textbook example, a recognised reference). Send the example with its source; we turn it into a `VALIDATION (source)` test.
3. **Model improvements and new models**, following the rules below.

## Rules for code

- Calculations only, in plain TypeScript, **no runtime dependencies**. No UI code.
- SI units inside every model. Put the unit next to every input and output in a comment.
- Every new formula comes with a test: a published worked example if one exists (name it `VALIDATION (source)`), otherwise a hand calculation you show in the test.
- State simplifications in the comments. Never claim full compliance with a standard.
- `npm test` must pass.

## Licence of contributions

By submitting a contribution you agree that:

1. it is your own work (or you have the right to submit it) and contains no code copied from sources with an incompatible licence;
2. it is licensed to everyone under the GNU AGPL v3.0, like the rest of this repository; and
3. you grant TOLYA, the copyright holder of Blorp, a perpetual, worldwide, royalty-free licence to use, change and relicense your contribution, including in the Blorp app and website and in other TOLYA products.

Point 3 lets TOLYA keep the engine and the Blorp app in step. You keep the copyright of your contribution and are credited in the history.

## Contact

Questions or larger plans: open an issue, or write to info@tolya.com.tr. Türkçe yazabilirsiniz.

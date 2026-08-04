module.exports = {
    // Astro needs a plugin to be formatted at all; without it `format:check` fails on every .astro file
    // with "no parser could be inferred" rather than checking them.
    plugins: ["prettier-plugin-astro"],
    printWidth: 100,
    tabWidth: 4,
    useTabs: false,
    singleQuote: false,
    semi: true,
    bracketSpacing: true,
    arrowParens: "always",
    endOfLine: "lf",
    trailingComma: "none",
    overrides: [
        {
            files: "*.json",
            options: {
                tabWidth: 2
            }
        },
        {
            files: "*.yml",
            options: {
                tabWidth: 2
            }
        },
        {
            files: "*.md",
            options: {
                tabWidth: 2,
                proseWrap: "preserve"
            }
        }
    ]
};

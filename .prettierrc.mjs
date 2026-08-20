import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const PLUGIN_CACHE_DIR = path.join(os.homedir(), ".cache", "prettier-plugins");
const PLUGINS = Object.freeze([
    { name: "prettier-plugin-toml", version: "2.0.6" },
    { name: "prettier-plugin-sh", version: "0.19.0" },
]);
const NPM_CMD = Object.freeze(["npm"]);
const RUSTFMT_CMD = Object.freeze(["rustfmt"]);
const HASH_LENGTH = 16;
const RUSTFMT_CONFIG = Object.freeze(getRustfmtConfig());

// Prettier options:
// https://prettier.io/docs/options
const config = {
    useTabs: RUSTFMT_CONFIG.hard_tabs,
    tabWidth: RUSTFMT_CONFIG.tab_spaces,
    printWidth: RUSTFMT_CONFIG.max_width,
    endOfLine: getPrettierEndOfLine(RUSTFMT_CONFIG.newline_style),
    semi: true,
    singleQuote: false,
    trailingComma: "all",
    experimentalOperatorPosition: "start",
    proseWrap: "always",
    plugins: ensurePluginCache(),
    overrides: [
        {
            files: ["*.jsonc"],
            options: {
                trailingComma: "none",
            },
        },
        {
            // prettier-plugin-sh Dockerfile language patterns:
            // https://unpkg.com/browse/prettier-plugin-sh@0.19.0/lib/languages.js
            files: [
                // Default Dockerfile language patterns.
                "Dockerfile",
                "Containerfile",
                "*.dockerfile",
                "*.containerfile",
                // Common name variants such as Dockerfile.dev and Containerfile.prod.
                "Dockerfile.*",
                "Containerfile.*",
            ],
            options: {
                parser: "dockerfile",
                binaryNextLine: false,
                spaceRedirects: false,
            },
        },
    ],
};

export default config;

function getRustfmtConfig() {
    const output = getRustfmtConfigOutput();
    return {
        hard_tabs: getRustfmtBoolean(output, "hard_tabs"),
        tab_spaces: getRustfmtNumber(output, "tab_spaces"),
        max_width: getRustfmtNumber(output, "max_width"),
        newline_style: getRustfmtString(output, "newline_style"),
    };
}

function getPrettierEndOfLine(newlineStyle) {
    switch (newlineStyle) {
        case "Windows":
            return "crlf";
        case "Unix":
            return "lf";
        case "Native":
            return process.platform === "win32" ? "crlf" : "lf";
        case "Auto":
        default:
            return "auto";
    }
}

function ensurePluginCache() {
    if (PLUGINS.length === 0) {
        return [];
    }
    const cacheDir = getPluginCacheDir();
    installPluginsAtomically(cacheDir);
    return loadPlugins(cacheDir);
}

function getRustfmtConfigOutput() {
    const result = spawnSync(
        RUSTFMT_CMD[0],
        [...RUSTFMT_CMD.slice(1), "--print-config", "current", getRustfmtConfigLookupPath()],
        { encoding: "utf8" },
    );
    if (result.error) {
        throw new Error(
            [
                "Failed to run rustfmt while loading Prettier config.",
                `Is rustfmt available in PATH? ${result.error.message}`,
            ].join(" "),
            { cause: result.error },
        );
    }
    if (result.status !== 0) {
        throw new Error(
            [
                "Failed to load rustfmt config from",
                `${getRustfmtConfigLookupPath()}.${getCommandOutput(result)}`,
            ].join(" "),
        );
    }
    return result.stdout;
}

/**
 * Rustfmt config is resolved from process.cwd().
 *
 * Run Prettier from the Rust project root to use that project's rustfmt.toml.
 */
function getRustfmtConfigLookupPath() {
    // rustfmt uses this path to discover rustfmt.toml; the file does not need to exist.
    return path.join(process.cwd(), ".rustfmt_config_lookup.rs");
}

function getPluginCacheDir() {
    return path.join(PLUGIN_CACHE_DIR, getPluginCacheHash());
}

function installPluginsAtomically(cacheDir) {
    if (fs.existsSync(cacheDir)) {
        return;
    }
    fs.mkdirSync(PLUGIN_CACHE_DIR, { recursive: true });
    const stagingDir = fs.mkdtempSync(path.join(PLUGIN_CACHE_DIR, ".install-"));
    try {
        writePackageFile(stagingDir);
        installPlugins(stagingDir);
        promoteStagingDir(stagingDir, cacheDir);
    } catch (error) {
        fs.rmSync(stagingDir, { recursive: true, force: true });
        throw error;
    }
}

function loadPlugins(cacheDir) {
    const requireFromCache = createRequire(path.join(cacheDir, "package.json"));
    return PLUGINS.map(({ name }) => preparePlugin(name, requireFromCache(name)));
}

function preparePlugin(name, plugin) {
    if (name === "prettier-plugin-toml") {
        return {
            ...plugin,
            languages: plugin.languages?.map((language) =>
                excludeLanguageFilenames(language, ["Cargo.lock"]),
            ),
        };
    }
    return plugin;
}

function getRustfmtBoolean(output, key) {
    const value = getRustfmtRawValue(output, key);
    if (value === "true") {
        return true;
    }
    if (value === "false") {
        return false;
    }
    throw new Error(`Expected rustfmt config "${key}" to be a boolean, but got "${value}".`);
}

function getRustfmtNumber(output, key) {
    const value = Number(getRustfmtRawValue(output, key));
    if (Number.isFinite(value)) {
        return value;
    }
    throw new Error(`Expected rustfmt config "${key}" to be a number.`);
}

function getRustfmtString(output, key) {
    const value = getRustfmtRawValue(output, key).replace(/^"|"$/g, "");
    if (value === "Auto" || value === "Windows" || value === "Unix" || value === "Native") {
        return value;
    }
    throw new Error(`Expected rustfmt config "${key}" to be a valid newline style.`);
}

function getRustfmtRawValue(output, key) {
    const match = output.match(new RegExp(`^${key} = (.+)$`, "m"));
    if (match?.[1]) {
        return match[1].trim();
    }
    throw new Error(`Missing rustfmt config "${key}" from rustfmt output.`);
}

function getPluginCacheHash() {
    return crypto
        .createHash("sha256")
        .update(JSON.stringify(PLUGINS))
        .digest("hex")
        .slice(0, HASH_LENGTH);
}

function writePackageFile(stagingDir) {
    fs.writeFileSync(
        path.join(stagingDir, "package.json"),
        `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
    );
}

function installPlugins(stagingDir) {
    const result = spawnSync(
        NPM_CMD[0],
        [
            ...NPM_CMD.slice(1),
            "install",
            "--prefix",
            stagingDir,
            "--no-audit",
            "--no-fund",
            "--save-exact",
            ...PLUGINS.map(getPluginPackageSpec),
        ],
        { encoding: "utf8" },
    );
    if (result.error) {
        throw new Error(
            [
                "Failed to run npm while installing Prettier plugins.",
                `Is npm available in PATH? ${result.error.message}`,
            ].join(" "),
            { cause: result.error },
        );
    }
    if (result.status !== 0) {
        throw new Error(
            `Failed to install Prettier plugins into ${stagingDir}.${getCommandOutput(result)}`,
        );
    }
}

function promoteStagingDir(stagingDir, cacheDir) {
    try {
        fs.renameSync(stagingDir, cacheDir);
    } catch (error) {
        if (fs.existsSync(cacheDir)) {
            fs.rmSync(stagingDir, { recursive: true, force: true });
            return;
        }
        throw error;
    }
}

function getPluginPackageSpec({ name, version }) {
    return `${name}@${version}`;
}

function excludeLanguageFilenames(language, filenames) {
    return {
        ...language,
        filenames: language.filenames?.filter((filename) => !filenames.includes(filename)),
    };
}

function getCommandOutput(result) {
    const output = [result.stderr, result.stdout]
        .filter((value) => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean);
    return output.length === 0 ? "" : `\n\n${output.join("\n\n")}`;
}

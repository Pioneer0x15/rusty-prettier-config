# rusty-prettier-config

A small, Rust-friendly Prettier config for formatting the non-Rust files around Rust projects.

The goal is to provide a Rust-friendly Prettier config without adding more formatting setup to each
project. Most Rust projects do not need a custom `rustfmt.toml`, and they should not need a pile of
Prettier setup just to format TOML, shell scripts, Dockerfiles, JSONC, YAML, Markdown, and other
project files.

This config preinstalls a few useful Prettier plugins into a local cache and maps the stable rustfmt
settings that have clear Prettier equivalents. If a project does not have a `rustfmt.toml`,
rustfmt's default config is used.

## Usage

Put `.prettierrc.mjs` in your home directory to share it across Rust projects, or copy it into a
project.

Adjust the config to your taste if needed.

Run Prettier from the Rust project root. The config resolves rustfmt settings from `process.cwd()`,
so the current working directory controls which `rustfmt.toml` is used.

## Included Plugins

- `prettier-plugin-toml`
- `prettier-plugin-sh`

`prettier-plugin-sh` also covers common project files such as shell scripts, Dockerfiles,
Containerfiles, `.env`, ignore files, `.gitattributes`, `CODEOWNERS`, and `.properties`.

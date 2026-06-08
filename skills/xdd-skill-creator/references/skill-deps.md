# Skill Dependencies (DEPS.md)

Skills can declare their runtime dependencies using a `DEPS.md` file placed next to `SKILL.md` in the skill directory.

## File Location

```
skill-name/
├── SKILL.md          # Required
├── DEPS.md           # Optional - declare dependencies here
├── scripts/
├── references/
└── assets/
```

## DEPS.md Format

```markdown
# Skill Dependencies

## npm
- ws
- axios
- cheerio

## pip
- requests>=2.28.0
- beautifulsoup4

## system
- curl
- jq
- ffmpeg

## commands
- make setup
- ${SKILL_DIR}/scripts/bootstrap.sh
```

## Sections

| Section | Description | Install Method |
|---------|-------------|----------------|
| `npm` | Node.js packages | `npm install` (in skill directory) |
| `pip` | Python packages | `pip3 install --user` |
| `system` | System commands/tools | Manual (apt/brew/etc) |
| `commands` | Custom setup commands | Run directly, `${SKILL_DIR}` replaced with skill path |

## Auto-Install Mechanism

The `skill-deps` extension (`.pi/extensions/skill-deps.ts`) automatically:

1. **On startup** — scans all skills for `DEPS.md` files and checks if dependencies are met
2. **On reload** — re-scans after `/reload`
3. **Via tool** — skills can call `skill_install_deps` tool to install their own dependencies at runtime
4. **Via command** — user can run `/skill-deps check`, `/skill-deps install`, `/skill-deps auto`

## Commands

```
/skill-deps check    # Show missing dependencies
/skill-deps install  # Install all missing dependencies
/skill-deps auto     # Toggle auto-install mode (no confirmation)
/skill-deps status   # Show installed skill dependencies
```

## Tool API

Skills can self-install dependencies by calling:

```
skill_install_deps(skillPath: string, skillName: string)
```

This is useful in SKILL.md instructions:

```markdown
## Prerequisites

Before running this skill's scripts, install dependencies:

1. Call the `skill_install_deps` tool with your skill path
2. Or run: `/skill-deps install`
```

## Example: WebSocket Skill

```
websocket-helper/
├── SKILL.md
├── DEPS.md
└── scripts/
    └── ws-server.ts
```

DEPS.md:
```markdown
# websocket-helper Dependencies

## npm
- ws
- uuid
```

## Notes

- **npm packages** are installed in the skill's own directory (local `node_modules/`), not globally
- **pip packages** are installed with `--user` flag
- **system packages** are only checked, not auto-installed (requires sudo)
- **commands** can use `${SKILL_DIR}` placeholder which gets replaced with the actual skill path
- If `DEPS.md` exists but is empty, no dependencies are installed

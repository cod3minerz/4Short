# Phase 2 — isolated preset audit

Status: **blocked before foundation write**

## Pre-apply snapshot

| Item | Snapshot |
| --- | --- |
| Git HEAD | `41e56fee23f746948c25332b01cf45b3fd967210` |
| `components.json` SHA-256 | `019a8e5e76ff97898c9bab726db6a90d87defb1b1a08971ef480c7403ad4cddd` |
| `app/globals.css` SHA-256 | `2437754071f8565a1e30604f2675b11eb7f7a5d0777c9516d5317a21cee99c21` |
| `components/ui` tree | `c86b4bda7bb73443c5155a7b62752a89fe8fc0ac` (21 files, 1,972 LOC) |
| `package.json` SHA-256 | `0a75c99473ccf111d0e034f7393d9c004437028f1123b3bb69fe2330d6f2b6b1` |
| `package-lock.json` SHA-256 | `201a6ebd7e122faa47483014c5a52ceb2663b69f0fc6a471a262525ebdfb5c2a` |
| Baseline `shadcn diff` | `No updates found.` |

## Exact apply attempts

The only permitted command was executed three times from a clean branch:

```bash
npx shadcn@latest apply --preset b37sSWfzM
```

| Attempt | CLI point reached | Outcome |
| --- | --- | --- |
| 1 | registry `base-vega/sheet.json` | HTTPS connect timeout |
| 2 | `npm install shadcn@latest @hugeicons/react @hugeicons/core-free-icons` | npm `ECONNRESET` fetching `shadcn` |
| 3 | registry `base-vega/field.json` | HTTPS connect timeout |

The CLI reported a temporary `components.json` write, but every failed run
rolled it back. The complete post-attempt diff contains no preset,
dependency, theme, primitive or feature-source change. Only generated
Codebase Memory artifacts changed and were preserved in named stashes.

## Diff classification

| Changed category | Classification | Result |
| --- | --- | --- |
| Preset/theme/config | expected preset change | None written because apply failed |
| Dependencies / lockfile | required dependency change | None written because install failed |
| `components/ui` | expected registry rewrite | None written because registry retrieval failed |
| Feature code / legacy CSS | unexpected overwrite / regression | None |
| Codebase Memory artifacts | generated metadata | Preserved separately; excluded from the blocked foundation result |

## Current foundation evidence

The unchanged baseline remains `base-mira` with Lucide in `components.json`.
Current `Button` default size is `h-7`; current `Input` is `h-7`. Therefore
the required Vega `h-9` Button/Input geometry is **not installed** and cannot
be claimed as verified. `shadcn diff` after the failed attempts still returns
`No updates found.`

## Migration impacts for later phases

1. The target registry rewrite will replace all 21 current primitives, so every
   current consumer must be typechecked before Phase 3 feature work.
2. Target `h-9` controls differ from current `h-7` geometry; dashboard/editor
   layout effects must be measured, not compensated with legacy CSS overrides.
3. Hugeicons dependencies are not installed. Existing Lucide imports remain
   baseline migration debt until the permitted primitive/feature phases.
4. Missing target primitives (Card, Checkbox, Tabs, Slider, InputOTP, Sidebar)
   remain unavailable until a successful preset foundation and planned registry
   installation; do not imitate them locally.

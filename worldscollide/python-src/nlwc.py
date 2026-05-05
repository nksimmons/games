#!/usr/bin/env python3
"""Natural-language wrapper for Worlds Collide.

Example:
    python3 nlwc.py -i ffiii.smc --prompt "character gated, double xp/mp, boss exp" --dry-run
"""

import argparse
import os
import re
import shlex
import subprocess
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional

CHARACTER_NAMES = [
    "terra", "locke", "cyan", "shadow", "edgar", "sabin", "celes",
    "strago", "relm", "setzer", "mog", "gau", "gogo", "umaro",
]

WORD_MULTIPLIERS = {
    "double": 2.0,
    "triple": 3.0,
    "quadruple": 4.0,
    "half": 0.5,
}


@dataclass
class ParsedRequest:
    flags: List[str]
    notes: List[str]


@dataclass
class Preset:
    name: str
    description: str
    flags: List[str]


@dataclass
class AddOn:
    name: str
    description: str
    flags: List[str]


def objective_string(result_id: int, required_min: int, required_max: int, conditions: List[List[int]]) -> str:
    values = [result_id, required_min, required_max]
    for condition in conditions:
        values.extend(condition)
    return ".".join(str(value) for value in values)


PRESETS: Dict[str, Preset] = {
    # User-requested intents mapped directly.
    "casual-fast-progress": Preset(
        name="casual-fast-progress",
        description="Casual seed with faster progression and fewer brutal bosses.",
        flags=["-open", "-xpm", "2", "-mpm", "2", "-gpm", "2", "-be", "-bnu", "-nxppd", "-sal", "-fst", "-bel", "-dns"],
    ),
    "character-gated-high-econ": Preset(
        name="character-gated-high-econ",
        description="Character-gated run, high GP/XP, no free Paladin shields, random tiered espers.",
        flags=["-cg", "-xpm", "3", "-mpm", "2", "-gpm", "3", "-nfps", "-esrt", "-be", "-sal"],
    ),
    "objective-heavy-unlocks": Preset(
        name="objective-heavy-unlocks",
        description="Objective-heavy run with explicit unlock goals for Final Kefka and KT Skip.",
        flags=[
            "-cg",
            "-oa", objective_string(2, 2, 2, [[2, 6, 14], [4, 19, 27]]),
            "-ob", objective_string(3, 1, 1, [[2, 9, 14], [4, 11, 27]]),
            "-be",
            "-sl",
        ],
    ),
    "objective-final-kefka": Preset(
        name="objective-final-kefka",
        description="Objective preset focused on unlocking Final Kefka.",
        flags=[
            "-cg",
            "-oa", objective_string(2, 1, 1, [[2, 6, 14]]),
            "-be",
            "-sl",
        ],
    ),
    "objective-kt-skip": Preset(
        name="objective-kt-skip",
        description="Objective preset focused on unlocking KT Skip.",
        flags=[
            "-cg",
            "-oa", objective_string(3, 1, 1, [[2, 6, 14]]),
            "-be",
            "-sl",
        ],
    ),
    "objective-dual-unlock": Preset(
        name="objective-dual-unlock",
        description="Objective preset that targets both Final Kefka and KT Skip unlocks.",
        flags=[
            "-cg",
            "-oa", objective_string(2, 1, 1, [[2, 6, 14], [4, 19, 27]]),
            "-ob", objective_string(3, 1, 1, [[2, 9, 14], [4, 11, 27]]),
            "-be",
            "-sl",
        ],
    ),
    "objective-open-world-lite": Preset(
        name="objective-open-world-lite",
        description="Open-world preset with lighter objective guidance for shorter runs.",
        flags=[
            "-open",
            "-oa", objective_string(2, 1, 1, [[2, 6, 10]]),
            "-be",
            "-xpm", "2",
            "-mpm", "2",
            "-gpm", "2",
            "-sl",
        ],
    ),
    "objective-default": Preset(
        name="objective-default",
        description="Simple default objective profile (unlock Final Kefka objective).",
        flags=["-oa", objective_string(2, 1, 1, [[2, 6, 10]]), "-sl"],
    ),
    # Additional preset catalog.
    "beginner-friendly": Preset(
        name="beginner-friendly",
        description="Very forgiving setup for learning WC randomizer flow.",
        flags=["-open", "-xpm", "3", "-mpm", "3", "-gpm", "3", "-be", "-nxppd", "-sal", "-sch", "-scan", "-fst", "-bel"],
    ),
    "story-ish-open": Preset(
        name="story-ish-open",
        description="Open world with lighter randomness and mostly original feel.",
        flags=["-open", "-be", "-xpm", "2", "-mpm", "2", "-gpm", "2", "-sisr", "20", "-ccsr", "20"],
    ),
    "auto-sprint": Preset(
        name="auto-sprint",
        description="Enable auto sprint so the player always moves quickly.",
        flags=["-as"],
    ),
    "boss-rush-lite": Preset(
        name="boss-rush-lite",
        description="More boss pressure without fully chaotic settings.",
        flags=["-open", "-be", "-bbs", "-lsa", "1.5", "-hma", "1.5", "-xga", "1.5", "-sed", "-sfb"],
    ),
    "dragon-hunter": Preset(
        name="dragon-hunter",
        description="Dragon-focused scaling and encounters.",
        flags=["-cg", "-be", "-lsced", "1.5", "-hmced", "1.5", "-xgced", "1.5", "-sed"],
    ),
    "magic-chaos": Preset(
        name="magic-chaos",
        description="Heavy magic randomization with broad esper changes.",
        flags=["-open", "-esrt", "-ebr", "100", "-emprp", "75", "200", "-ems", "-nm1", "random", "-rnl1", "-rns1", "-nm2", "random", "-rnl2", "-rns2"],
    ),
    "economy-flood": Preset(
        name="economy-flood",
        description="Huge economy and growth pace for sandbox play.",
        flags=["-open", "-xpm", "4", "-mpm", "4", "-gpm", "4", "-gp", "25000", "-be", "-nxppd"],
    ),
    "ironman-light": Preset(
        name="ironman-light",
        description="Higher stakes without full permadeath.",
        flags=["-cg", "-xpm", "1", "-mpm", "1", "-gpm", "1", "-saw", "-nmc", "-nee", "-nil", "-bnu"],
    ),
    "ironman-hard": Preset(
        name="ironman-hard",
        description="High-risk challenge preset.",
        flags=["-cg", "-pd", "-nu", "-nmc", "-nee", "-nil", "-nfps", "-bbr", "-lsce", "2.0", "-hmce", "2.0", "-xgce", "2.0"],
    ),
    "no-grind": Preset(
        name="no-grind",
        description="Fast progression with quality-of-life settings.",
        flags=["-open", "-xpm", "3", "-mpm", "3", "-gpm", "2", "-nxppd", "-sal", "-scan", "-fst", "-bel", "-dns", "-be"],
    ),
    "command-chaos": Preset(
        name="command-chaos",
        description="Randomized command assignments and shuffle pressure.",
        flags=["-open", "-com", "98989898989898989898989898", "-scc", "-rec1", "27", "-be"],
    ),
    "esper-roulette": Preset(
        name="esper-roulette",
        description="Randomized esper spells, bonuses, and equipability.",
        flags=["-open", "-esr", "2", "5", "-ebr", "82", "-emprp", "75", "125", "-eer", "3", "8", "-ems"],
    ),
    "loot-lottery": Preset(
        name="loot-lottery",
        description="High-randomness itemization across shops and chests.",
        flags=["-open", "-sisr", "70", "-sprp", "75", "150", "-ccsr", "70", "-cms", "-sdm", "5", "-npi"],
    ),
    "balanced-race": Preset(
        name="balanced-race",
        description="Race-friendly balanced randomization with moderate variance.",
        flags=["-cg", "-xpm", "2", "-mpm", "2", "-gpm", "2", "-be", "-bbs", "-esrt", "-sisr", "25", "-ccsr", "25", "-sal"],
    ),
    "weeknight-short": Preset(
        name="weeknight-short",
        description="Shorter session preset for quicker completions.",
        flags=["-open", "-xpm", "3", "-mpm", "3", "-gpm", "3", "-be", "-oa", objective_string(2, 1, 1, [[2, 6, 10]]), "-nxppd"],
    ),
    "boss-ai-spice": Preset(
        name="boss-ai-spice",
        description="Enable more punishing boss AI behaviors.",
        flags=["-open", "-be", "-dgne", "-wnz", "-cmd", "-bbr", "-lsce", "1.5"],
    ),
    "zero-to-hero": Preset(
        name="zero-to-hero",
        description="Low-resource opening but strong growth curve.",
        flags=["-cg", "-gp", "0", "-sws", "0", "-sfd", "0", "-xpm", "3", "-mpm", "3", "-gpm", "3", "-be"],
    ),
    "shopless-scramble": Preset(
        name="shopless-scramble",
        description="Minimal shop support; rely on checks and drops.",
        flags=["-open", "-sie", "-ccrt", "-be", "-xpm", "2", "-mpm", "2", "-gpm", "2"],
    ),
    "custom-hack-mp-meltdown": Preset(
        name="custom-hack-mp-meltdown",
        description="Custom hack preset: cheap spells and boosted spell power.",
        flags=["-open", "-hsm1", "-hsmpw", "150", "-xpm", "2", "-mpm", "2", "-be"],
    ),
    "custom-hack-caster-apocalypse": Preset(
        name="custom-hack-caster-apocalypse",
        description="Custom hack preset: spell MP reduced and spell power heavily boosted.",
        flags=["-open", "-hsmmp", "40", "-hsmpw", "200", "-be", "-esrt", "-ems"],
    ),
}


ADD_ONS: Dict[str, AddOn] = {
    # Custom room/teleport add-ons are intentionally unavailable.
}


ADD_ON_ALIASES: Dict[str, str] = {
}


def clamp_int(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def parse_stat_multiplier(text: str, stat_words: List[str]) -> Optional[int]:
    stat_pattern = "(?:" + "|".join(re.escape(word) for word in stat_words) + ")"

    # Example: "2x xp" or "1.5x experience"
    m = re.search(rf"(\d+(?:\.\d+)?)\s*x\s*{stat_pattern}", text)
    if m:
        return clamp_int(int(round(float(m.group(1)))), 0, 255)

    # Example: "xp 2x" or "experience multiplier 2"
    m = re.search(rf"{stat_pattern}\s*(?:mult(?:iplier)?)?\s*(?:to\s*)?(\d+(?:\.\d+)?)\s*x?", text)
    if m:
        return clamp_int(int(round(float(m.group(1)))), 0, 255)

    # Example: "double xp"
    for word, factor in WORD_MULTIPLIERS.items():
        if re.search(rf"\b{word}\b\s*{stat_pattern}", text):
            return clamp_int(int(round(factor)), 0, 255)

    return None


def parse_percent_or_multiplier(text: str, topic_pattern: str) -> Optional[int]:
    # Example: "spell power 150%"
    m = re.search(rf"{topic_pattern}\s*(?:to\s*)?(\d+)\s*%", text)
    if m:
        return clamp_int(int(m.group(1)), 0, 400)

    # Example: "150% spell power"
    m = re.search(rf"(\d+)\s*%\s*{topic_pattern}", text)
    if m:
        return clamp_int(int(m.group(1)), 0, 400)

    # Example: "spell power 1.5x"
    m = re.search(rf"{topic_pattern}\s*(?:to\s*)?(\d+(?:\.\d+)?)\s*x", text)
    if m:
        return clamp_int(int(round(float(m.group(1)) * 100)), 0, 400)

    # Example: "1.5x spell power"
    m = re.search(rf"(\d+(?:\.\d+)?)\s*x\s*{topic_pattern}", text)
    if m:
        return clamp_int(int(round(float(m.group(1)) * 100)), 0, 400)

    return None


def parse_starting_gold(text: str) -> Optional[int]:
    patterns = [
        r"start(?:ing)?(?:\s+with)?\s+(\d{1,7})\s*(?:gp|gold)",
        r"(\d{1,7})\s*(?:gp|gold)\s*start",
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return clamp_int(int(m.group(1)), 0, 999999)
    return None


def parse_starting_count(text: str, item_patterns: List[str], low: int, high: int) -> Optional[int]:
    joined = "(?:" + "|".join(item_patterns) + ")"
    patterns = [
        rf"start(?:ing)?(?:\\s+with)?\\s+(\\d{{1,2}})\\s*{joined}",
        rf"(\\d{{1,2}})\\s*{joined}\\s*start",
    ]
    for pattern in patterns:
        m = re.search(pattern, text)
        if m:
            return clamp_int(int(m.group(1)), low, high)
    return None


def parse_starting_party(text: str) -> List[str]:
    # Capture names in a "start with ..." phrase. Keep first 4 unique names.
    m = re.search(r"start(?:ing)?(?:\s+party)?(?:\s+with)?\s+([^\.;,!\n]+)", text)
    if not m:
        return []

    segment = m.group(1)
    found = []
    for name in CHARACTER_NAMES:
        if re.search(rf"\b{name}\b", segment) and name not in found:
            found.append(name)
    return found[:4]


def parse_prompt(prompt: str) -> ParsedRequest:
    text = prompt.lower()
    flags: List[str] = []
    notes: List[str] = []

    def add_flag(*parts: str) -> None:
        flags.extend(parts)

    # Game mode
    if any(token in text for token in ["character gated", "character-gated", "character gating"]):
        add_flag("-cg")
        notes.append("Mode: character gating")
    elif "open world" in text or "open-world" in text:
        add_flag("-open")
        notes.append("Mode: open world")

    # Spoiler log
    if "spoiler log" in text and "no spoiler" not in text and "without spoiler" not in text:
        add_flag("-sl")
        notes.append("Spoiler log enabled")

    # Stat multipliers
    xp = parse_stat_multiplier(text, ["xp", "experience"])
    mp = parse_stat_multiplier(text, ["mp", "magic points", "magic point"])
    gp = parse_stat_multiplier(text, ["gp", "gold"])
    if xp is not None:
        add_flag("-xpm", str(xp))
        notes.append(f"XP multiplier: {xp}")
    if mp is not None:
        add_flag("-mpm", str(mp))
        notes.append(f"MP multiplier: {mp}")
    if gp is not None:
        add_flag("-gpm", str(gp))
        notes.append(f"GP multiplier: {gp}")

    if any(token in text for token in ["no exp divide", "do not divide exp", "dont divide exp", "full exp to survivors"]):
        add_flag("-nxppd")
        notes.append("No EXP party divide")

    # Boss EXP toggle
    if "boss exp" in text and "no boss exp" not in text and "without boss exp" not in text:
        add_flag("-be")
        notes.append("Bosses award EXP")

    # Starting gold
    gold = parse_starting_gold(text)
    if gold is not None:
        add_flag("-gp", str(gold))
        notes.append(f"Starting gold: {gold}")

    # Starting resources
    start_moogle_charms = parse_starting_count(
        text,
        [r"moogle\\s+charms?", r"relics?"],
        0,
        3,
    )
    if start_moogle_charms is not None:
        add_flag("-smc", str(start_moogle_charms))
        notes.append(f"Starting moogle charms: {start_moogle_charms}")

    start_warp_stones = parse_starting_count(text, [r"warp\\s+stones?"], 0, 10)
    if start_warp_stones is not None:
        add_flag("-sws", str(start_warp_stones))
        notes.append(f"Starting warp stones: {start_warp_stones}")

    start_fenix_downs = parse_starting_count(text, [r"fenix\\s+downs?", r"phoenix\\s+downs?"], 0, 10)
    if start_fenix_downs is not None:
        add_flag("-sfd", str(start_fenix_downs))
        notes.append(f"Starting fenix downs: {start_fenix_downs}")

    start_tools = parse_starting_count(text, [r"tools?"], 0, 8)
    if start_tools is not None:
        add_flag("-sto", str(start_tools))
        notes.append(f"Starting tools: {start_tools}")

    # Starting party
    start_party = parse_starting_party(text)
    if start_party:
        for index, name in enumerate(start_party, start=1):
            add_flag(f"-sc{index}", name)
        notes.append("Starting party: " + ", ".join(start_party))

    if any(token in text for token in [
        "auto sprint",
        "always sprint",
        "walk faster",
        "move faster",
        "faster walking",
        "faster movement",
    ]):
        add_flag("-as")
        notes.append("Misc: auto sprint")

    # Custom hacks
    if any(token in text for token in ["all spells cost 1", "all spells cost one", "all spells 1 mp", "all spells cost 1 mp"]):
        add_flag("-hsm1")
        notes.append("Custom hack: all non-zero spells cost 1 MP")

    mp_hack = parse_percent_or_multiplier(text, r"spell\s+mp(?:\s+cost)?s?")
    if mp_hack is not None:
        add_flag("-hsmmp", str(mp_hack))
        notes.append(f"Custom hack: spell MP multiplier {mp_hack}%")

    power_hack = parse_percent_or_multiplier(text, r"spell\s+power")
    if power_hack is not None:
        add_flag("-hsmpw", str(power_hack))
        notes.append(f"Custom hack: spell power multiplier {power_hack}%")

    # Objectives
    objective_requested = any(token in text for token in [
        "objective",
        "objectives",
        "with objectives",
        "enable objectives",
    ])
    objective_disabled = any(token in text for token in [
        "no objectives",
        "without objectives",
        "disable objectives",
    ])
    if objective_requested and not objective_disabled:
        add_flag("-oa", objective_string(2, 1, 1, [[2, 6, 10]]))
        add_flag("-sl")
        notes.append("Objectives: default objective profile enabled")

    return ParsedRequest(flags=flags, notes=notes)


def parse_presets(preset_args: List[str]) -> ParsedRequest:
    flags: List[str] = []
    notes: List[str] = []

    expanded: List[str] = []
    for preset_arg in preset_args:
        parts = [part.strip() for part in preset_arg.split(",") if part.strip()]
        expanded.extend(parts)

    for preset_name in expanded:
        preset = PRESETS.get(preset_name)
        if preset is None:
            available = ", ".join(sorted(PRESETS.keys()))
            raise ValueError(f"Unknown preset '{preset_name}'. Available presets: {available}")
        flags.extend(preset.flags)
        notes.append(f"Preset: {preset.name} - {preset.description}")

    return ParsedRequest(flags=flags, notes=notes)


def parse_addons(addon_args: List[str]) -> ParsedRequest:
    if addon_args:
        provided = []
        for addon_arg in addon_args:
            parts = [part.strip() for part in addon_arg.split(",") if part.strip()]
            provided.extend(parts)
        joined = ", ".join(provided) if provided else "unknown"
        raise ValueError(
            f"Add-ons are currently disabled; requested add-on(s): {joined}"
        )

    return ParsedRequest([], [])


def list_presets() -> str:
    lines = ["Available presets:"]
    for preset_name in sorted(PRESETS.keys()):
        preset = PRESETS[preset_name]
        lines.append(f"- {preset.name}: {preset.description}")
    return "\n".join(lines)


def list_addons() -> str:
    lines = ["Available add-ons:", "- none (currently disabled)"]
    return "\n".join(lines)


def tokenized_flags(flag_tokens: List[str]) -> List[List[str]]:
    groups: List[List[str]] = []
    i = 0
    while i < len(flag_tokens):
        token = flag_tokens[i]
        if not token.startswith("-"):
            i += 1
            continue

        group = [token]
        i += 1
        while i < len(flag_tokens) and not flag_tokens[i].startswith("-"):
            group.append(flag_tokens[i])
            i += 1
        groups.append(group)
    return groups


def normalize_flag_tokens(flag_tokens: List[str]) -> List[str]:
    # Keep only the last occurrence of each top-level flag token to make
    # preset+prompt composition practical.
    groups = tokenized_flags(flag_tokens)
    latest_index_by_flag: Dict[str, int] = {}
    for index, group in enumerate(groups):
        latest_index_by_flag[group[0]] = index

    normalized_groups: List[List[str]] = []
    for index, group in enumerate(groups):
        if latest_index_by_flag[group[0]] == index:
            normalized_groups.append(group)

    normalized: List[str] = []
    for group in normalized_groups:
        normalized.extend(group)
    return normalized


def build_command(
    input_file: str,
    flag_tokens: List[str],
    output_file: Optional[str],
    seed: Optional[str],
    no_rom_output: bool,
    stdout_log: bool,
    extra_flags: str,
) -> List[str]:
    cmd = [sys.executable, "wc.py", "-i", input_file]

    if output_file:
        cmd.extend(["-o", output_file])
    if seed:
        cmd.extend(["-s", seed])
    if no_rom_output:
        cmd.append("-nro")
    if stdout_log:
        cmd.append("-slog")

    all_flags = list(flag_tokens)

    if extra_flags:
        all_flags.extend(shlex.split(extra_flags))

    cmd.extend(normalize_flag_tokens(all_flags))

    return cmd


def main() -> int:
    parser = argparse.ArgumentParser(description="Natural-language wrapper for Worlds Collide")
    parser.add_argument("-i", "--input-file", required=True, help="Path to FFIII US v1.0 ROM")
    parser.add_argument("-o", "--output-file", required=False, help="Output ROM path")
    parser.add_argument("--seed", required=False, help="Seed string")
    parser.add_argument("--prompt", default="", help="Natural-language request")
    parser.add_argument(
        "--preset",
        action="append",
        default=[],
        help="Preset name(s). Repeat flag or pass comma-separated names.",
    )
    parser.add_argument(
        "--addon",
        action="append",
        default=[],
        help="Deprecated. Add-ons are currently disabled.",
    )
    parser.add_argument("--list-presets", action="store_true", help="List available presets and exit")
    parser.add_argument("--list-addons", action="store_true", help="List available add-ons and exit")
    parser.add_argument("--extra-flags", default="", help="Additional raw wc.py flags appended as-is")
    parser.add_argument("--start-gold", type=int, default=None, help="Starting GP (maps to -gp)")
    parser.add_argument("--start-moogle-charms", type=int, default=None, help="Starting Moogle Charms 0-3 (maps to -smc)")
    parser.add_argument("--start-warp-stones", type=int, default=None, help="Starting Warp Stones 0-10 (maps to -sws)")
    parser.add_argument("--start-fenix-downs", type=int, default=None, help="Starting Fenix Downs 0-10 (maps to -sfd)")
    parser.add_argument("--start-tools", type=int, default=None, help="Starting random tools 0-8 (maps to -sto)")
    parser.add_argument("--dry-run", action="store_true", help="Print the generated command without executing")
    parser.add_argument("--no-rom-output", action="store_true", help="Pass -nro to wc.py")
    parser.add_argument("--stdout-log", action="store_true", help="Pass -slog to wc.py")
    args = parser.parse_args()

    if args.list_presets:
        print(list_presets())
        return 0

    if args.list_addons:
        print(list_addons())
        return 0

    if not args.prompt and not args.preset and not args.addon and not args.extra_flags:
        parser.error("Provide at least one of --prompt, --preset, --addon, or --extra-flags")

    preset_parsed = parse_presets(args.preset)
    addon_parsed = parse_addons(args.addon)
    prompt_parsed = parse_prompt(args.prompt) if args.prompt else ParsedRequest([], [])

    arg_flags: List[str] = []
    arg_notes: List[str] = []

    if args.start_gold is not None:
        start_gold = clamp_int(args.start_gold, 0, 999999)
        arg_flags.extend(["-gp", str(start_gold)])
        arg_notes.append(f"Starting gold: {start_gold}")

    if args.start_moogle_charms is not None:
        start_moogle_charms = clamp_int(args.start_moogle_charms, 0, 3)
        arg_flags.extend(["-smc", str(start_moogle_charms)])
        arg_notes.append(f"Starting moogle charms: {start_moogle_charms}")

    if args.start_warp_stones is not None:
        start_warp_stones = clamp_int(args.start_warp_stones, 0, 10)
        arg_flags.extend(["-sws", str(start_warp_stones)])
        arg_notes.append(f"Starting warp stones: {start_warp_stones}")

    if args.start_fenix_downs is not None:
        start_fenix_downs = clamp_int(args.start_fenix_downs, 0, 10)
        arg_flags.extend(["-sfd", str(start_fenix_downs)])
        arg_notes.append(f"Starting fenix downs: {start_fenix_downs}")

    if args.start_tools is not None:
        start_tools = clamp_int(args.start_tools, 0, 8)
        arg_flags.extend(["-sto", str(start_tools)])
        arg_notes.append(f"Starting tools: {start_tools}")

    arg_parsed = ParsedRequest(arg_flags, arg_notes)

    merged_notes = preset_parsed.notes + addon_parsed.notes + prompt_parsed.notes + arg_parsed.notes
    merged_flags = preset_parsed.flags + addon_parsed.flags + prompt_parsed.flags + arg_parsed.flags

    command = build_command(
        input_file=args.input_file,
        flag_tokens=merged_flags,
        output_file=args.output_file,
        seed=args.seed,
        no_rom_output=args.no_rom_output,
        stdout_log=args.stdout_log,
        extra_flags=args.extra_flags,
    )

    print("Generated notes:")
    if merged_notes:
        for note in merged_notes:
            print(f"- {note}")
    else:
        print("- No specific options inferred from prompt; only explicit CLI options will be used")

    print("\nGenerated command:")
    print(" ".join(shlex.quote(part) for part in command))

    if args.dry_run:
        return 0

    repo_root = os.path.dirname(os.path.abspath(__file__))
    completed = subprocess.run(command, cwd=repo_root)
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())

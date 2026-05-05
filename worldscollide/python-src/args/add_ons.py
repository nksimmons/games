from argparse import SUPPRESS


def name():
    return "Add-Ons"


def parse(parser):
    add_ons = parser.add_argument_group("Add-Ons")
    add_ons.add_argument(
        "-aon",
        "--addon-room-network",
        action="store_true",
        help=SUPPRESS,
    )
    add_ons.add_argument(
        "-aor",
        "--addon-organized-loot-rooms",
        action="store_true",
        help=SUPPRESS,
    )
    add_ons.add_argument(
        "-aot",
        "--addon-treasure-type-vaults",
        action="store_true",
        help=SUPPRESS,
    )
    add_ons.add_argument(
        "-aoc",
        "--addon-character-recruit-hub",
        action="store_true",
        help=SUPPRESS,
    )
    add_ons.add_argument(
        "-aob",
        "--addon-boss-rooms",
        action="store_true",
        help=SUPPRESS,
    )
    add_ons.add_argument(
        "-aodh",
        "--addon-town-door-hub",
        action="store_true",
        help=SUPPRESS,
    )
    add_ons.add_argument(
        "-aowm",
        "--addon-world-map-highlight",
        action="store_true",
        help=SUPPRESS,
    )
    add_ons.add_argument(
        "-aowp",
        "--addon-world-map-progressive",
        action="store_true",
        help=SUPPRESS,
    )


def process(args):
    # Legacy compatibility only: add-on flags are accepted but disabled.
    return


def _room_network_enabled(args):
    return any([
        args.addon_room_network,
        args.addon_organized_loot_rooms,
        args.addon_treasure_type_vaults,
        args.addon_character_recruit_hub,
        args.addon_boss_rooms,
        args.addon_town_door_hub,
    ])


def flags(args):
    return ""


def options(args):
    return []


def menu(args):
    return (name(), options(args))


def log(args):
    from log import format_option

    log = [name()]
    for entry in options(args):
        log.append(format_option(*entry))

    if len(log) == 1:
        log.append(format_option("Disabled", True))

    return log

def name():
    return "Custom Hacks"


def parse(parser):
    custom_hacks = parser.add_argument_group("Custom Hacks")

    custom_hacks.add_argument(
        "-hsmmp",
        "--hack-spell-mp-mult",
        default=100,
        type=int,
        choices=range(0, 401),
        metavar="PERCENT",
        help="Multiply all spell MP costs by PERCENT [0-400], default 100",
    )
    custom_hacks.add_argument(
        "-hsmpw",
        "--hack-spell-power-mult",
        default=100,
        type=int,
        choices=range(0, 401),
        metavar="PERCENT",
        help="Multiply all spell power values by PERCENT [0-400], default 100",
    )
    custom_hacks.add_argument(
        "-hsm1",
        "--hack-all-spells-cost-one",
        action="store_true",
        help="Set all non-zero MP spells to exactly 1 MP",
    )


def process(args):
    pass


def flags(args):
    flags = ""

    if args.hack_spell_mp_mult != 100:
        flags += f" -hsmmp {args.hack_spell_mp_mult}"
    if args.hack_spell_power_mult != 100:
        flags += f" -hsmpw {args.hack_spell_power_mult}"
    if args.hack_all_spells_cost_one:
        flags += " -hsm1"

    return flags


def options(args):
    return [
        ("Spell MP Multiplier", f"{args.hack_spell_mp_mult}%"),
        ("Spell Power Multiplier", f"{args.hack_spell_power_mult}%"),
        ("All Non-Zero Spells Cost 1 MP", args.hack_all_spells_cost_one),
    ]


def menu(args):
    return (name(), options(args))


def log(args):
    from log import format_option

    log = [name()]
    for entry in options(args):
        log.append(format_option(*entry))

    return log

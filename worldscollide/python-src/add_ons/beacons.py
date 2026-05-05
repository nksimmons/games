from dataclasses import dataclass
from hashlib import sha256
from typing import Dict, List, Set


@dataclass(frozen=True)
class BeaconRegion:
    key: str
    label: str
    world: str
    icon: str
    modification_keys: List[str]
    anchor_world_x: int
    anchor_world_y: int
    target_map_id: int
    target_x: int
    target_y: int


PORTAL_TOWN_ANCHORS: Dict[str, dict] = {
    "sealed-gate": {
        "mapId": 0x007,
        "mapLabel": "Blackjack interior",
        "x": 41,
        "y": 11,
    },
    "esper-mountain": {
        "mapId": 0x007,
        "mapLabel": "Blackjack interior",
        "x": 43,
        "y": 11,
    },
    "unknown-cave": {
        "mapId": 0x007,
        "mapLabel": "Blackjack interior",
        "x": 45,
        "y": 11,
    },
    "ebots-rock": {
        "mapId": 0x007,
        "mapLabel": "Blackjack interior",
        "x": 47,
        "y": 11,
    },
}


@dataclass(frozen=True)
class FamilyConfig:
    addon_name: str
    reason: str
    candidates: List[str]


BEACON_REGIONS: Dict[str, BeaconRegion] = {
    "sealed-gate": BeaconRegion(
        key="sealed-gate",
        label="Sealed Gate Region",
        world="WOB",
        icon="[BOSS]",
        modification_keys=["WOB_SEALED_GATE_CLUSTER"],
        anchor_world_x=154,
        anchor_world_y=85,
        target_map_id=0x180,
        target_x=10,
        target_y=28,
    ),
    "esper-mountain": BeaconRegion(
        key="esper-mountain",
        label="Esper Mountain Entrance",
        world="WOB",
        icon="[RECRUIT]",
        modification_keys=["WOB_ESPER_MOUNTAIN_ENTRANCE"],
        anchor_world_x=155,
        anchor_world_y=85,
        target_map_id=0x177,
        target_x=15,
        target_y=17,
    ),
    "unknown-cave": BeaconRegion(
        key="unknown-cave",
        label="Unknown Cave Region",
        world="WOB",
        icon="[LOOT]",
        modification_keys=["WOB_UNKNOWN_CAVE"],
        anchor_world_x=156,
        anchor_world_y=85,
        target_map_id=0x114,
        target_x=30,
        target_y=28,
    ),
    "ebots-rock": BeaconRegion(
        key="ebots-rock",
        label="Ebot's Rock Region",
        world="WOR",
        icon="[TRAVEL]",
        modification_keys=["WOR_EBOTS_ROCK"],
        anchor_world_x=157,
        anchor_world_y=85,
        target_map_id=0x15D,
        target_x=45,
        target_y=21,
    ),
}


FAMILY_CONFIGS: List[FamilyConfig] = [
    FamilyConfig(
        addon_name="character-recruit-hub",
        reason="Recruit hub route",
        candidates=["esper-mountain"],
    ),
    FamilyConfig(
        addon_name="organized-loot-rooms",
        reason="Organized loot route",
        candidates=["unknown-cave"],
    ),
    FamilyConfig(
        addon_name="town-door-hub",
        reason="Town door hub route",
        candidates=["unknown-cave", "ebots-rock"],
    ),
    FamilyConfig(
        addon_name="boss-rooms",
        reason="Boss room route",
        candidates=["sealed-gate", "esper-mountain"],
    ),
    FamilyConfig(
        addon_name="treasure-type-vaults",
        reason="Treasure vault route",
        candidates=["ebots-rock"],
    ),
]


def _stable_pick(seed: str, salt: str, choices: List[str]) -> str:
    if not choices:
        raise ValueError("Cannot pick from an empty choices list")

    digest = sha256(f"{seed}|{salt}".encode("utf-8")).digest()
    index = int.from_bytes(digest[:4], "little") % len(choices)
    return choices[index]


def resolve_beacon_plan(seed: str, enabled_addons: Set[str], progressive: bool = False) -> List[dict]:
    base_seed = seed or "auto-seed"

    style = _stable_pick(base_seed, "beacon-pack-style", ["focused", "expanded"])
    region_data: Dict[str, dict] = {}

    for family_index, family in enumerate(FAMILY_CONFIGS, start=1):
        if family.addon_name not in enabled_addons:
            continue

        selected_keys = list(family.candidates)
        if style == "focused" and len(selected_keys) > 1:
            selected_keys = [_stable_pick(base_seed, family.addon_name, selected_keys)]

        for region_key in selected_keys:
            if region_key not in region_data:
                region = BEACON_REGIONS[region_key]
                portal_anchor = PORTAL_TOWN_ANCHORS[region_key]
                region_data[region_key] = {
                    "key": region.key,
                    "label": region.label,
                    "world": region.world,
                    "icon": region.icon,
                    "modificationKeys": list(region.modification_keys),
                    "anchorWorldX": region.anchor_world_x,
                    "anchorWorldY": region.anchor_world_y,
                    "portalMapId": portal_anchor["mapId"],
                    "portalMapLabel": portal_anchor["mapLabel"],
                    "portalMapX": portal_anchor["x"],
                    "portalMapY": portal_anchor["y"],
                    "targetMapId": region.target_map_id,
                    "targetX": region.target_x,
                    "targetY": region.target_y,
                    "reasons": [],
                    "tier": 1,
                }

            region_data[region_key]["reasons"].append(family.reason)
            if progressive:
                region_data[region_key]["tier"] = min(region_data[region_key]["tier"], family_index)

    # Fallback when map highlight is enabled alone.
    if not region_data:
        for region in BEACON_REGIONS.values():
            portal_anchor = PORTAL_TOWN_ANCHORS[region.key]
            region_data[region.key] = {
                "key": region.key,
                "label": region.label,
                "world": region.world,
                "icon": region.icon,
                "modificationKeys": list(region.modification_keys),
                "anchorWorldX": region.anchor_world_x,
                "anchorWorldY": region.anchor_world_y,
                "portalMapId": portal_anchor["mapId"],
                "portalMapLabel": portal_anchor["mapLabel"],
                "portalMapX": portal_anchor["x"],
                "portalMapY": portal_anchor["y"],
                "targetMapId": region.target_map_id,
                "targetX": region.target_x,
                "targetY": region.target_y,
                "reasons": ["Default world map highlight"],
                "tier": 1,
            }

    plan = sorted(region_data.values(), key=lambda entry: (entry["tier"], entry["label"]))
    return plan

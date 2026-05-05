class CustomHacks:
    def __init__(self, args, data):
        self.args = args
        self.data = data

    def mod(self):
        self._mod_spell_mp()
        self._mod_spell_power()

    def _mod_spell_mp(self):
        if self.args.hack_all_spells_cost_one:
            for spell in self.data.spells.spells:
                if spell.mp > 0:
                    spell.mp = 1

        if self.args.hack_spell_mp_mult == 100:
            return

        percent = self.args.hack_spell_mp_mult / 100.0
        for spell in self.data.spells.spells:
            original = spell.mp
            scaled = int(round(original * percent))
            if original > 0 and percent > 0 and scaled == 0:
                scaled = 1
            spell.mp = max(0, min(255, scaled))

    def _mod_spell_power(self):
        if self.args.hack_spell_power_mult == 100:
            return

        percent = self.args.hack_spell_power_mult / 100.0
        for spell in self.data.spells.spells:
            scaled = int(round(spell.power * percent))
            spell.power = max(0, min(255, scaled))

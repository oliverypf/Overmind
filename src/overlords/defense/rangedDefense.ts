import { CreepSetup } from '../../creepSetups/CreepSetup';
import { CombatSetups, Roles } from '../../creepSetups/setups';
import { DirectiveInvasionDefense } from '../../directives/defense/invasionDefense';
import { CombatIntel } from '../../intel/CombatIntel';
import { OverlordPriority } from '../../priorities/priorities_overlords';
import { profile } from '../../profiler/decorator';
import { boostResources } from '../../resources/map_resources';
import { CombatZerg } from '../../zerg/CombatZerg';
import { CombatOverlord } from '../CombatOverlord';

/**
 * Spawns ranged defenders to defend against incoming player invasions in an owned room
 */
@profile
export class RangedDefenseOverlord extends CombatOverlord {

	hydralisks: CombatZerg[];
	healers: CombatZerg[];
	room: Room;

	static settings = {
		retreatHitsPercent: 0.85,
		reengageHitsPercent: 0.95,
	};

	constructor(directive: DirectiveInvasionDefense,
		boosted = false,
		priority = OverlordPriority.defense.rangedDefense) {
		super(directive, 'rangedDefense', priority, 1);
		this.hydralisks = this.combatZerg(Roles.ranged, {
			boostWishlist: boosted ? [boostResources.tough[3], boostResources.ranged_attack[3],
			boostResources.heal[3], boostResources.move[3]] : undefined
		});
		this.healers = this.combatZerg(Roles.healer, {
			boostWishlist: boosted ? [boostResources.heal[3], boostResources.tough[3],
			boostResources.move[3]] : undefined
		});
	}

	private handleDefender(hydralisk: CombatZerg): void {
		const healer = hydralisk.findPartner(this.healers);
		// Case 1: no healer partner yet - wait or fight alone
		if (!healer || healer.spawning) {
			if (this.room.hostiles.length > 0) {
				hydralisk.autoCombat(this.room.name);
			} else {
				hydralisk.doMedicActions(this.room.name);
			}
		}
		// Case 2: have an active healer partner
		else {
			// Handle retreat if low HP
			if (hydralisk.needsToRecover(RangedDefenseOverlord.settings.retreatHitsPercent) ||
				healer.needsToRecover(RangedDefenseOverlord.settings.retreatHitsPercent)) {
				hydralisk.kite(this.room.hostiles, { range: 5 });
			} else if (this.room.hostiles.length > 0) {
				hydralisk.autoCombat(this.room.name);
			} else {
				hydralisk.doMedicActions(this.room.name);
			}
		}
	}

	private handleHealer(healer: CombatZerg): void {
		const partner = healer.findPartner(this.hydralisks);
		// Case 1: no partner - self heal and wait
		if (!partner || partner.spawning) {
			if (healer.hits < healer.hitsMax) {
				healer.heal(healer);
			}
			healer.park();
		}
		// Case 2: have a partner - follow and heal
		else {
			// Prioritize healing based on damage
			if (partner.hitsMax - partner.hits > healer.hitsMax - healer.hits) {
				if (healer.pos.isNearTo(partner)) {
					healer.heal(partner);
				} else {
					healer.rangedHeal(partner);
				}
			} else {
				healer.heal(healer);
			}
			// Follow the partner
			if (!healer.pos.isNearTo(partner)) {
				healer.goTo(partner, { range: 1 });
			}
		}
	}

	private computeNeededHydraliskAmount(setup: CreepSetup, boostMultiplier: number): number {
		const healAmount = CombatIntel.maxHealingByCreeps(this.room.hostiles);
		const hydraliskDamage = RANGED_ATTACK_POWER * boostMultiplier
			* setup.getBodyPotential(RANGED_ATTACK, this.colony);
		const towerDamage = this.room.hostiles[0] ? CombatIntel.towerDamageAtPos(this.room.hostiles[0].pos) || 0 : 0;
		const worstDamageMultiplier = _.min(_.map(this.room.hostiles,
			creep => CombatIntel.minimumDamageTakenMultiplier(creep)));
		// Increase the multiplier from 1.5 to 2.5 to ensure we have enough firepower to break through healing
		return Math.ceil(.5 + 2.5 * healAmount / (worstDamageMultiplier * (hydraliskDamage + towerDamage + 1)));
	}

	init() {
		this.reassignIdleCreeps(Roles.ranged);
		this.reassignIdleCreeps(Roles.healer);
		let hydraliskAmount: number;
		if (this.canBoostSetup(CombatSetups.hydralisks.boosted_T3)) {
			const setup = CombatSetups.hydralisks.boosted_T3;
			hydraliskAmount = this.computeNeededHydraliskAmount(setup, BOOSTS.ranged_attack.XKHO2.rangedAttack);
			this.wishlist(hydraliskAmount, setup);
		} else {
			const setup = CombatSetups.hydralisks.default;
			hydraliskAmount = this.computeNeededHydraliskAmount(setup, 1);
			this.wishlist(hydraliskAmount, setup);
		}
		// Spawn healers to pair with hydralisks
		const healerSetup = this.canBoostSetup(CombatSetups.healers.boosted_T3)
			? CombatSetups.healers.boosted_T3
			: CombatSetups.healers.default;
		this.wishlist(hydraliskAmount, healerSetup);
	}

	run() {
		this.autoRun(this.hydralisks, hydralisk => this.handleDefender(hydralisk));
		this.autoRun(this.healers, healer => this.handleHealer(healer));
	}
}

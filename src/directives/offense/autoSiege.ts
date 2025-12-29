import {log} from '../../console/log';
import {CombatIntel} from '../../intel/CombatIntel';
import {ControllerAttackerOverlord} from '../../overlords/offense/controllerAttacker';
import {PairDestroyerOverlord} from '../../overlords/offense/pairDestroyer';
import {SwarmDestroyerOverlord} from '../../overlords/offense/swarmDestroyer';
import {profile} from '../../profiler/decorator';
import {CombatPlanner, SiegeAnalysis} from '../../strategy/CombatPlanner';
import {Visualizer} from '../../visuals/Visualizer';
import {Directive} from '../Directive';

interface DirectiveAutoSiegeMemory extends FlagMemory {
	siegeAnalysis?: SiegeAnalysis;
	stage: 'scouting' | 'analyzing' | 'sieging' | 'cleanup';
	attackStarted?: number;
}

/**
 * Automatic siege directive: uses scouting/observer data to determine an appropriate offensive strike level,
 * then sieges the targeted room until it is no longer claimed
 */
@profile
export class DirectiveAutoSiege extends Directive {

	static directiveName = 'autoSiege';
	static color = COLOR_RED;
	static secondaryColor = COLOR_ORANGE;

	memory: DirectiveAutoSiegeMemory;

	static settings = {
		maxBarrierHitsForPair: 500000,      // Use pair destroyer if barriers below this
		maxBarrierHitsForSwarm: 2000000,    // Use swarm destroyer if barriers below this
		minTowerDamageForBoosts: 1500,      // Boost creeps if tower damage exceeds this
		scoutingTimeout: 500,               // Time to wait for scouting before giving up
	};

	constructor(flag: Flag) {
		super(flag);
		if (!this.memory.stage) {
			this.memory.stage = 'scouting';
		}
	}

	spawnMoarOverlords() {
		if (!this.memory.siegeAnalysis) {
			return; // Wait for siege analysis
		}

		const analysis = this.memory.siegeAnalysis;

		// Determine if we need boosts based on tower damage
		const useBoosts = analysis.maxTowerDamage > DirectiveAutoSiege.settings.minTowerDamageForBoosts;

		// Choose attack strategy based on room layout and defenses
		switch (analysis.roomLayout) {
			case 'exposed':
				// Easy target - use pair destroyer
				this.overlords.destroy = new PairDestroyerOverlord(this as any);
				log.info(`${this.print}: Using Pair Destroyer (exposed layout)`);
				break;

			case 'edgewall':
			case 'innerwall':
				// Walled room - check barrier strength
				if (analysis.minBarrierHits < DirectiveAutoSiege.settings.maxBarrierHitsForPair) {
					this.overlords.destroy = new PairDestroyerOverlord(this as any);
					log.info(`${this.print}: Using Pair Destroyer (weak barriers: ${analysis.minBarrierHits})`);
				} else if (analysis.minBarrierHits < DirectiveAutoSiege.settings.maxBarrierHitsForSwarm) {
					this.overlords.destroy = new SwarmDestroyerOverlord(this as any);
					log.info(`${this.print}: Using Swarm Destroyer (medium barriers: ${analysis.minBarrierHits})`);
				} else {
					// Very strong barriers - need specialized breaker (not implemented yet)
					log.warning(`${this.print}: Barriers too strong (${analysis.minBarrierHits}), need wall breaker!`);
					this.overlords.destroy = new SwarmDestroyerOverlord(this as any);
				}
				break;

			case 'bunker':
				// Bunker layout - always use swarm
				this.overlords.destroy = new SwarmDestroyerOverlord(this as any);
				log.info(`${this.print}: Using Swarm Destroyer (bunker layout)`);
				break;

			default:
				// Default to pair destroyer
				this.overlords.destroy = new PairDestroyerOverlord(this as any);
				break;
		}

		// If room is unclaimed or low level, also attack controller
		if (!analysis.owner || analysis.level <= 4) {
			this.overlords.controllerAttack = new ControllerAttackerOverlord(this as any);
		}
	}

	/**
	 * Request room observation if we don't have vision
	 */
	private requestVision(): boolean {
		if (this.room) {
			return true; // Already have vision
		}

		// Try to use observer
		if (this.colony.commandCenter && this.colony.commandCenter.observer) {
			this.colony.commandCenter.requestRoomObservation(this.pos.roomName);
			return false;
		}

		// No observer - would need to send a scout
		return false;
	}

	/**
	 * Update siege analysis
	 */
	private updateAnalysis(): void {
		if (!this.room) return;

		if (!this.memory.siegeAnalysis || Game.time > this.memory.siegeAnalysis.expiration) {
			this.memory.siegeAnalysis = CombatPlanner.getSiegeAnalysis(this.room);
			log.info(`${this.print}: Updated siege analysis - Layout: ${this.memory.siegeAnalysis.roomLayout}, ` +
				`Barriers: ${this.memory.siegeAnalysis.minBarrierHits}, Towers: ${this.memory.siegeAnalysis.maxTowerDamage}`);
		}
	}

	init(): void {
		switch (this.memory.stage) {
			case 'scouting':
				this.alert(`Auto-siege: Scouting target room`);
				if (this.requestVision()) {
					this.memory.stage = 'analyzing';
				}
				break;

			case 'analyzing':
				this.alert(`Auto-siege: Analyzing defenses`);
				this.updateAnalysis();
				if (this.memory.siegeAnalysis) {
					this.memory.stage = 'sieging';
					this.memory.attackStarted = Game.time;
				}
				break;

			case 'sieging':
				const hostileCount = this.room ? this.room.hostiles.length : '?';
				const structureCount = this.room ? this.room.hostileStructures.length : '?';
				this.alert(`Auto-siege: Active (hostiles: ${hostileCount}, structures: ${structureCount})`);
				// Periodically update analysis
				if (Game.time % 500 === 0) {
					this.updateAnalysis();
				}
				break;

			case 'cleanup':
				this.alert(`Auto-siege: Cleanup phase`);
				break;
		}
	}

	run(): void {
		// Check if siege is complete
		if (this.room) {
			const hasHostiles = this.room.hostiles.length > 0;
			const hasHostileStructures = this.room.hostileStructures.length > 0;
			const hasController = this.room.controller && this.room.controller.owner;

			if (!hasHostiles && !hasHostileStructures && !hasController) {
				log.notify(`Auto-siege operation at ${this.pos.roomName} completed successfully!`);
				this.remove();
				return;
			}

			// If only controller left, switch to cleanup
			if (!hasHostiles && !hasHostileStructures && hasController) {
				this.memory.stage = 'cleanup';
			}
		}
	}

	visuals(): void {
		Visualizer.marker(this.pos, {color: 'red'});
		if (this.memory.siegeAnalysis) {
			const analysis = this.memory.siegeAnalysis;
			Visualizer.infoBox(`AutoSiege`, [
				`Stage: ${this.memory.stage}`,
				`Layout: ${analysis.roomLayout}`,
				`Barriers: ${Math.round(analysis.minBarrierHits / 1000)}K`,
				`Towers: ${analysis.maxTowerDamage}`,
			], {x: this.pos.x + 1, y: this.pos.y, roomName: this.pos.roomName}, 8);
		}
	}

}

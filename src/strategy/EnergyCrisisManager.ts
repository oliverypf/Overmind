import {log} from '../console/log';
import {profile} from '../profiler/decorator';

/**
 * Energy crisis level
 */
type CrisisLevel = 'none' | 'warning' | 'critical' | 'emergency';

/**
 * Colony energy status
 */
interface ColonyEnergyStatus {
	colonyName: string;
	level: CrisisLevel;
	storedEnergy: number;
	income: number;
	consumption: number;
	projectedDepletion: number; // Ticks until empty at current rate
}

/**
 * Energy crisis response action
 */
interface CrisisAction {
	type: 'reduce_upgrading' | 'reduce_building' | 'pause_remote_mining' |
		  'request_energy' | 'emergency_harvest' | 'sell_resources';
	colony: string;
	details: string;
}

/**
 * Energy crisis memory
 */
interface EnergyCrisisMemory {
	colonyStatus: {[colonyName: string]: ColonyEnergyStatus};
	activeActions: CrisisAction[];
	lastUpdate: number;
}

const DEFAULT_CRISIS_MEMORY: EnergyCrisisMemory = {
	colonyStatus: {},
	activeActions: [],
	lastUpdate: 0,
};

/**
 * EnergyCrisisManager: Proactively manages energy shortages across colonies.
 *
 * Crisis levels:
 * - none: Energy > 200k, healthy operation
 * - warning: Energy 50k-200k, reduce non-essential operations
 * - critical: Energy 10k-50k, significant cutbacks needed
 * - emergency: Energy < 10k, survival mode
 */
@profile
export class EnergyCrisisManager {

	static settings = {
		// Energy thresholds
		healthyThreshold: 200000,
		warningThreshold: 50000,
		criticalThreshold: 10000,
		emergencyThreshold: 5000,

		// Update interval
		updateInterval: 50,

		// Minimum energy to keep for essential operations
		reserveEnergy: 5000,

		// Terminal transfer amount
		emergencyTransferAmount: 25000,
	};

	/**
	 * Get crisis memory
	 */
	static get memory(): EnergyCrisisMemory {
		if (!Memory.energyCrisis) {
			Memory.energyCrisis = _.cloneDeep(DEFAULT_CRISIS_MEMORY);
		}
		return Memory.energyCrisis as EnergyCrisisMemory;
	}

	/**
	 * Analyze energy status for a colony
	 */
	static analyzeColony(colony: any): ColonyEnergyStatus {
		const storage = colony.storage;
		const terminal = colony.terminal;

		// Calculate total stored energy
		let storedEnergy = 0;
		if (storage) {
			storedEnergy += storage.store[RESOURCE_ENERGY] || 0;
		}
		if (terminal) {
			storedEnergy += terminal.store[RESOURCE_ENERGY] || 0;
		}

		// Estimate income (energy harvested per tick)
		// This is approximate based on sources and miners
		const sources = colony.sources || [];
		const income = sources.length * (SOURCE_ENERGY_CAPACITY / ENERGY_REGEN_TIME);

		// Estimate consumption (rough estimate based on creep count and operations)
		const creepCount = _.keys(Game.creeps).filter((name: string) =>
			Game.creeps[name].memory.colony === colony.name
		).length;
		const consumption = creepCount * 2 + // Spawning cost amortized
						   (colony.room.controller ? colony.room.controller.level : 0) * 5 + // Upgrading
						   10; // Base operations

		// Project depletion time
		const netChange = income - consumption;
		const projectedDepletion = netChange >= 0
			? Infinity
			: Math.floor(storedEnergy / Math.abs(netChange));

		// Determine crisis level
		let level: CrisisLevel = 'none';
		if (storedEnergy < this.settings.emergencyThreshold) {
			level = 'emergency';
		} else if (storedEnergy < this.settings.criticalThreshold) {
			level = 'critical';
		} else if (storedEnergy < this.settings.warningThreshold) {
			level = 'warning';
		}

		return {
			colonyName: colony.name,
			level,
			storedEnergy,
			income,
			consumption,
			projectedDepletion,
		};
	}

	/**
	 * Get recommended actions for a crisis level
	 */
	static getRecommendedActions(status: ColonyEnergyStatus): CrisisAction[] {
		const actions: CrisisAction[] = [];

		switch (status.level) {
			case 'emergency':
				// Emergency mode - maximum conservation
				actions.push({
					type: 'reduce_upgrading',
					colony: status.colonyName,
					details: 'Stop all upgrading - emergency mode'
				});
				actions.push({
					type: 'reduce_building',
					colony: status.colonyName,
					details: 'Stop all building - emergency mode'
				});
				actions.push({
					type: 'pause_remote_mining',
					colony: status.colonyName,
					details: 'Pause remote mining to reduce transport costs'
				});
				actions.push({
					type: 'request_energy',
					colony: status.colonyName,
					details: 'Request emergency energy transfer from other colonies'
				});
				actions.push({
					type: 'emergency_harvest',
					colony: status.colonyName,
					details: 'Prioritize local harvesting over all other tasks'
				});
				break;

			case 'critical':
				// Critical mode - significant cutbacks
				actions.push({
					type: 'reduce_upgrading',
					colony: status.colonyName,
					details: 'Reduce upgrading to minimum (1 upgrader)'
				});
				actions.push({
					type: 'reduce_building',
					colony: status.colonyName,
					details: 'Pause non-essential building'
				});
				actions.push({
					type: 'request_energy',
					colony: status.colonyName,
					details: 'Request energy from surplus colonies'
				});
				break;

			case 'warning':
				// Warning mode - minor adjustments
				actions.push({
					type: 'reduce_upgrading',
					colony: status.colonyName,
					details: 'Reduce upgrader count by 50%'
				});
				break;

			case 'none':
				// No crisis - check if we can help other colonies
				if (status.storedEnergy > this.settings.healthyThreshold * 2) {
					actions.push({
						type: 'sell_resources',
						colony: status.colonyName,
						details: 'Consider selling excess energy or helping other colonies'
					});
				}
				break;
		}

		return actions;
	}

	/**
	 * Execute energy transfer between colonies
	 */
	static executeEnergyTransfer(fromColony: any, toColony: any, amount: number): boolean {
		const fromTerminal = fromColony.terminal;
		const toTerminal = toColony.terminal;

		if (!fromTerminal || !toTerminal) {
			log.warning(`Cannot transfer energy: missing terminal`);
			return false;
		}

		if ((fromTerminal.store[RESOURCE_ENERGY] || 0) < amount) {
			log.warning(`Cannot transfer energy: insufficient energy in source`);
			return false;
		}

		if (fromTerminal.cooldown) {
			return false; // Try again later
		}

		const result = fromTerminal.send(RESOURCE_ENERGY, amount, toColony.room.name,
			`Emergency energy transfer`);

		if (result === OK) {
			log.info(`Transferred ${amount} energy from ${fromColony.name} to ${toColony.name}`);
			return true;
		} else {
			log.warning(`Failed to transfer energy: ${result}`);
			return false;
		}
	}

	/**
	 * Find colonies with surplus energy that can help
	 */
	static findSurplusColonies(): string[] {
		const surplus: string[] = [];

		for (const colonyName in Overmind.colonies) {
			const status = this.memory.colonyStatus[colonyName];
			if (status && status.storedEnergy > this.settings.healthyThreshold * 1.5) {
				surplus.push(colonyName);
			}
		}

		return surplus;
	}

	/**
	 * Find colonies in crisis
	 */
	static findCrisisColonies(): ColonyEnergyStatus[] {
		const crisis: ColonyEnergyStatus[] = [];

		for (const colonyName in this.memory.colonyStatus) {
			const status = this.memory.colonyStatus[colonyName];
			if (status.level !== 'none') {
				crisis.push(status);
			}
		}

		// Sort by severity (emergency first)
		return _.sortBy(crisis, s => {
			switch (s.level) {
				case 'emergency': return 0;
				case 'critical': return 1;
				case 'warning': return 2;
				default: return 3;
			}
		});
	}

	/**
	 * Coordinate energy transfers between colonies
	 */
	static coordinateTransfers(): void {
		const surplusColonies = this.findSurplusColonies();
		const crisisColonies = this.findCrisisColonies();

		if (surplusColonies.length === 0 || crisisColonies.length === 0) {
			return;
		}

		// Match surplus colonies with crisis colonies
		for (const crisis of crisisColonies) {
			if (crisis.level === 'none') continue;

			for (const surplusName of surplusColonies) {
				const surplusColony = Overmind.colonies[surplusName];
				const crisisColony = Overmind.colonies[crisis.colonyName];

				if (!surplusColony || !crisisColony) continue;

				// Determine transfer amount based on crisis level
				let amount = this.settings.emergencyTransferAmount;
				if (crisis.level === 'critical') {
					amount = Math.floor(amount * 0.75);
				} else if (crisis.level === 'warning') {
					amount = Math.floor(amount * 0.5);
				}

				// Try to execute transfer
				if (this.executeEnergyTransfer(surplusColony, crisisColony, amount)) {
					log.info(`Energy crisis response: sent ${amount} from ${surplusName} to ${crisis.colonyName}`);
					break; // Move to next crisis colony
				}
			}
		}
	}

	/**
	 * Get the crisis level modifier for spawning
	 * Returns a multiplier for creep spawn quantities
	 */
	static getSpawnModifier(colonyName: string): number {
		const status = this.memory.colonyStatus[colonyName];
		if (!status) return 1.0;

		switch (status.level) {
			case 'emergency': return 0.25; // Only 25% of normal spawning
			case 'critical': return 0.5;   // 50% of normal spawning
			case 'warning': return 0.75;   // 75% of normal spawning
			default: return 1.0;           // Normal spawning
		}
	}

	/**
	 * Check if a colony should pause upgrading
	 */
	static shouldPauseUpgrading(colonyName: string): boolean {
		const status = this.memory.colonyStatus[colonyName];
		return status ? (status.level === 'emergency' || status.level === 'critical') : false;
	}

	/**
	 * Check if a colony should pause building
	 */
	static shouldPauseBuilding(colonyName: string): boolean {
		const status = this.memory.colonyStatus[colonyName];
		return status ? status.level === 'emergency' : false;
	}

	/**
	 * Check if a colony should pause remote mining
	 */
	static shouldPauseRemoteMining(colonyName: string): boolean {
		const status = this.memory.colonyStatus[colonyName];
		return status ? status.level === 'emergency' : false;
	}

	/**
	 * Main run method
	 */
	static run(): void {
		// Only update periodically to save CPU
		if (Game.time - this.memory.lastUpdate < this.settings.updateInterval) {
			return;
		}

		this.memory.lastUpdate = Game.time;
		this.memory.activeActions = [];

		// Analyze all colonies
		for (const colonyName in Overmind.colonies) {
			const colony = Overmind.colonies[colonyName];
			const status = this.analyzeColony(colony);
			this.memory.colonyStatus[colonyName] = status;

			// Log crisis situations
			if (status.level === 'emergency') {
				log.alert(`🔴 ENERGY EMERGENCY: ${colonyName} has only ${status.storedEnergy} energy!`);
			} else if (status.level === 'critical') {
				log.warning(`⚠️ Energy critical: ${colonyName} - ${status.storedEnergy} energy`);
			}

			// Get recommended actions
			const actions = this.getRecommendedActions(status);
			this.memory.activeActions.push(...actions);
		}

		// Coordinate transfers between colonies
		this.coordinateTransfers();
	}

	/**
	 * Get a summary of all colony energy status
	 */
	static getSummary(): string {
		let summary = 'Energy Status:\n';

		for (const colonyName in this.memory.colonyStatus) {
			const status = this.memory.colonyStatus[colonyName];
			const levelIcon = status.level === 'emergency' ? '🔴' :
							  status.level === 'critical' ? '🟠' :
							  status.level === 'warning' ? '🟡' : '🟢';

			summary += `  ${levelIcon} ${colonyName}: ${Math.floor(status.storedEnergy / 1000)}k ` +
					   `(${status.level})\n`;
		}

		return summary;
	}
}

// Extend Memory interface
declare global {
	interface Memory {
		energyCrisis?: EnergyCrisisMemory;
	}
}

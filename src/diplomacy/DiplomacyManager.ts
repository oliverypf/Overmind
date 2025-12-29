import {log} from '../console/log';
import {Mem} from '../memory/Memory';
import {profile} from '../profiler/decorator';

/**
 * Player relationship types
 */
export type RelationType = 'ally' | 'neutral' | 'enemy' | 'nap';

/**
 * Player profile with interaction history
 */
interface PlayerProfile {
	relation: RelationType;
	lastSeen: number;
	lastInteraction: number;
	aggressionScore: number;      // Higher = more aggressive towards us
	trustScore: number;           // Higher = more trustworthy
	notes?: string;
	manuallySet?: boolean;        // If true, don't auto-update relation
}

/**
 * Diplomacy memory structure
 */
interface DiplomacyMemory {
	players: { [username: string]: PlayerProfile };
	lastUpdate: number;
	segment?: {
		lastPublish: number;
		data?: any;
	};
}

const DiplomacyMemoryDefaults: DiplomacyMemory = {
	players: {},
	lastUpdate: 0,
};

/**
 * Default profiles for known players
 */
const DEFAULT_ALLIES: string[] = [
	// Add known allies here
];

const DEFAULT_ENEMIES: string[] = [
	// Add known enemies here
];

/**
 * Diplomacy Manager - handles player relations, alliances, and inter-player communication
 */
@profile
export class DiplomacyManager {

	static memory: DiplomacyMemory;

	static settings = {
		updateInterval: 100,                // How often to update diplomacy state
		aggressionDecayRate: 0.01,          // How fast aggression score decays per tick
		trustDecayRate: 0.001,              // How fast trust score decays per tick
		aggressionThreshold: 50,            // Score above which player becomes enemy
		trustThreshold: 50,                 // Score above which player becomes ally
		napDuration: 50000,                 // Default NAP duration in ticks
	};

	/**
	 * Initialize the diplomacy manager
	 */
	static init(): void {
		this.memory = Mem.wrap(Memory.Overmind, 'diplomacy', DiplomacyMemoryDefaults);

		// Set up default allies
		for (const ally of DEFAULT_ALLIES) {
			if (!this.memory.players[ally]) {
				this.setRelation(ally, 'ally', true);
			}
		}

		// Set up default enemies
		for (const enemy of DEFAULT_ENEMIES) {
			if (!this.memory.players[enemy]) {
				this.setRelation(enemy, 'enemy', true);
			}
		}
	}

	/**
	 * Get or create player profile
	 */
	static getPlayer(username: string): PlayerProfile {
		if (!this.memory.players[username]) {
			this.memory.players[username] = {
				relation: 'neutral',
				lastSeen: Game.time,
				lastInteraction: 0,
				aggressionScore: 0,
				trustScore: 0,
			};
		}
		return this.memory.players[username];
	}

	/**
	 * Check if a player is whitelisted (ally or NAP)
	 */
	static isWhitelisted(username: string): boolean {
		const profile = this.memory.players[username];
		if (!profile) return false;
		return profile.relation === 'ally' || profile.relation === 'nap';
	}

	/**
	 * Check if a player is an ally
	 */
	static isAlly(username: string): boolean {
		const profile = this.memory.players[username];
		return profile ? profile.relation === 'ally' : false;
	}

	/**
	 * Check if a player is an enemy
	 */
	static isEnemy(username: string): boolean {
		const profile = this.memory.players[username];
		return profile ? profile.relation === 'enemy' : false;
	}

	/**
	 * Check if we have a NAP with a player
	 */
	static hasNAP(username: string): boolean {
		const profile = this.memory.players[username];
		return profile ? profile.relation === 'nap' : false;
	}

	/**
	 * Get the relation type for a player
	 */
	static getRelation(username: string): RelationType {
		const profile = this.memory.players[username];
		return profile ? profile.relation : 'neutral';
	}

	/**
	 * Manually set a player's relation
	 */
	static setRelation(username: string, relation: RelationType, manual = true): void {
		const profile = this.getPlayer(username);
		profile.relation = relation;
		profile.manuallySet = manual;
		profile.lastInteraction = Game.time;
		log.info(`Diplomacy: Set ${username} as ${relation}`);
	}

	/**
	 * Record an aggressive action from a player
	 */
	static recordAggression(username: string, severity: number = 1): void {
		if (username === 'Invader' || username === 'Source Keeper') return;

		const profile = this.getPlayer(username);
		profile.aggressionScore += severity * 10;
		profile.lastInteraction = Game.time;
		profile.lastSeen = Game.time;

		// Auto-update relation if not manually set
		if (!profile.manuallySet && profile.aggressionScore > DiplomacyManager.settings.aggressionThreshold) {
			if (profile.relation !== 'enemy') {
				profile.relation = 'enemy';
				log.alert(`Diplomacy: ${username} marked as ENEMY due to aggression`);
			}
		}
	}

	/**
	 * Record a friendly action from a player
	 */
	static recordFriendlyAction(username: string, magnitude: number = 1): void {
		if (username === 'Invader' || username === 'Source Keeper') return;

		const profile = this.getPlayer(username);
		profile.trustScore += magnitude * 10;
		profile.aggressionScore = Math.max(0, profile.aggressionScore - magnitude * 5);
		profile.lastInteraction = Game.time;
		profile.lastSeen = Game.time;

		// Auto-update relation if not manually set
		if (!profile.manuallySet && profile.trustScore > DiplomacyManager.settings.trustThreshold) {
			if (profile.relation === 'neutral') {
				log.info(`Diplomacy: ${username} could be promoted to ally (trust score: ${profile.trustScore})`);
			}
		}
	}

	/**
	 * Record seeing a player's creep/structure
	 */
	static recordSighting(username: string): void {
		if (username === 'Invader' || username === 'Source Keeper') return;

		const profile = this.getPlayer(username);
		profile.lastSeen = Game.time;
	}

	/**
	 * Decay scores over time
	 */
	private static decayScores(): void {
		for (const username in this.memory.players) {
			const profile = this.memory.players[username];

			// Decay aggression
			if (profile.aggressionScore > 0) {
				profile.aggressionScore *= (1 - DiplomacyManager.settings.aggressionDecayRate);
				if (profile.aggressionScore < 1) profile.aggressionScore = 0;
			}

			// Decay trust slowly
			if (profile.trustScore > 0) {
				profile.trustScore *= (1 - DiplomacyManager.settings.trustDecayRate);
				if (profile.trustScore < 1) profile.trustScore = 0;
			}
		}
	}

	/**
	 * Scan rooms for player interactions
	 */
	private static scanRooms(): void {
		for (const roomName in Game.rooms) {
			const room = Game.rooms[roomName];

			// Record sightings of hostile creeps
			for (const hostile of room.hostiles) {
				const owner = hostile.owner.username;
				this.recordSighting(owner);

				// Record aggression if they're in our rooms
				if (room.my || room.reservedByMe) {
					this.recordAggression(owner, 0.1);
				}
			}

			// Record sightings of hostile structures
			for (const structure of room.hostileStructures as any[]) {
				if (structure && structure.owner && structure.owner.username) {
					this.recordSighting(structure.owner.username);
				}
			}
		}
	}

	/**
	 * Get all allies
	 */
	static getAllies(): string[] {
		return _.filter(_.keys(this.memory.players),
			username => this.memory.players[username].relation === 'ally');
	}

	/**
	 * Get all enemies
	 */
	static getEnemies(): string[] {
		return _.filter(_.keys(this.memory.players),
			username => this.memory.players[username].relation === 'enemy');
	}

	/**
	 * Get diplomacy status report
	 */
	static getStatusReport(): string {
		const allies = this.getAllies();
		const enemies = this.getEnemies();
		const naps = _.filter(_.keys(this.memory.players),
			username => this.memory.players[username].relation === 'nap');

		let report = 'Diplomacy Status:\n';
		report += `Allies (${allies.length}): ${allies.join(', ') || 'None'}\n`;
		report += `Enemies (${enemies.length}): ${enemies.join(', ') || 'None'}\n`;
		report += `NAPs (${naps.length}): ${naps.join(', ') || 'None'}\n`;

		return report;
	}

	/**
	 * Run diplomacy update
	 */
	static run(): void {
		this.init();

		if (Game.time % DiplomacyManager.settings.updateInterval === 0) {
			this.decayScores();
			this.scanRooms();
			this.memory.lastUpdate = Game.time;
		}
	}
}

// Export legacy-compatible functions
export function isWhitelisted(username: string): boolean {
	return DiplomacyManager.isWhitelisted(username);
}

export function isAlly(username: string): boolean {
	return DiplomacyManager.isAlly(username);
}

export function isEnemy(username: string): boolean {
	return DiplomacyManager.isEnemy(username);
}

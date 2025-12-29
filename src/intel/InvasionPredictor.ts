import {log} from '../console/log';
import {profile} from '../profiler/decorator';

/**
 * Invasion record for historical tracking
 */
interface InvasionRecord {
	tick: number;
	roomName: string;
	attacker: string;
	hostileCount: number;
	combatPower: number;
	outcome: 'repelled' | 'damage' | 'unknown';
}

/**
 * Attack pattern for a player
 */
interface AttackPattern {
	averageInterval: number;           // Average ticks between attacks
	lastAttack: number;                // Last attack tick
	attackCount: number;               // Total attacks
	preferredSize: 'small' | 'medium' | 'large';
	targetedRooms: string[];           // Rooms they've attacked
}

/**
 * Invasion Prediction Memory
 */
interface InvasionPredictionMemory {
	history: InvasionRecord[];
	patterns: { [attacker: string]: AttackPattern };
	lastAnalysis: number;
}

const InvasionPredictionMemoryDefaults: InvasionPredictionMemory = {
	history: [],
	patterns: {},
	lastAnalysis: 0,
};

/**
 * Prediction result
 */
interface InvasionPrediction {
	probability: number;               // 0-1 probability of attack
	estimatedTick: number;             // Estimated tick of next attack
	estimatedSize: 'small' | 'medium' | 'large';
	likelyAttacker?: string;           // Most likely attacker
	confidence: 'low' | 'medium' | 'high';
}

/**
 * Invasion Prediction System - analyzes historical data to predict future attacks
 *
 * Features:
 * 1. Record all invasion events
 * 2. Analyze attack patterns per player
 * 3. Predict future attacks based on patterns
 * 4. Provide risk assessment for colonies
 */
@profile
export class InvasionPredictor {

	static settings = {
		maxHistorySize: 500,               // Maximum invasion records to keep
		analysisInterval: 1000,            // How often to analyze patterns (ticks)
		predictionWindow: 50000,           // How far ahead to predict (ticks)
		minAttacksForPattern: 3,           // Minimum attacks to establish pattern
		historyRetentionTicks: 500000,     // How long to keep history
		smallAttackThreshold: 200,         // Combat power threshold for small
		largeAttackThreshold: 1000,        // Combat power threshold for large
	};

	/**
	 * Get memory
	 */
	private static get memory(): InvasionPredictionMemory {
		if (!Memory.Overmind) {
			Memory.Overmind = {} as any;
		}
		if (!(Memory.Overmind as any).invasionPrediction) {
			(Memory.Overmind as any).invasionPrediction = InvasionPredictionMemoryDefaults;
		}
		return (Memory.Overmind as any).invasionPrediction;
	}

	/**
	 * Record an invasion event
	 */
	static recordInvasion(
		roomName: string,
		attacker: string,
		hostileCount: number,
		combatPower: number,
		outcome: 'repelled' | 'damage' | 'unknown' = 'unknown'
	): void {
		const record: InvasionRecord = {
			tick: Game.time,
			roomName,
			attacker,
			hostileCount,
			combatPower,
			outcome,
		};

		this.memory.history.push(record);

		// Trim history if too large
		if (this.memory.history.length > InvasionPredictor.settings.maxHistorySize) {
			this.memory.history = this.memory.history.slice(-InvasionPredictor.settings.maxHistorySize);
		}

		log.info(`Invasion recorded: ${attacker} attacked ${roomName} with ${hostileCount} creeps`);

		// Update pattern immediately
		this.updateAttackerPattern(attacker);
	}

	/**
	 * Update attack pattern for a specific attacker
	 */
	private static updateAttackerPattern(attacker: string): void {
		const attacks = this.memory.history.filter(r => r.attacker === attacker);

		if (attacks.length < InvasionPredictor.settings.minAttacksForPattern) {
			return;
		}

		// Calculate average interval between attacks
		const intervals: number[] = [];
		for (let i = 1; i < attacks.length; i++) {
			intervals.push(attacks[i].tick - attacks[i - 1].tick);
		}
		const averageInterval = intervals.length > 0
			? _.sum(intervals) / intervals.length
			: InvasionPredictor.settings.predictionWindow;

		// Determine preferred attack size
		const avgPower = _.sum(attacks, a => a.combatPower) / attacks.length;
		let preferredSize: 'small' | 'medium' | 'large' = 'medium';
		if (avgPower < InvasionPredictor.settings.smallAttackThreshold) {
			preferredSize = 'small';
		} else if (avgPower >= InvasionPredictor.settings.largeAttackThreshold) {
			preferredSize = 'large';
		}

		// Get targeted rooms
		const targetedRooms = _.uniq(attacks.map(a => a.roomName));

		this.memory.patterns[attacker] = {
			averageInterval,
			lastAttack: attacks[attacks.length - 1].tick,
			attackCount: attacks.length,
			preferredSize,
			targetedRooms,
		};
	}

	/**
	 * Analyze all attacker patterns
	 */
	static analyzePatterns(): void {
		// Get unique attackers
		const attackers = _.uniq(this.memory.history.map(r => r.attacker));

		for (const attacker of attackers) {
			this.updateAttackerPattern(attacker);
		}

		this.memory.lastAnalysis = Game.time;
	}

	/**
	 * Clean old history records
	 */
	private static cleanOldHistory(): void {
		const cutoff = Game.time - InvasionPredictor.settings.historyRetentionTicks;
		this.memory.history = this.memory.history.filter(r => r.tick > cutoff);
	}

	/**
	 * Predict next attack for a room
	 */
	static predictForRoom(roomName: string): InvasionPrediction {
		// Find attackers who have targeted this room
		const relevantAttackers = _.filter(this.memory.patterns, (pattern, attacker) =>
			pattern.targetedRooms.includes(roomName)
		);

		if (_.isEmpty(relevantAttackers)) {
			return {
				probability: 0.1,
				estimatedTick: Game.time + InvasionPredictor.settings.predictionWindow,
				estimatedSize: 'small',
				confidence: 'low',
			};
		}

		// Find the most likely attacker based on pattern
		let mostLikelyAttacker: string | undefined;
		let highestProbability = 0;
		let estimatedTick = Game.time + InvasionPredictor.settings.predictionWindow;
		let estimatedSize: 'small' | 'medium' | 'large' = 'medium';

		for (const attacker in this.memory.patterns) {
			const pattern = this.memory.patterns[attacker];
			if (!pattern.targetedRooms.includes(roomName)) continue;

			// Calculate time since last attack
			const ticksSinceLastAttack = Game.time - pattern.lastAttack;

			// Calculate probability based on interval
			const expectedNextAttack = pattern.lastAttack + pattern.averageInterval;
			const ticksToExpected = expectedNextAttack - Game.time;

			// Higher probability if we're past the expected time
			let probability = 0.5;
			if (ticksToExpected < 0) {
				// Overdue
				probability = Math.min(0.9, 0.5 + Math.abs(ticksToExpected) / pattern.averageInterval * 0.3);
			} else if (ticksToExpected < pattern.averageInterval * 0.5) {
				// Getting close
				probability = 0.3 + (1 - ticksToExpected / (pattern.averageInterval * 0.5)) * 0.3;
			} else {
				// Not expected soon
				probability = 0.1;
			}

			// Adjust by attack frequency
			if (pattern.attackCount > 10) {
				probability *= 1.2; // More frequent attackers are more likely
			}

			if (probability > highestProbability) {
				highestProbability = probability;
				mostLikelyAttacker = attacker;
				estimatedTick = Math.max(Game.time, expectedNextAttack);
				estimatedSize = pattern.preferredSize;
			}
		}

		// Determine confidence
		let confidence: 'low' | 'medium' | 'high' = 'low';
		const bestPattern = mostLikelyAttacker ? this.memory.patterns[mostLikelyAttacker] : null;
		if (bestPattern) {
			if (bestPattern.attackCount >= 10) {
				confidence = 'high';
			} else if (bestPattern.attackCount >= 5) {
				confidence = 'medium';
			}
		}

		return {
			probability: highestProbability,
			estimatedTick,
			estimatedSize,
			likelyAttacker: mostLikelyAttacker,
			confidence,
		};
	}

	/**
	 * Get risk assessment for all colonies
	 */
	static getRiskAssessment(): { [roomName: string]: InvasionPrediction } {
		const assessment: { [roomName: string]: InvasionPrediction } = {};

		for (const colony of _.values(Overmind.colonies) as any[]) {
			assessment[colony.room.name] = this.predictForRoom(colony.room.name);
		}

		return assessment;
	}

	/**
	 * Get attackers who frequently target a room
	 */
	static getFrequentAttackers(roomName: string): string[] {
		const attackers = _.filter(this.memory.patterns, (pattern, attacker) =>
			pattern.targetedRooms.includes(roomName) && pattern.attackCount >= 3
		);

		return Object.keys(attackers).sort((a, b) => {
			const patternB = this.memory.patterns[b];
			const patternA = this.memory.patterns[a];
			return (patternB ? patternB.attackCount : 0) - (patternA ? patternA.attackCount : 0);
		});
	}

	/**
	 * Get status report
	 */
	static getStatusReport(): string {
		let report = 'Invasion Prediction Status:\n';
		report += `History records: ${this.memory.history.length}\n`;
		report += `Tracked attackers: ${Object.keys(this.memory.patterns).length}\n`;

		for (const attacker in this.memory.patterns) {
			const pattern = this.memory.patterns[attacker];
			const ticksSinceLast = Game.time - pattern.lastAttack;
			report += `\n${attacker}:\n`;
			report += `  Attacks: ${pattern.attackCount}\n`;
			report += `  Avg interval: ${Math.round(pattern.averageInterval)} ticks\n`;
			report += `  Last attack: ${ticksSinceLast} ticks ago\n`;
			report += `  Preferred size: ${pattern.preferredSize}\n`;
			report += `  Targeted: ${pattern.targetedRooms.join(', ')}\n`;
		}

		return report;
	}

	/**
	 * Run invasion predictor
	 */
	static run(): void {
		// Clean old history periodically
		if (Game.time % 10000 === 0) {
			this.cleanOldHistory();
		}

		// Analyze patterns periodically
		if (Game.time % InvasionPredictor.settings.analysisInterval === 0) {
			this.analyzePatterns();
		}
	}
}

import {Colony} from '../../Colony';
import {Roles, Setups} from '../../creepSetups/setups';
import {OverlordPriority} from '../../priorities/priorities_overlords';
import {profile} from '../../profiler/decorator';
import {Tasks} from '../../tasks/Tasks';
import {Zerg} from '../../zerg/Zerg';
import {Overlord} from '../Overlord';

const DEFAULT_NUM_SCOUTS = 3;

/**
 * Sends out scouts which randomly traverse rooms to uncover possible expansion locations and gather intel.
 * Prioritizes scouting adjacent rooms for early warning system visibility.
 */
@profile
export class RandomWalkerScoutOverlord extends Overlord {

	scouts: Zerg[];

	constructor(colony: Colony, priority = OverlordPriority.scouting.randomWalker) {
		super(colony, 'scout', priority);
		this.scouts = this.zerg(Roles.scout, {notifyWhenAttacked: false});
	}

	init() {
		this.wishlist(DEFAULT_NUM_SCOUTS, Setups.scout);
	}

	/**
	 * Get adjacent rooms that need vision for early warning
	 */
	private getAdjacentRoomsNeedingVision(): string[] {
		const colonyRoom = this.colony.room.name;
		const adjacentRooms = _.values(Game.map.describeExits(colonyRoom)) as string[];
		return _.filter(adjacentRooms, roomName => {
			// No vision in this room
			if (!Game.rooms[roomName]) return true;
			// Room status is not closed
			return Game.map.getRoomStatus(roomName).status !== 'closed';
		});
	}

	private handleScout(scout: Zerg) {
		// Stomp on enemy construction sites
		const enemyConstructionSites = scout.room.find(FIND_HOSTILE_CONSTRUCTION_SITES);
		if (enemyConstructionSites.length > 0 && enemyConstructionSites[0].pos.isWalkable(true)) {
			scout.goTo(enemyConstructionSites[0].pos);
			return;
		}
		// Check if room might be connected to newbie/respawn zone
		const indestructibleWalls = _.filter(scout.room.walls, wall => wall.hits == undefined);
		if (indestructibleWalls.length > 0) { // go back to origin colony if you find a room near newbie zone
			scout.task = Tasks.goToRoom(this.colony.room.name);
			return;
		}

		// Priority 1: Scout adjacent rooms without vision for early warning system
		const roomsNeedingVision = this.getAdjacentRoomsNeedingVision();
		if (roomsNeedingVision.length > 0) {
			// Check if any other scout is already heading to these rooms
			const targetedRooms = _.compact(_.map(this.scouts, s => {
				if (s.name === scout.name) return null;
				const task = s.task;
				if (task && task.name === 'goToRoom') {
					return (task.data as any).roomName;
				}
				return null;
			}));
			const untargetedRooms = _.filter(roomsNeedingVision, r => !targetedRooms.includes(r));
			if (untargetedRooms.length > 0) {
				scout.task = Tasks.goToRoom(_.sample(untargetedRooms)!);
				return;
			}
		}

		// Priority 2: Random exploration
		const neighboringRooms = _.values(Game.map.describeExits(scout.pos.roomName)) as string[];
		const roomName = _.sample(neighboringRooms);
		if (roomName && Game.map.getRoomStatus(roomName).status !== 'closed') {
			scout.task = Tasks.goToRoom(roomName);
		}
	}

	run() {
		this.autoRun(this.scouts, scout => this.handleScout(scout));
	}
}

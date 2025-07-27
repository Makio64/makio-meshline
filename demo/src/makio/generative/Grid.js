import { pickInArray, randomInt } from '../utils/random'
import DoubleLinkedList from '../utils/structures/DoubleLinkedList'

class Cell {
	constructor( x, y ) {
		this.next = null
		this.prev = null
		this.isFree = true
		this.x = x
		this.y = y
		this.width = 1
		this.height = 1
		this.time = 0
	}
}

export default class Grid {
	constructor( width, height, x, y ) {
		this.width = width
		this.height = height
		this.columns = []
		this.zones = []
		this.time = 0
		this.freeCells = new DoubleLinkedList()
		for ( let i = 0; i < this.width; i++ ) {
			this.columns.push( [] )
			for ( let j = 0; j < height; j++ ) {
				let cell = new Cell( i, j )
				this.freeCells.add( cell )
				this.columns[i][j] = cell
			}
		}
	}

	getCell( x, y ) {
		return this.columns[x][y]
	}

	getRandomFreeCell() {
		let idx = randomInt( 0, this.freeCells.count - 1 )
		let cell = this.freeCells.getNodeAtIdx( idx )
		return cell
	}

	compute() {
		while ( this.freeCells.count > 0 ) {
			let zone = []
			this.zones.push( zone )
			let cell = this.getRandomFreeCell()
			this.simpleExtends( cell, zone )
		}
		return this.zones
	}

	simpleExtends( cell, zone ) {
		let n = 1
		let max = 10 //random() > 0.9 ? 2 : 1
		let canExtends = true
		while ( canExtends && n <= max ) {
			for ( let x = cell.x; x < cell.x + n; x++ ) {
				for ( let y = cell.y; y < cell.y + n; y++ ) {
					if ( x >= this.width || y >= this.height || !this.getCell( x, y ).isFree ) {
						canExtends = false
						n--
						break
					}
				}
				if ( !canExtends ) {
					break
				}
			}
			if ( canExtends ) {
				n++
			}
		}
		n = Math.min( n, max )
		n = Math.max( 1, n )
		for ( let x = cell.x; x < cell.x + n; x++ ) {
			for ( let y = cell.y; y < cell.y + n; y++ ) {
				let c = this.getCell( x, y )
				this.freeCells.remove( c )
				c.isFree = false
				c.time = this.time
			}
		}
		zone.push( cell )
		cell.width = n
		cell.height = n
		this.time++
	}

	snakeExtension( cell, zone ) {
		this.freeCells.remove( cell )
		cell.isFree = false
		cell.time = this.time
		this.time++
		zone.push( cell )

		//choose a direction for extension
		let directions = []
		if ( cell.x < this.width - 1 && this.getCell( cell.x + 1, cell.y ).isFree ) {
			directions.push( { x: 1, y: 0 } )
		}
		if ( cell.x > 0 && this.getCell( cell.x - 1, cell.y ).isFree ) {
			directions.push( { x: -1, y: 0 } )
		}
		if ( cell.y < this.height - 1 && this.getCell( cell.x, cell.y + 1 ).isFree ) {
			directions.push( { x: 0, y: 1 } )
		}
		if ( cell.y > 0 && this.getCell( cell.x, cell.y - 1 ).isFree ) {
			directions.push( { x: 0, y: -1 } )
		}

		if ( directions.length > 0 ) {
			let dir = pickInArray( directions )
			let nextCell = this.getCell( cell.x + dir.x, cell.y + dir.y )
			this.snakeExtension( nextCell, zone )
		}
	}
}

import random, { shuffleArray } from '../utils/random'
import DoubleLinkedList from '../utils/structures/DoubleLinkedList'

class Cell {
	constructor( x, y, w, h, padding = 0 ) {
		this.next = null
		this.prev = null
		this.isFree = true
		this.x = x
		this.y = y
		this.w = this.width = w
		this.h = this.height = h
		this.time = 0
		this.children = []
		this.padding = padding
	}
}

export default class QuadTree {
	// this.options = {
	// 	size0:1, 				// 1 super fat
	// 	size1:3, 				// 3 fat
	//  ...sizeX:n,			// exact number of subdivisions, max subdivisions 32
	//
	// 	maxDepth:4, 		// -1 to use only minSize
	// 	minSize: 10,  	// -1 to use only maxDepth
	//	jitter: 0,			// allow not perfect square, value between 0 & 1. 0=> perfectSquare, 1=>chaos..
	//	randomNext: 0.5, //
	// 	startZones : [] // starting quads define by top left et right bottom points, by default : {x:0, y1:0, x2:100, y2:100}
	// }
	// constructor({ maxDepth = 4, minSize = -1, test = null, startZones = [{ x: 0, y1: 0, x2: 100, y2: 100 }], jitter = 0, randomNext = 0.5, sizes = { 0: 0 } } = {}) {
	constructor( width, height, { total = -1, maxDepth = 4, minSize = -1, test = null, jitter = 0, randomNext = 0.6, sizes = { 0: 0, 1: 0 }, record = false, minPadding = 0, maxPadding = 0 } = {} ) {
		// 128 is probably way too much depth but it cost nothing :)
		for ( let i = 0; i < 128; i++ ) {
			this[`size${i}`] = sizes[i] != undefined ? sizes[i] : -1
		}

		this.maxDepth = maxDepth
		this.minSize = minSize
		this.total = total
		this.count = 0
		this.test = test || this.test
		this.startZones = [{ x: 0, y1: 0, x2: width, y2: height }]
		this.jitter = jitter
		this.record = record
		this.randomNext = randomNext
		this.minPadding = minPadding
		this.maxPadding = maxPadding
		this.cut = 0
		this.records = []
		this.cells = new DoubleLinkedList() //active cells
		this.cells.add( new Cell( 0, 0, width, height, 0 ) )
		this.lockCells = new DoubleLinkedList() //cant be split cells
	}

	compute() {
		this.lockCells = new DoubleLinkedList()
		this.newCells = new DoubleLinkedList()
		let iteration = 0
		this.time = 0
		if ( this.record ) {
			this.records.push( [...this.cells.toArray()] )
		}
		// not fully recursives to allow more control on each sizes & avoid max stacks
		// while (activeZones.length > 0) {
		while ( this.count < this.total ) {
			this.newCells.reset()
			let forcedCount = this[`size${iteration}`]
			let cells = this.cells.toArray()
			
			// Exit if no more cells to subdivide
			if ( cells.length === 0 ) {
				console.warn( 'QuadTree: No more cells to subdivide, exiting early' )
				break
			}
			
			cells = shuffleArray( cells )

			for ( let cell of cells ) {
				//forced => ==0 force to continue
				//forced => >0 stop here
				//forced => <0 normal test
				this.quadtree( iteration, cell, forcedCount )
				if ( forcedCount != 0 ) {
					forcedCount--
				}
			}
			let news = this.newCells.toArray()
			this.cells.fromArray( [...news] )
			if ( this.record ) {
				this.records.push( [...news, ...this.lockCells.toArray()] )
			}
			iteration++
		}

		if ( this.record ) {
			this.records[this.records.length - 1] = [...this.newCells.toArray(), ...this.lockCells.toArray()]
		}

		return [...this.cells.toArray(), ...this.newCells.toArray(), ...this.lockCells.toArray()]
	}

	quadtree( iteration, cell, forced ) {
		this.time++

		if ( forced > 0 || ( forced != 0 && this.test( iteration, cell.width, cell.height ) ) || ( iteration > 1 && random() > 0.8 ) ) {
			this.cells.remove( cell )
			// Assign a random padding when locking the cell
			cell.padding = this.minPadding + random() * ( this.maxPadding - this.minPadding )
			this.lockCells.add( cell )
			cell.lock = true
			cell.time = this.time
			return
		}

		if ( this.time % ( iteration * 2 ) == 0 ) {
			if ( this.record ) {
				this.records.push( [...this.cells.toArray(), ...this.newCells.toArray(), ...this.lockCells.toArray()] )
			}
		}
		this.cells.remove( cell )

		this.count += 4

		let p1 = random() * this.jitter + ( 1 - this.jitter ) * 0.5
		let p2 = random() * this.jitter + ( 1 - this.jitter ) * 0.5

		//top-left
		let c = new Cell( cell.x, cell.y, cell.width * p1, cell.height * p2, cell.padding )
		c.time = this.time++
		this.newCells.add( c )

		//top-right
		c = new Cell( cell.x + cell.width * p1, cell.y, cell.width * ( 1 - p1 ), cell.height * p2, cell.padding )
		c.time = this.time++
		this.newCells.add( c )

		// bottom-left
		c = new Cell( cell.x, cell.y + cell.height * p2, cell.width * p1, cell.height * ( 1 - p2 ), cell.padding )
		c.time = this.time++
		this.newCells.add( c )

		//bottom-right
		c = new Cell( cell.x + cell.width * p1, cell.y + cell.height * p2, cell.width * ( 1 - p1 ), cell.height * ( 1 - p2 ), cell.padding )
		c.time = this.time++
		this.newCells.add( c )
	}

	test( iteration, width, height ) {
		if ( this.total != -1 && this.count < this.total ) {
			return false
		}
		if ( random() < this.randomNext ) {
			return true
		}
		if ( this.maxDepth != -1 && iteration >= this.maxDepth ) {
			return true
		}
		if ( this.minSize != -1 && ( width <= this.minSize || height <= this.minSize ) ) {
			return true
		}
		return false
	}
}

export { QuadTree }

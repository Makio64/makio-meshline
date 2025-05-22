import { shuffle } from '../utils/arrays'
import random from '../utils/random'

export default class QuadTree {
	// this.options = {
	// 	size0:1, 				// 1 super fat
	// 	size1:3, 				// 3 fat
	//  ...sizeX:n,			// exact number of subdivisions, max subdivisions 32
	//
	// 	maxDepth:4, 		// -1 to use only minSize
	// 	minSize: 10,  	// -1 to use only maxDepth
	//	jitter: 0,			// allow not perfect square, value between 0 & 1. 0=> perfectSquare, 1=>chaos..
	//	randomNext: 0.5,//
	// 	startZones : [] // starting quads define by top left et right bottom points, by default : {x1:0,y1:0,z1:0,x2:100,y2:100,z2:100}
	// 	registerAll : false
	// }
	constructor( options = {} ) {
		for ( let i = 0; i < 32; i++ ) {
			this[`size${i}`] = options[`size${i}`] != undefined ? options[`size${i}`] : -1
		}

		this.maxDepth = options.maxDepth != undefined ? options.maxDepth : 4
		this.minSize = options.minSize != undefined ? options.minSize : 1
		this.test = options.test != undefined ? options.test : this.test
		this.startZones = options.startZones != undefined ? options.startZones : [{ x1: 0, y1: 0, z1: 0, x2: 100, y2: 100, z2: 100 }]
		this.jitter = options.jitter != undefined ? options.jitter : 0
		this.randomNext = options.randomNext != undefined ? options.randomNext : 0.5
		this.registerAll = options.registerAll != undefined ? options.registerAll : false
	}

	compute() {
		let activeZones = this.startZones
		let finalZones = []
		let isEnd = false
		let iteration = 0

		// not fully recursives to allow more control on each sizes + avoir max stacks
		while ( activeZones.length > 0 ) {
			let actives = []
			let forcedCount = this[`size${iteration}`]
			for ( let a of activeZones ) {
				//forced => ==0 force to continue
				//forced => >0 stop here
				//forced => <0 normal test
				this.quadtree( iteration, a.x1, a.y1, a.z1, a.x2, a.y2, a.z2, actives, finalZones, forcedCount )
				if ( forcedCount != 0 ) {
					forcedCount--
				}
			}
			activeZones = shuffle( actives, random )
			iteration++
		}

		return finalZones
	}

	quadtree( iteration, x1, y1, z1, x2, y2, z2, actives, end, forced ) {
		let width = x2 - x1
		let height = y2 - y1
		let depth = z2 - z1

		if ( forced > 0 || ( forced != 0 && this.test( iteration, width, height, depth ) ) ) {
			end.push( { x1: x1, y1: y1, z1: z1, x2: x2, y2: y2, z2: z2 } )
			return
		}

		let p1 = random() * this.jitter + ( 1 - this.jitter ) * 0.5
		let p2 = random() * this.jitter + ( 1 - this.jitter ) * 0.5
		let p3 = random() * this.jitter + ( 1 - this.jitter ) * 0.5

		//back
		//top-right
		actives.push( { x1: x1, y1: y1, z1: z1, x2: x1 + width * p1, y2: y1 + height * p2, z2: z1 + depth * p3 } )
		//bottom-right
		actives.push( { x1: x1 + width * p1, y1: y1, z1: z1, x2: x2, y2: y1 + height * p2, z2: z1 + depth * p3 } )
		// //top-left
		actives.push( { x1: x1, y1: y1 + height * p2, z1: z1, x2: x1 + width * p1, y2: y2, z2: z1 + depth * p3 } )
		//bottom-left
		actives.push( { x1: x1 + width * p1, y1: y1 + height * p2, z1: z1, x2: x2, y2: y2, z2: z1 + depth * p3 } )

		//front
		p1 = random() * this.jitter + ( 1 - this.jitter ) * 0.5
		p2 = random() * this.jitter + ( 1 - this.jitter ) * 0.5

		//top-right
		actives.push( { x1: x1, y1: y1, z1: z1 + depth * p3, x2: x1 + width * p1, y2: y1 + height * p2, z2: z2 } )
		//bottom-right
		actives.push( { x1: x1 + width * p1, y1: y1, z1: z1 + depth * p3, x2: x2, y2: y1 + height * p2, z2: z2 } )
		// //top-left
		actives.push( { x1: x1, y1: y1 + height * p2, z1: z1 + depth * p3, x2: x1 + width * p1, y2: y2, z2: z2 } )
		//bottom-left
		actives.push( { x1: x1 + width * p1, y1: y1 + height * p2, z1: z1 + depth * p3, x2: x2, y2: y2, z2: z2 } )
	}

	test( iteration, width, height, depth ) {
		if ( random() < this.randomNext ) {
			return true
		}
		if ( this.maxDepth != -1 && iteration >= this.maxDepth ) {
			return true
		}
		if ( this.minSize != -1 && ( width <= this.minSize || height <= this.minSize || depth <= this.minSize ) ) {
			return true
		}
		return false
	}
}
